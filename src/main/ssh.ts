import { Client, type SFTPWrapper, type ClientChannel, type ConnectConfig } from 'ssh2'
import { BrowserWindow, dialog } from 'electron'
import { readFileSync, promises as fsp } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { join, basename } from 'node:path'
import { posix } from 'node:path'
import type { RemoteEntry, SessionInfo, TransferInfo } from '../shared/types'
import { profiles, knownHosts } from './store'
import { emit } from './events'

interface Session {
  info: SessionInfo
  client: Client
  sftp: SFTPWrapper
  shells: Map<string, ClientChannel>
}

const sessions = new Map<string, Session>()
const MAX_EDIT_SIZE = 10 * 1024 * 1024

function getSession(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new Error('Сессия закрыта. Подключитесь заново.')
  return s
}

// ---------- Проверка ключа хоста (TOFU) ----------

async function verifyHost(hostPort: string, key: Buffer): Promise<boolean> {
  const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  const known = knownHosts.get(hostPort)
  if (known === fp) return true
  const win = BrowserWindow.getAllWindows()[0]
  const opts = known
    ? {
        type: 'warning' as const,
        title: 'Ключ сервера изменился!',
        message: `Ключ сервера ${hostPort} отличается от сохранённого.`,
        detail: `Это может означать атаку «человек посередине» или переустановку сервера.\n\nБыло: ${known}\nСейчас: ${fp}\n\nДоверять новому ключу?`,
        buttons: ['Отмена', 'Доверять новому ключу'],
        defaultId: 0,
        cancelId: 0
      }
    : {
        type: 'question' as const,
        title: 'Новый сервер',
        message: `Первое подключение к ${hostPort}`,
        detail: `Отпечаток ключа сервера:\n${fp}\n\nДоверять этому серверу?`,
        buttons: ['Отмена', 'Доверять'],
        defaultId: 1,
        cancelId: 0
      }
  const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  if (res.response === 1) {
    knownHosts.set(hostPort, fp)
    return true
  }
  return false
}

// ---------- Подключение ----------

export async function connect(profileId: string, secretOverride?: string): Promise<SessionInfo> {
  const profile = profiles.get(profileId)
  if (!profile) throw new Error('Профиль не найден')
  const secret = secretOverride ?? profiles.secret(profileId)
  const hostPort = `${profile.host}:${profile.port}`

  const cfg: ConnectConfig = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
    hostVerifier: (key: Buffer, verify: (ok: boolean) => void) => {
      verifyHost(hostPort, key).then(verify, () => verify(false))
    }
  } as ConnectConfig

  if (profile.authType === 'key') {
    if (!profile.keyPath) throw new Error('Не указан файл ключа')
    cfg.privateKey = readFileSync(profile.keyPath)
    if (secret) cfg.passphrase = secret
  } else {
    cfg.password = secret ?? ''
    cfg.tryKeyboard = true
  }

  const client = new Client()
  if (profile.authType === 'password') {
    client.on('keyboard-interactive', (_n, _i, _l, prompts, finish) => finish(prompts.map(() => secret ?? '')))
  }

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve())
    client.once('error', (err) => reject(humanizeError(err)))
    client.connect(cfg)
  })

  const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
    client.sftp((err, s) => (err ? reject(err) : resolve(s)))
  )

  let home = '/'
  try {
    home = await new Promise<string>((res, rej) => sftp.realpath('.', (e, p) => (e ? rej(e) : res(p))))
  } catch {
    /* оставляем / */
  }

  const id = randomUUID()
  const info: SessionInfo = {
    id,
    profileId,
    name: profile.name,
    host: hostPort,
    homePath: profile.remotePath?.trim() || home
  }
  const session: Session = { info, client, sftp, shells: new Map() }
  sessions.set(id, session)

  client.on('error', (err) => console.error('[ssh]', err.message))
  client.on('close', () => {
    if (sessions.delete(id)) emit('session:closed', { id })
  })
  return info
}

function humanizeError(err: Error & { level?: string; code?: string }): Error {
  const m = err.message || ''
  if (err.level === 'client-authentication' || /authentication/i.test(m))
    return new Error('Неверный логин, пароль или ключ')
  if (err.code === 'ECONNREFUSED') return new Error('Соединение отклонено: проверьте адрес и порт')
  if (err.code === 'ENOTFOUND') return new Error('Хост не найден')
  if (err.code === 'ETIMEDOUT' || /timed out/i.test(m)) return new Error('Превышено время ожидания')
  if (/host key|verification failed/i.test(m)) return new Error('Подключение отменено: ключ сервера не подтверждён')
  if (/passphrase|encrypted private key/i.test(m)) return new Error('Неверная парольная фраза ключа')
  return err
}

export function disconnect(id: string) {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  s.shells.forEach((ch) => ch.close())
  s.client.end()
}

export function disconnectAll() {
  for (const id of [...sessions.keys()]) disconnect(id)
}

// ---------- SFTP: базовые операции ----------

const p = <T>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res as T))))

const S_IFMT = 0o170000
const isDirMode = (mode: number) => (mode & S_IFMT) === 0o040000
const isLinkMode = (mode: number) => (mode & S_IFMT) === 0o120000

export async function list(sessionId: string, dir: string): Promise<RemoteEntry[]> {
  const { sftp } = getSession(sessionId)
  const items = await p<any[]>((cb) => sftp.readdir(dir, cb as any))
  const entries = await Promise.all(
    items.map(async (it): Promise<RemoteEntry> => {
      const full = posix.join(dir, it.filename)
      const mode = it.attrs.mode ?? 0
      let isDir = isDirMode(mode)
      const isLink = isLinkMode(mode)
      if (isLink) {
        try {
          const st = await p<any>((cb) => sftp.stat(full, cb as any))
          isDir = isDirMode(st.mode)
        } catch {
          /* битая ссылка */
        }
      }
      return {
        name: it.filename,
        path: full,
        isDir,
        isLink,
        size: it.attrs.size ?? 0,
        mtime: (it.attrs.mtime ?? 0) * 1000,
        mode
      }
    })
  )
  return entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'ru'))
}

export async function mkdir(sessionId: string, path: string) {
  const { sftp } = getSession(sessionId)
  await p((cb) => sftp.mkdir(path, cb as any))
}

export async function rename(sessionId: string, from: string, to: string) {
  const { sftp } = getSession(sessionId)
  await p((cb) => sftp.rename(from, to, cb as any))
}

async function removeRecursive(sftp: SFTPWrapper, path: string) {
  const st = await p<any>((cb) => sftp.lstat(path, cb as any))
  if (isDirMode(st.mode)) {
    const items = await p<any[]>((cb) => sftp.readdir(path, cb as any))
    for (const it of items) await removeRecursive(sftp, posix.join(path, it.filename))
    await p((cb) => sftp.rmdir(path, cb as any))
  } else {
    await p((cb) => sftp.unlink(path, cb as any))
  }
}

export async function remove(sessionId: string, paths: string[]) {
  const { sftp } = getSession(sessionId)
  for (const path of paths) await removeRecursive(sftp, path)
}

export async function readText(sessionId: string, path: string): Promise<string> {
  const { sftp } = getSession(sessionId)
  const st = await p<any>((cb) => sftp.stat(path, cb as any))
  if (st.size > MAX_EDIT_SIZE) throw new Error('Файл слишком большой для редактора (больше 10 МБ)')
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const rs = sftp.createReadStream(path)
    rs.on('data', (c: Buffer) => chunks.push(c))
    rs.on('end', () => resolve())
    rs.on('error', reject)
  })
  const buf = Buffer.concat(chunks)
  if (buf.subarray(0, 8000).includes(0)) throw new Error('Это бинарный файл — его нельзя открыть в редакторе')
  return buf.toString('utf8')
}

/** Читает файл целиком как байты (данные игроков, NBT) — до 32 МБ */
export async function readBinary(sessionId: string, path: string): Promise<Uint8Array> {
  const { sftp } = getSession(sessionId)
  const st = await p<any>((cb) => sftp.stat(path, cb as any))
  if (st.size > 32 * 1024 * 1024) throw new Error('Файл слишком большой')
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const rs = sftp.createReadStream(path)
    rs.on('data', (c: Buffer) => chunks.push(c))
    rs.on('end', () => resolve())
    rs.on('error', reject)
  })
  return new Uint8Array(Buffer.concat(chunks))
}

export async function writeText(sessionId: string, path: string, content: string) {
  const { sftp } = getSession(sessionId)
  await new Promise<void>((resolve, reject) => {
    const ws = sftp.createWriteStream(path)
    ws.on('close', () => resolve())
    ws.on('error', reject)
    ws.end(Buffer.from(content, 'utf8'))
  })
}

// ---------- Передача файлов ----------

function makeTransfer(sessionId: string, kind: TransferInfo['kind'], name: string, total: number) {
  const t: TransferInfo = { id: randomUUID(), sessionId, kind, name, transferred: 0, total, state: 'active' }
  let last = 0
  const push = (force = false) => {
    const now = Date.now()
    if (force || now - last > 120) {
      last = now
      emit('transfer:update', { ...t })
    }
  }
  push(true)
  return {
    info: t,
    add(bytes: number) {
      t.transferred += bytes
      push()
    },
    done() {
      t.state = 'done'
      t.transferred = t.total
      push(true)
    },
    fail(err: unknown) {
      t.state = 'error'
      t.error = err instanceof Error ? err.message : String(err)
      push(true)
    }
  }
}

async function localSize(path: string): Promise<number> {
  const st = await fsp.stat(path)
  if (!st.isDirectory()) return st.size
  let sum = 0
  for (const name of await fsp.readdir(path)) sum += await localSize(join(path, name))
  return sum
}

async function remoteSize(sftp: SFTPWrapper, path: string): Promise<number> {
  const st = await p<any>((cb) => sftp.stat(path, cb as any))
  if (!isDirMode(st.mode)) return st.size
  let sum = 0
  for (const it of await p<any[]>((cb) => sftp.readdir(path, cb as any)))
    sum += await remoteSize(sftp, posix.join(path, it.filename))
  return sum
}

function fastPut(sftp: SFTPWrapper, local: string, remote: string, onBytes: (n: number) => void) {
  let prev = 0
  return p<void>((cb) =>
    sftp.fastPut(local, remote, {
      step: (done: number) => {
        onBytes(done - prev)
        prev = done
      }
    }, cb as any)
  )
}

function fastGet(sftp: SFTPWrapper, remote: string, local: string, onBytes: (n: number) => void) {
  let prev = 0
  return p<void>((cb) =>
    sftp.fastGet(remote, local, {
      step: (done: number) => {
        onBytes(done - prev)
        prev = done
      }
    }, cb as any)
  )
}

async function uploadItem(sftp: SFTPWrapper, local: string, remote: string, onBytes: (n: number) => void) {
  const st = await fsp.stat(local)
  if (st.isDirectory()) {
    await p((cb) => sftp.mkdir(remote, cb as any)).catch(() => undefined) // уже существует — ок
    for (const name of await fsp.readdir(local))
      await uploadItem(sftp, join(local, name), posix.join(remote, name), onBytes)
  } else {
    await fastPut(sftp, local, remote, onBytes)
  }
}

async function downloadItem(sftp: SFTPWrapper, remote: string, local: string, onBytes: (n: number) => void) {
  const st = await p<any>((cb) => sftp.stat(remote, cb as any))
  if (isDirMode(st.mode)) {
    await fsp.mkdir(local, { recursive: true })
    for (const it of await p<any[]>((cb) => sftp.readdir(remote, cb as any)))
      await downloadItem(sftp, posix.join(remote, it.filename), join(local, it.filename), onBytes)
  } else {
    await fastGet(sftp, remote, local, onBytes)
  }
}

/**
 * Загружает локальные файлы/папки в удалённую папку. Прогресс идёт событиями transfer:update,
 * промис завершается, когда всё загружено (ошибка — если хоть один файл не загрузился).
 */
export async function upload(sessionId: string, localPaths: string[], remoteDir: string) {
  const { sftp } = getSession(sessionId)
  let firstError: unknown = null
  for (const local of localPaths) {
    const name = basename(local)
    const t = makeTransfer(sessionId, 'upload', name, 0)
    try {
      t.info.total = await localSize(local)
      await uploadItem(sftp, local, posix.join(remoteDir, name), (n) => t.add(n))
      t.done()
    } catch (e) {
      t.fail(e)
      firstError ??= e
    }
  }
  emit('sftp:changed', { sessionId, dir: remoteDir })
  if (firstError) throw firstError instanceof Error ? firstError : new Error(String(firstError))
}

export function download(sessionId: string, remotePaths: string[], localDir: string) {
  const { sftp } = getSession(sessionId)
  ;(async () => {
    for (const remote of remotePaths) {
      const name = posix.basename(remote)
      const t = makeTransfer(sessionId, 'download', name, 0)
      try {
        t.info.total = await remoteSize(sftp, remote)
        await downloadItem(sftp, remote, join(localDir, name), (n) => t.add(n))
        t.done()
      } catch (e) {
        t.fail(e)
      }
    }
  })()
}

// ---------- SSH-консоль ----------

export async function openShell(sessionId: string, cols: number, rows: number): Promise<string> {
  const s = getSession(sessionId)
  const NO_SHELL =
    'Сервер не даёт SSH-консоль — доступен только SFTP (так работают почти все хостинги Minecraft). ' +
    'Используйте вкладку «Консоль сервера» — она работает через API панели хостинга.'
  const channel = await new Promise<ClientChannel>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(NO_SHELL)), 10_000)
    s.client.shell({ term: 'xterm-256color', cols, rows }, (err, ch) => {
      clearTimeout(timer)
      if (err) reject(new Error(/pty|pseudo|terminal|shell|denied|reject|failure|not supported/i.test(err.message) ? NO_SHELL : err.message))
      else resolve(ch)
    })
  })
  const id = randomUUID()
  s.shells.set(id, channel)
  const dec = new StringDecoder('utf8')
  const decErr = new StringDecoder('utf8')
  channel.on('data', (d: Buffer) => emit('shell:data', { id, data: dec.write(d) }))
  channel.stderr.on('data', (d: Buffer) => emit('shell:data', { id, data: decErr.write(d) }))
  channel.on('close', () => {
    s.shells.delete(id)
    emit('shell:exit', { id })
  })
  return id
}

function findShell(id: string) {
  for (const s of sessions.values()) {
    const ch = s.shells.get(id)
    if (ch) return ch
  }
  return undefined
}

export function writeShell(id: string, data: string) {
  findShell(id)?.write(data)
}

export function resizeShell(id: string, cols: number, rows: number) {
  findShell(id)?.setWindow(rows, cols, 0, 0)
}

export function closeShell(id: string) {
  findShell(id)?.close()
}

/** sha1 файлов на сервере (читаются потоком, на диск не сохраняются) */
export async function hashFiles(sessionId: string, paths: string[]): Promise<string[]> {
  const { sftp } = getSession(sessionId)
  const out: string[] = []
  for (const path of paths) {
    const h = createHash('sha1')
    await new Promise<void>((resolve, reject) => {
      const rs = sftp.createReadStream(path)
      rs.on('data', (c: Buffer) => h.update(c))
      rs.on('end', () => resolve())
      rs.on('error', reject)
    })
    out.push(h.digest('hex'))
  }
  return out
}
