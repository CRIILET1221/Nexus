import { Client, type SFTPWrapper, type ClientChannel, type ConnectConfig } from 'ssh2'
import { BrowserWindow, dialog } from 'electron'
import { readFileSync, promises as fsp } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { join, basename, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { posix } from 'node:path'
import type { RemoteEntry, SessionInfo, TransferInfo } from '../shared/types'
import { profiles, knownHosts } from './store'
import { emit } from './events'
import { runTar } from './minecraft'
import { tr } from '../shared/i18n'

interface Session {
  info: SessionInfo
  client: Client
  sftp: SFTPWrapper
  shells: Map<string, ClientChannel>
}

const sessions = new Map<string, Session>()
const MAX_EDIT_SIZE = 10 * 1024 * 1024

/** Закрывает все SSH-терминалы (при перезагрузке интерфейса), сами подключения остаются */
export function closeAllShells() {
  for (const s of sessions.values()) {
    s.shells.forEach((ch) => ch.close())
    s.shells.clear()
  }
}

export function listSessions(): SessionInfo[] {
  return [...sessions.values()].map((s) => s.info)
}

function getSession(id: string): Session {
  const s = sessions.get(id)
  if (!s) throw new Error(tr('Сессия закрыта. Подключитесь заново.'))
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
        title: tr('Ключ сервера изменился!'),
        message: tr('Ключ сервера {0} отличается от сохранённого.', hostPort),
        detail: tr('Это может означать атаку «человек посередине» или переустановку сервера.\n\nБыло: {0}\nСейчас: {1}\n\nДоверять новому ключу?', known, fp),
        buttons: [tr('Отмена'), tr('Доверять новому ключу')],
        defaultId: 0,
        cancelId: 0
      }
    : {
        type: 'question' as const,
        title: tr('Новый сервер'),
        message: tr('Первое подключение к {0}', hostPort),
        detail: tr('Отпечаток ключа сервера:\n{0}\n\nДоверять этому серверу?', fp),
        buttons: [tr('Отмена'), tr('Доверять')],
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
  if (!profile) throw new Error(tr('Профиль не найден'))
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
    if (!profile.keyPath) throw new Error(tr('Не указан файл ключа'))
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
    return new Error(tr('Неверный логин, пароль или ключ'))
  if (err.code === 'ECONNREFUSED') return new Error(tr('Соединение отклонено: проверьте адрес и порт'))
  if (err.code === 'ENOTFOUND') return new Error(tr('Хост не найден'))
  if (err.code === 'ETIMEDOUT' || /timed out/i.test(m)) return new Error(tr('Превышено время ожидания'))
  if (/host key|verification failed/i.test(m)) return new Error(tr('Подключение отменено: ключ сервера не подтверждён'))
  if (/passphrase|encrypted private key/i.test(m)) return new Error(tr('Неверная парольная фраза ключа'))
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
  if (st.size > MAX_EDIT_SIZE) throw new Error(tr('Файл слишком большой для редактора (больше 10 МБ)'))
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const rs = sftp.createReadStream(path)
    rs.on('data', (c: Buffer) => chunks.push(c))
    rs.on('end', () => resolve())
    rs.on('error', reject)
  })
  const buf = Buffer.concat(chunks)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(tr('Это бинарный файл — его нельзя открыть в редакторе'))
  return buf.toString('utf8')
}

/** Читает файл целиком как байты (данные игроков, NBT) — до 32 МБ */
export async function readBinary(sessionId: string, path: string): Promise<Uint8Array> {
  const { sftp } = getSession(sessionId)
  const st = await p<any>((cb) => sftp.stat(path, cb as any))
  if (st.size > 32 * 1024 * 1024) throw new Error(tr('Файл слишком большой'))
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
  // скорость — по окну последних ~2 секунд
  const samples: { at: number; bytes: number }[] = []
  const push = (force = false) => {
    const now = Date.now()
    if (force || now - last > 120) {
      last = now
      samples.push({ at: now, bytes: t.transferred })
      while (samples.length > 2 && now - samples[0].at > 2000) samples.shift()
      const first = samples[0]
      t.speed = now > first.at ? Math.max(0, ((t.transferred - first.bytes) * 1000) / (now - first.at)) : 0
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
    /** текущий этап (упаковка, загрузка архива…) */
    stage(text: string | undefined) {
      t.stage = text
      push(true)
    },
    /** новый общий объём (например, после упаковки в архив) */
    reset(total: number) {
      t.total = total
      t.transferred = 0
      samples.length = 0
      push(true)
    },
    done() {
      t.state = 'done'
      t.stage = undefined
      t.speed = 0
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


/** Сколько файлов передаём одновременно. SFTP-запросы ждут ответа сервера, и параллельность
 *  скрывает эту задержку — главный выигрыш на папках с множеством мелких файлов. */
const PARALLEL_FILES = 8

/** Операции панели хостинга с архивами (Pterodactyl): пути — как в SFTP, относительно корня сервера */
export interface ArchiveOps {
  compress(root: string, files: string[]): Promise<string>
  decompress(root: string, file: string): Promise<void>
}

interface Tree {
  /** папки относительно корня, '' — сам корень */
  dirs: string[]
  /** файлы относительно корня, '' — если сам корень является файлом */
  files: { rel: string; size: number }[]
}

const treeSize = (t: Tree) => t.files.reduce((s, f) => s + f.size, 0)

/** Архив выгоден, когда файлов много, а они мелкие (конфиги, плагины, датапаки) */
const worthArchiving = (t: Tree) => t.dirs.length > 0 && t.files.length >= 40 && treeSize(t) / t.files.length < 512 * 1024

async function runPool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let next = 0
  let firstErr: unknown = null
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await fn(item)
      } catch (e) {
        firstErr ??= e
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (firstErr) throw firstErr
}

const relJoin = (a: string, b: string) => (a ? `${a}/${b}` : b)

async function walkLocal(root: string): Promise<Tree> {
  const st = await fsp.stat(root)
  if (!st.isDirectory()) return { dirs: [], files: [{ rel: '', size: st.size }] }
  const tree: Tree = { dirs: [''], files: [] }
  let level = ['']
  while (level.length) {
    const next: string[] = []
    await runPool(level, 16, async (rel) => {
      for (const e of await fsp.readdir(join(root, rel), { withFileTypes: true })) {
        const r = relJoin(rel, e.name)
        if (e.isDirectory()) {
          tree.dirs.push(r)
          next.push(r)
        } else if (e.isFile()) {
          tree.files.push({ rel: r, size: (await fsp.stat(join(root, r))).size })
        }
      }
    })
    level = next
  }
  return tree
}

/** Обход папки на сервере: размеры берём прямо из readdir, папки одного уровня читаем параллельно */
async function walkRemote(sftp: SFTPWrapper, root: string): Promise<Tree> {
  const st = await p<any>((cb) => sftp.stat(root, cb as any))
  if (!isDirMode(st.mode)) return { dirs: [], files: [{ rel: '', size: st.size }] }
  const tree: Tree = { dirs: [''], files: [] }
  let level = ['']
  while (level.length) {
    const next: string[] = []
    await runPool(level, 8, async (rel) => {
      const dir = rel ? posix.join(root, rel) : root
      for (const it of await p<any[]>((cb) => sftp.readdir(dir, cb as any))) {
        if (it.filename === '.' || it.filename === '..') continue
        const r = relJoin(rel, it.filename)
        let mode = it.attrs.mode ?? 0
        let size = it.attrs.size ?? 0
        if (isLinkMode(mode)) {
          const real = await p<any>((cb) => sftp.stat(posix.join(dir, it.filename), cb as any)).catch(() => null)
          if (!real) continue // битая ссылка
          mode = real.mode
          size = real.size
        }
        if (isDirMode(mode)) {
          tree.dirs.push(r)
          next.push(r)
        } else tree.files.push({ rel: r, size })
      }
    })
    level = next
  }
  return tree
}

function fastPut(sftp: SFTPWrapper, local: string, remote: string, onBytes: (n: number) => void, concurrency = 64) {
  let prev = 0
  return p<void>((cb) =>
    sftp.fastPut(local, remote, {
      concurrency,
      step: (done: number) => {
        onBytes(done - prev)
        prev = done
      }
    }, cb as any)
  )
}

function fastGet(sftp: SFTPWrapper, remote: string, local: string, onBytes: (n: number) => void, concurrency = 64) {
  let prev = 0
  return p<void>((cb) =>
    sftp.fastGet(remote, local, {
      concurrency,
      step: (done: number) => {
        onBytes(done - prev)
        prev = done
      }
    }, cb as any)
  )
}

const mkdirRemote = (sftp: SFTPWrapper, path: string) => p((cb) => sftp.mkdir(path, cb as any)).catch(() => undefined) // уже есть — ок

/** Папки по уровням (родитель раньше детей), внутри уровня — параллельно */
async function mkdirLevels(dirs: string[], make: (rel: string) => Promise<unknown>) {
  const byDepth = new Map<number, string[]>()
  for (const d of dirs) {
    const depth = d ? d.split('/').length : 0
    byDepth.set(depth, [...(byDepth.get(depth) ?? []), d])
  }
  for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) await runPool(byDepth.get(depth)!, 16, (d) => make(d).then(() => undefined))
}

/** Параллельная загрузка дерева файлов */
async function putTree(sftp: SFTPWrapper, local: string, remote: string, tree: Tree, onBytes: (n: number) => void) {
  await mkdirLevels(tree.dirs, (d) => mkdirRemote(sftp, d ? posix.join(remote, d) : remote))
  const per = tree.files.length > 1 ? 8 : 64
  await runPool(tree.files, PARALLEL_FILES, (f) =>
    fastPut(sftp, f.rel ? join(local, f.rel) : local, f.rel ? posix.join(remote, f.rel) : remote, onBytes, per)
  )
}

/** Параллельное скачивание дерева файлов */
async function getTree(sftp: SFTPWrapper, remote: string, local: string, tree: Tree, onBytes: (n: number) => void) {
  await mkdirLevels(tree.dirs, (d) => fsp.mkdir(d ? join(local, d) : local, { recursive: true }))
  const per = tree.files.length > 1 ? 8 : 64
  await runPool(tree.files, PARALLEL_FILES, (f) =>
    fastGet(sftp, f.rel ? posix.join(remote, f.rel) : remote, f.rel ? join(local, f.rel) : local, onBytes, per)
  )
}

const tempDir = async () => {
  const d = join(tmpdir(), 'nexatom-transfer', randomUUID())
  await fsp.mkdir(d, { recursive: true })
  return d
}
const unlinkRemote = (sftp: SFTPWrapper, path: string) => p((cb) => sftp.unlink(path, cb as any)).catch(() => undefined)

/**
 * Папка с множеством мелких файлов → один zip: упаковываем на ПК, загружаем одним файлом,
 * распаковываем на сервере через панель. false — архивный путь не сработал, нужна обычная загрузка.
 */
async function putViaArchive(sftp: SFTPWrapper, local: string, remoteDir: string, ops: ArchiveOps, t: ReturnType<typeof makeTransfer>, total: number) {
  const tmp = await tempDir()
  const zipName = `.nexatom-upload-${randomUUID().slice(0, 8)}.zip`
  const zipLocal = join(tmp, zipName)
  const zipRemote = posix.join(remoteDir, zipName)
  try {
    t.stage(tr('Упаковываю на ПК…'))
    // имя архива — относительно cwd: путь «C:\…» tar принимает за адрес удалённого хоста
    const r = await runTar(['-a', '-c', '-f', zipName, '-C', dirname(local), basename(local)], tmp)
    if (r.code !== 0) return false
    // прогресс показываем в размере самой папки, а не сжатого архива
    const scale = total / Math.max(1, (await fsp.stat(zipLocal)).size)
    t.reset(total)
    t.stage(tr('Загружаю архивом…'))
    await fastPut(sftp, zipLocal, zipRemote, (n) => t.add(n * scale))
    t.stage(tr('Распаковываю на сервере…'))
    try {
      await ops.decompress(remoteDir, zipName)
    } catch {
      return false
    }
    return true
  } finally {
    await unlinkRemote(sftp, zipRemote)
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Папка на сервере → архив через панель → скачивание одним файлом → распаковка на ПК */
async function getViaArchive(sftp: SFTPWrapper, remote: string, localDir: string, ops: ArchiveOps, t: ReturnType<typeof makeTransfer>, total: number) {
  const parent = posix.dirname(remote)
  let archive: string
  try {
    t.stage(tr('Упаковываю на сервере…'))
    archive = await ops.compress(parent, [posix.basename(remote)])
  } catch {
    return false
  }
  const archiveRemote = posix.join(parent, archive)
  const tmp = await tempDir()
  try {
    const st = await p<any>((cb) => sftp.stat(archiveRemote, cb as any))
    const scale = total / Math.max(1, st.size)
    t.reset(total)
    t.stage(tr('Скачиваю архивом…'))
    const archiveLocal = join(tmp, archive)
    await fastGet(sftp, archiveRemote, archiveLocal, (n) => t.add(n * scale))
    t.stage(tr('Распаковываю на ПК…'))
    await fsp.mkdir(localDir, { recursive: true })
    const r = await runTar(['-xf', archive, '-C', localDir], tmp)
    if (r.code !== 0) throw new Error(tr('Не удалось распаковать: ') + r.out.slice(0, 300))
    return true
  } finally {
    await unlinkRemote(sftp, archiveRemote)
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Загружает локальные файлы/папки в удалённую папку. Прогресс идёт событиями transfer:update,
 * промис завершается, когда всё загружено (ошибка — если хоть один файл не загрузился).
 */
export async function upload(sessionId: string, localPaths: string[], remoteDir: string, archive?: ArchiveOps) {
  const { sftp } = getSession(sessionId)
  let firstError: unknown = null
  await runPool(localPaths, 3, async (local) => {
    const name = basename(local)
    const t = makeTransfer(sessionId, 'upload', name, 0)
    try {
      t.stage(tr('Подготовка…'))
      const tree = await walkLocal(local)
      t.reset(treeSize(tree))
      let done = false
      if (archive && worthArchiving(tree)) done = await putViaArchive(sftp, local, remoteDir, archive, t, treeSize(tree))
      if (!done) {
        t.reset(treeSize(tree))
        t.stage(tree.files.length > 1 ? tr('Файлов: {0}', tree.files.length) : undefined)
        await putTree(sftp, local, posix.join(remoteDir, name), tree, (n) => t.add(n))
      }
      t.done()
    } catch (e) {
      t.fail(e)
      firstError ??= e
    }
  })
  emit('sftp:changed', { sessionId, dir: remoteDir })
  if (firstError) throw firstError instanceof Error ? firstError : new Error(String(firstError))
}

/** Скачивает файлы/папки с сервера в локальную папку; промис завершается по окончании */
export async function download(sessionId: string, remotePaths: string[], localDir: string, archive?: ArchiveOps) {
  const { sftp } = getSession(sessionId)
  let firstError: unknown = null
  await runPool(remotePaths, 3, async (remote) => {
    const name = posix.basename(remote)
    const t = makeTransfer(sessionId, 'download', name, 0)
    try {
      t.stage(tr('Подготовка…'))
      const tree = await walkRemote(sftp, remote)
      t.reset(treeSize(tree))
      let done = false
      if (archive && worthArchiving(tree)) done = await getViaArchive(sftp, remote, localDir, archive, t, treeSize(tree))
      if (!done) {
        t.reset(treeSize(tree))
        t.stage(tree.files.length > 1 ? tr('Файлов: {0}', tree.files.length) : undefined)
        await getTree(sftp, remote, join(localDir, name), tree, (n) => t.add(n))
      }
      t.done()
    } catch (e) {
      t.fail(e)
      firstError ??= e
    }
  })
  if (firstError) throw firstError instanceof Error ? firstError : new Error(String(firstError))
}

// ---------- SSH-консоль ----------

export async function openShell(sessionId: string, cols: number, rows: number): Promise<string> {
  const s = getSession(sessionId)
  const NO_SHELL =
    tr('Сервер не даёт SSH-консоль — доступен только SFTP (так работают почти все хостинги Minecraft). ') +
    tr('Используйте вкладку «Консоль сервера» — она работает через API панели хостинга.')
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
