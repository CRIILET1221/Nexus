import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, existsSync, promises as fsp } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { join } from 'node:path'
import { networkInterfaces } from 'node:os'
import { app, shell } from 'electron'
import type {
  CreateServerInput,
  JavaInfo,
  LocalBackup,
  LocalServerConfig,
  ServerCore,
  ServerRuntime,
  ServerStatus
} from '../shared/types'
import { servers, settings } from './store'
import { emit } from './events'
import { tr } from '../shared/i18n'

const UA = 'NexAtom/0.6 (desktop app)'

export async function getJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(tr('Ошибка сети {0} при запросе {1}', res.status, new URL(url).host))
  return (await res.json()) as T
}

// ---------- Версии ----------

function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

const isRelease = (v: string) => /^\d+(\.\d+)+$/.test(v)
const sortDesc = (list: string[]) => [...new Set(list.filter(isRelease))].sort((a, b) => cmpVersion(b, a))

const versionCache = new Map<ServerCore, { at: number; list: string[] }>()

export async function getVersions(core: ServerCore): Promise<string[]> {
  const cached = versionCache.get(core)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.list
  let list: string[]
  switch (core) {
    case 'paper': {
      const data = await getJson<{ versions: Record<string, string[]> }>('https://fill.papermc.io/v3/projects/paper')
      list = sortDesc(Object.values(data.versions).flat())
      break
    }
    case 'purpur': {
      const data = await getJson<{ versions: string[] }>('https://api.purpurmc.org/v2/purpur')
      list = sortDesc(data.versions)
      break
    }
    case 'fabric': {
      const data = await getJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/game')
      list = sortDesc(data.filter((v) => v.stable).map((v) => v.version))
      break
    }
    case 'vanilla': {
      const data = await getJson<{ versions: { id: string; type: string }[] }>(
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
      )
      list = sortDesc(data.versions.filter((v) => v.type === 'release').map((v) => v.id))
      break
    }
    case 'forge': {
      const data = await getJson<{ promos: Record<string, string> }>(FORGE_PROMOS)
      list = sortDesc(Object.keys(data.promos).map((k) => k.split('-')[0]))
      break
    }
  }
  versionCache.set(core, { at: Date.now(), list })
  return list
}

const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'

async function forgeVersion(mc: string): Promise<string> {
  const data = await getJson<{ promos: Record<string, string> }>(FORGE_PROMOS)
  const v = data.promos[`${mc}-recommended`] ?? data.promos[`${mc}-latest`]
  if (!v) throw new Error(tr('Forge для Minecraft {0} не найден', mc))
  return v
}

export interface JarSource {
  url: string
  hash?: { algo: 'sha1' | 'sha256'; value: string }
}

async function resolveJar(core: ServerCore, version: string): Promise<JarSource> {
  switch (core) {
    case 'paper': {
      const b = await getJson<any>(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/latest`)
      const d = b.downloads?.['server:default']
      if (!d?.url) throw new Error(tr('Для этой версии Paper нет сборки'))
      return { url: d.url, hash: d.checksums?.sha256 ? { algo: 'sha256', value: d.checksums.sha256 } : undefined }
    }
    case 'purpur':
      return { url: `https://api.purpurmc.org/v2/purpur/${version}/latest/download` }
    case 'fabric': {
      const loaders = await getJson<{ version: string; stable: boolean }[]>('https://meta.fabricmc.net/v2/versions/loader')
      const installers = await getJson<{ version: string; stable: boolean }[]>(
        'https://meta.fabricmc.net/v2/versions/installer'
      )
      const loader = (loaders.find((l) => l.stable) ?? loaders[0]).version
      const installer = (installers.find((i) => i.stable) ?? installers[0]).version
      return { url: `https://meta.fabricmc.net/v2/versions/loader/${version}/${loader}/${installer}/server/jar` }
    }
    case 'forge': {
      const v = await forgeVersion(version)
      return { url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${version}-${v}/forge-${version}-${v}-installer.jar` }
    }
    case 'vanilla': {
      const manifest = await getJson<{ versions: { id: string; url: string }[] }>(
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
      )
      const entry = manifest.versions.find((v) => v.id === version)
      if (!entry) throw new Error(tr('Версия не найдена'))
      const meta = await getJson<any>(entry.url)
      const server = meta.downloads?.server
      if (!server?.url) throw new Error(tr('У этой версии нет серверного jar'))
      return { url: server.url, hash: { algo: 'sha1', value: server.sha1 } }
    }
  }
}

export async function downloadFile(src: JarSource, dest: string, onProgress: (done: number, total: number) => void) {
  const res = await fetch(src.url, { headers: { 'User-Agent': UA } })
  if (!res.ok || !res.body) throw new Error(tr('Не удалось скачать ядро (HTTP {0})', res.status))
  const total = Number(res.headers.get('content-length') ?? 0)
  const hash = src.hash ? createHash(src.hash.algo) : null
  const tmp = dest + '.part'
  const out = createWriteStream(tmp)
  let done = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      hash?.update(value)
      done += value.length
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      onProgress(done, total)
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (e) {
    out.destroy()
    await fsp.rm(tmp, { force: true })
    throw e
  }
  if (hash && src.hash && hash.digest('hex').toLowerCase() !== src.hash.value.toLowerCase()) {
    await fsp.rm(tmp, { force: true })
    throw new Error(tr('Контрольная сумма файла не совпала — загрузка повреждена'))
  }
  await fsp.rename(tmp, dest)
}

// ---------- Java ----------

export function requiredJava(version: string): number {
  const [maj, min = 0, patch = 0] = version.split('.').map((x) => parseInt(x, 10) || 0)
  if (maj >= 26) return 25
  if (maj !== 1) return 21
  if (min > 20 || (min === 20 && patch >= 5)) return 21
  if (min >= 18) return 17
  if (min === 17) return 16
  return 8
}

function probeJava(path: string): Promise<JavaInfo> {
  return new Promise((resolve) => {
    execFile(path, ['-version'], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
      const text = `${stderr}\n${stdout}`
      const m = text.match(/version "([^"]+)"/)
      if (err && !m) return resolve({ path, version: null, major: null })
      const version = m?.[1] ?? null
      let major: number | null = null
      if (version) {
        const parts = version.split(/[._-]/).map((x) => parseInt(x, 10))
        major = parts[0] === 1 ? parts[1] : parts[0]
      }
      resolve({ path, version, major })
    })
  })
}

export async function detectJava(): Promise<JavaInfo> {
  const candidates: string[] = []
  if (settings.javaPath) candidates.push(settings.javaPath)
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', 'java.exe'))
  candidates.push('java')
  for (const c of candidates) {
    const info = await probeJava(c)
    if (info.version) return info
  }
  return { path: 'java', version: null, major: null }
}

export async function setJavaPath(path: string | undefined): Promise<JavaInfo> {
  if (path) {
    const info = await probeJava(path)
    if (!info.version) throw new Error(tr('Это не исполняемый файл Java'))
    settings.javaPath = path
    return info
  }
  settings.javaPath = undefined
  return detectJava()
}

// ---------- Создание сервера ----------

export function defaultServersDir() {
  return join(app.getPath('documents'), 'NexAtom Servers')
}

function serverProperties(i: CreateServerInput) {
  return [
    tr('# Создано в NexAtom'),
    `motd=${i.motd.replace(/\n/g, '\\n')}`,
    `server-port=${i.port}`,
    `max-players=${i.maxPlayers}`,
    `online-mode=${i.onlineMode}`,
    `gamemode=${i.gamemode}`,
    `difficulty=${i.difficulty}`,
    'enable-command-block=false',
    'view-distance=10',
    'spawn-protection=0',
    ''
  ].join('\n')
}

export async function createServer(input: CreateServerInput, progressId: string): Promise<LocalServerConfig> {
  if (!input.acceptEula) throw new Error(tr('Нужно принять лицензионное соглашение Minecraft (EULA)'))
  if (!input.name.trim()) throw new Error(tr('Укажите название сервера'))
  const dir = input.dir
  await fsp.mkdir(dir, { recursive: true })

  const progress = (stage: string, transferred = 0, total = 0) =>
    emit('server:createProgress', { id: progressId, stage, transferred, total })

  progress(tr('Поиск сборки ядра…'))
  const src = await resolveJar(input.core, input.version)
  const java = await detectJava()
  let jar = 'server.jar'
  let forgeArgs: string[] | undefined

  if (input.core === 'forge') {
    if (!java.version) throw new Error(tr('Для установки Forge нужна Java — установите её и попробуйте снова'))
    const installer = 'forge-installer.jar'
    await downloadFile(src, join(dir, installer), (d, t) => progress(tr('Загрузка установщика Forge'), d, t))
    await runForgeInstaller(java.path, dir, installer, (line) => progress(tr('Установка Forge: {0}', line.slice(0, 90))))
    await fsp.rm(join(dir, installer), { force: true })
    await fsp.rm(join(dir, installer + '.log'), { force: true })
    const detected = await detectForgeLaunch(dir)
    jar = detected.jar
    forgeArgs = detected.launchArgs
  } else {
    await downloadFile(src, join(dir, jar), (d, t) => progress(tr('Загрузка ядра'), d, t))
  }

  progress(tr('Настройка сервера…'))
  await fsp.writeFile(
    join(dir, 'eula.txt'),
    tr('# Принято пользователем в NexAtom (https://aka.ms/MinecraftEULA)\neula=true\n'),
    'utf8'
  )
  if (!existsSync(join(dir, 'server.properties')))
    await fsp.writeFile(join(dir, 'server.properties'), serverProperties(input), 'utf8')

  const cfg: LocalServerConfig = {
    id: randomUUID(),
    name: input.name.trim(),
    core: input.core,
    version: input.version,
    dir,
    jar,
    memoryMb: input.memoryMb,
    port: input.port,
    javaPath: java.path,
    jvmArgs: '',
    createdAt: Date.now(),
    launchArgs: forgeArgs
  }
  await fsp.writeFile(join(dir, 'start.bat'), `@echo off\r\n"${java.path}" ${launchArgs(cfg).join(' ')}\r\npause\r\n`, 'utf8')
  servers.add(cfg)
  progress(tr('Готово'), 1, 1)
  return cfg
}

export async function updateServer(id: string, patch: Partial<LocalServerConfig>) {
  const cfg = servers.update(id, patch)
  if (cfg && patch.port) {
    // синхронизируем порт в server.properties
    const file = join(cfg.dir, 'server.properties')
    if (existsSync(file)) {
      const text = await fsp.readFile(file, 'utf8')
      const next = /^server-port=.*$/m.test(text)
        ? text.replace(/^server-port=.*$/m, `server-port=${patch.port}`)
        : text + `\nserver-port=${patch.port}\n`
      await fsp.writeFile(file, next, 'utf8')
    }
  }
  return cfg
}

export async function deleteServer(id: string, deleteFiles: boolean) {
  const cfg = servers.get(id)
  if (!cfg) return
  if (running.has(id)) throw new Error(tr('Сначала остановите сервер'))
  if (deleteFiles && existsSync(cfg.dir)) await shell.trashItem(cfg.dir) // в корзину, не безвозвратно
  servers.remove(id)
}

// ---------- Запуск ----------

interface Running {
  proc: ChildProcessWithoutNullStreams
  status: ServerStatus
  startedAt: number
  killTimer?: NodeJS.Timeout
}

const running = new Map<string, Running>()
const logs = new Map<string, string>()
const MAX_LOG = 300_000

function appendLog(id: string, data: string) {
  let log = (logs.get(id) ?? '') + data
  if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG)
  logs.set(id, log)
  emit('server:log', { id, data })
}

function setStatus(id: string, status: ServerStatus) {
  const r = running.get(id)
  if (r) r.status = status
  emit('server:status', { id, status, startedAt: r?.startedAt } satisfies ServerRuntime)
}

function launchArgs(cfg: LocalServerConfig) {
  const extra = cfg.jvmArgs.trim() ? cfg.jvmArgs.trim().split(/\s+/) : []
  const xms = Math.min(1024, cfg.memoryMb)
  const main = cfg.launchArgs?.length ? cfg.launchArgs : ['-jar', cfg.jar]
  return [`-Xms${xms}M`, `-Xmx${cfg.memoryMb}M`, ...extra, ...main, 'nogui']
}

// ---------- Forge ----------

function runForgeInstaller(java: string, dir: string, installer: string, onLine: (l: string) => void) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(java, ['-jar', installer, '--installServer'], { cwd: dir, windowsHide: true })
    let tail = ''
    const onData = (d: Buffer) => {
      const lines = d.toString('utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length) {
        onLine(lines[lines.length - 1])
        tail = (tail + '\n' + lines.join('\n')).slice(-2000)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', (e) => reject(new Error(tr('Не удалось запустить Java: {0}', e.message))))
    proc.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(tr('Установщик Forge завершился с ошибкой (код {0}).\n{1}', code, tail.split('\n').slice(-5).join('\n'))))
    )
  })
}

/** Как запускать установленный Forge: новые версии — через win_args.txt, старые — через jar */
async function detectForgeLaunch(dir: string): Promise<{ jar: string; launchArgs?: string[] }> {
  const base = join(dir, 'libraries', 'net', 'minecraftforge', 'forge')
  if (existsSync(base)) {
    for (const v of await fsp.readdir(base)) {
      if (existsSync(join(base, v, 'win_args.txt')))
        return { jar: 'server.jar', launchArgs: [`@libraries/net/minecraftforge/forge/${v}/win_args.txt`] }
    }
  }
  const jars = (await fsp.readdir(dir)).filter((f) => /^forge-.*\.jar$/i.test(f) && !/installer/i.test(f))
  const jar = jars.find((f) => /universal|shim/i.test(f)) ?? jars[0]
  if (!jar) throw new Error(tr('Forge установился, но файл запуска не найден'))
  return { jar }
}

// ---------- Локальные бэкапы (zip через встроенный в Windows tar) ----------

const BACKUP_DIR = 'backups'

export function runTar(args: string[], cwd: string) {
  return new Promise<{ code: number; out: string }>((resolve, reject) => {
    execFile('tar', args, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? ((err as any).code ?? 1) : 0
      if (typeof code !== 'number') return reject(new Error(tr('Не найден tar.exe (нужна Windows 10 1803 или новее)')))
      resolve({ code, out: `${stdout}\n${stderr}`.trim() })
    })
  })
}

export async function listBackups(id: string): Promise<LocalBackup[]> {
  const cfg = servers.get(id)
  if (!cfg) throw new Error(tr('Сервер не найден'))
  const dir = join(cfg.dir, BACKUP_DIR)
  if (!existsSync(dir)) return []
  const out: LocalBackup[] = []
  for (const name of await fsp.readdir(dir)) {
    if (!name.toLowerCase().endsWith('.zip')) continue
    const st = await fsp.stat(join(dir, name))
    out.push({ name, size: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

export async function createBackup(id: string, label?: string): Promise<LocalBackup> {
  const cfg = servers.get(id)
  if (!cfg) throw new Error(tr('Сервер не найден'))
  const dir = join(cfg.dir, BACKUP_DIR)
  await fsp.mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  const safe = (label ?? '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim()
  const name = `${stamp}${safe ? ' ' + safe : ''}.zip`
  const entries = (await fsp.readdir(cfg.dir)).filter((e) => e !== BACKUP_DIR)
  const isRunning = running.has(id)
  if (isRunning) {
    sendCommand(id, 'save-off')
    sendCommand(id, 'save-all flush')
    await new Promise((r) => setTimeout(r, 4000))
  }
  try {
    const res = await runTar(['-a', '-c', '-f', join(dir, name), '--exclude', 'session.lock', ...entries], cfg.dir)
    const st = await fsp.stat(join(dir, name)).catch(() => null)
    if (!st || (res.code !== 0 && st.size === 0)) throw new Error(tr('Не удалось создать архив:\n{0}', res.out.slice(-500)))
    return { name, size: st.size, mtime: st.mtimeMs }
  } finally {
    if (isRunning && running.has(id)) sendCommand(id, 'save-on')
  }
}

export async function restoreBackup(id: string, name: string) {
  const cfg = servers.get(id)
  if (!cfg) throw new Error(tr('Сервер не найден'))
  if (running.has(id)) throw new Error(tr('Остановите сервер перед восстановлением'))
  const file = join(cfg.dir, BACKUP_DIR, name)
  if (!existsSync(file)) throw new Error(tr('Бэкап не найден'))
  // текущие файлы — в корзину (их можно будет вернуть), затем распаковка
  for (const e of await fsp.readdir(cfg.dir)) if (e !== BACKUP_DIR) await shell.trashItem(join(cfg.dir, e))
  const res = await runTar(['-x', '-f', file], cfg.dir)
  if (res.code !== 0) throw new Error(tr('Ошибка распаковки:\n{0}', res.out.slice(-500)))
}

export async function deleteBackup(id: string, name: string) {
  const cfg = servers.get(id)
  if (!cfg) throw new Error(tr('Сервер не найден'))
  await shell.trashItem(join(cfg.dir, BACKUP_DIR, name))
}

export function backupsDir(id: string) {
  const cfg = servers.get(id)
  if (!cfg) throw new Error(tr('Сервер не найден'))
  return join(cfg.dir, BACKUP_DIR)
}

export function runtimes(): ServerRuntime[] {
  return [...running.entries()].map(([id, r]) => ({ id, status: r.status, startedAt: r.startedAt }))
}

export function getLog(id: string) {
  return logs.get(id) ?? ''
}

export function clearLog(id: string) {
  logs.set(id, '')
}

export async function startServer(id: string) {
  const cfg = servers.get(id)
  if (!cfg) throw new Error(tr('Сервер не найден'))
  if (running.has(id)) return
  if (!existsSync(join(cfg.dir, cfg.jar))) throw new Error(tr('Файл {0} не найден в папке сервера', cfg.jar))

  const java = settings.javaPath || cfg.javaPath || 'java'
  appendLog(id, tr('\x1b[36m[NexAtom] Запуск: {0} {1}\x1b[0m\n', java, launchArgs(cfg).join(' ')))
  const proc = spawn(java, launchArgs(cfg), { cwd: cfg.dir, windowsHide: true })
  const r: Running = { proc, status: 'starting', startedAt: Date.now() }
  running.set(id, r)
  setStatus(id, 'starting')

  const out = new StringDecoder('utf8')
  const err = new StringDecoder('utf8')
  proc.stdout.on('data', (d: Buffer) => {
    const text = out.write(d)
    appendLog(id, text)
    if (r.status === 'starting' && /Done \([\d.,]+s\)!/.test(text)) setStatus(id, 'running')
  })
  proc.stderr.on('data', (d: Buffer) => appendLog(id, `\x1b[31m${err.write(d)}\x1b[0m`))
  proc.on('error', (e) => {
    appendLog(id, tr('\x1b[31m[NexAtom] Не удалось запустить Java: {0}\x1b[0m\n', e.message))
  })
  proc.on('exit', (code) => {
    if (r.killTimer) clearTimeout(r.killTimer)
    running.delete(id)
    appendLog(id, tr('\x1b[36m[NexAtom] Сервер остановлен (код {0})\x1b[0m\n', code ?? '—'))
    emit('server:status', { id, status: 'stopped' } satisfies ServerRuntime)
  })
}

export function sendCommand(id: string, command: string) {
  const r = running.get(id)
  if (!r) throw new Error(tr('Сервер не запущен'))
  appendLog(id, `\x1b[90m> ${command}\x1b[0m\n`)
  r.proc.stdin.write(command + '\n')
}

export function stopServer(id: string) {
  const r = running.get(id)
  if (!r || r.status === 'stopping') return
  setStatus(id, 'stopping')
  r.proc.stdin.write('stop\n')
  r.killTimer = setTimeout(() => killServer(id), 60_000)
}

export function killServer(id: string) {
  const r = running.get(id)
  if (!r?.proc.pid) return
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { windowsHide: true })
  else r.proc.kill('SIGKILL')
}

/** Корректно останавливает все серверы (при выходе из приложения) */
export async function stopAll(timeoutMs = 20_000) {
  const ids = [...running.keys()]
  if (!ids.length) return
  const waits = ids.map(
    (id) =>
      new Promise<void>((resolve) => {
        const r = running.get(id)
        if (!r) return resolve()
        r.proc.once('exit', () => resolve())
        stopServer(id)
      })
  )
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, timeoutMs))])
  for (const id of running.keys()) killServer(id)
}

export function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces()))
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) out.push(n.address)
  return out
}
