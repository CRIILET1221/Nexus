// Файлы локального сервера: те же операции, что и у SFTP, но на диске.
// Пути «виртуальные» в стиле SFTP: "/" — папка сервера, "/plugins" — её подпапка.
// Выйти за пределы папки сервера нельзя.
import { promises as fsp, createWriteStream } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { shell } from 'electron'
import type { RemoteEntry, TransferInfo } from '../shared/types'
import { servers } from './store'
import { emit } from './events'
import { runTar } from './minecraft'
import { tr } from '../shared/i18n'

const MAX_EDIT = 10 * 1024 * 1024

function rootOf(serverId: string) {
  const s = servers.get(serverId)
  if (!s) throw new Error(tr('Сервер не найден'))
  return resolve(s.dir)
}

/** "/plugins/x.jar" → абсолютный путь внутри папки сервера */
function abs(serverId: string, vpath: string) {
  const root = rootOf(serverId)
  const p = resolve(root, '.' + ('/' + vpath).replace(/\\/g, '/').replace(/\/+/g, '/'))
  if (p !== root && !p.startsWith(root + sep)) throw new Error(tr('Путь вне папки сервера'))
  return p
}

const toV = (root: string, p: string) => '/' + relative(root, p).split(sep).join('/')
const sessionKey = (serverId: string) => `local:${serverId}`
const changed = (serverId: string, vdir: string) => emit('sftp:changed', { sessionId: sessionKey(serverId), dir: vdir })

export async function list(serverId: string, vdir: string): Promise<RemoteEntry[]> {
  const root = rootOf(serverId)
  const dir = abs(serverId, vdir)
  const names = await fsp.readdir(dir).catch((e) => {
    throw new Error(e.code === 'ENOENT' ? tr('Папка не найдена') : e.message)
  })
  const out = await Promise.all(
    names.map(async (name): Promise<RemoteEntry | null> => {
      const p = join(dir, name)
      const st = await fsp.lstat(p).catch(() => null)
      if (!st) return null
      const isLink = st.isSymbolicLink()
      const real = isLink ? await fsp.stat(p).catch(() => st) : st
      return { name, path: toV(root, p), isDir: real.isDirectory(), isLink, size: real.size, mtime: real.mtimeMs, mode: real.mode }
    })
  )
  return out.filter((x): x is RemoteEntry => !!x)
}

export async function mkdir(serverId: string, vpath: string) {
  await fsp.mkdir(abs(serverId, vpath), { recursive: true })
}

export async function rename(serverId: string, from: string, to: string) {
  const a = abs(serverId, from)
  const b = abs(serverId, to)
  if (await fsp.access(b).then(() => true, () => false)) throw new Error(tr('Файл с таким именем уже существует'))
  await fsp.rename(a, b)
}

/** Удаление — в корзину Windows, чтобы можно было восстановить */
export async function remove(serverId: string, vpaths: string[]) {
  const root = rootOf(serverId)
  for (const v of vpaths) {
    const p = abs(serverId, v)
    if (p === root) throw new Error(tr('Нельзя удалить саму папку сервера'))
    await shell.trashItem(p)
  }
}

export async function readText(serverId: string, vpath: string) {
  const p = abs(serverId, vpath)
  const st = await fsp.stat(p)
  if (st.size > MAX_EDIT) throw new Error(tr('Файл слишком большой для редактора (больше 10 МБ)'))
  const buf = await fsp.readFile(p)
  if (buf.subarray(0, 8000).includes(0)) throw new Error(tr('Это бинарный файл — его нельзя открыть в редакторе'))
  return buf.toString('utf8')
}

export async function writeText(serverId: string, vpath: string, content: string) {
  await fsp.writeFile(abs(serverId, vpath), content, 'utf8')
}

// ---------- копирование с прогрессом ----------

async function walk(p: string): Promise<{ file: string; size: number }[]> {
  const st = await fsp.stat(p)
  if (!st.isDirectory()) return [{ file: p, size: st.size }]
  const out: { file: string; size: number }[] = []
  for (const name of await fsp.readdir(p)) out.push(...(await walk(join(p, name))))
  return out
}

async function copyTree(serverId: string, kind: 'upload' | 'download', src: string, destDir: string) {
  const files = await walk(src)
  const t: TransferInfo = {
    id: randomUUID(),
    sessionId: sessionKey(serverId),
    kind,
    name: basename(src),
    transferred: 0,
    total: files.reduce((s, f) => s + f.size, 0),
    state: 'active'
  }
  emit('transfer:update', { ...t })
  let last = 0
  try {
    const base = dirname(src)
    for (const f of files) {
      const dest = join(destDir, relative(base, f.file))
      await fsp.mkdir(dirname(dest), { recursive: true })
      await fsp.copyFile(f.file, dest)
      t.transferred += f.size
      if (Date.now() - last > 120) (last = Date.now()), emit('transfer:update', { ...t })
    }
    // пустые папки
    if ((await fsp.stat(src)).isDirectory()) await fsp.mkdir(join(destDir, basename(src)), { recursive: true })
    t.state = 'done'
  } catch (e) {
    t.state = 'error'
    t.error = e instanceof Error ? e.message : String(e)
  }
  emit('transfer:update', { ...t })
  if (t.state === 'error') throw new Error(t.error)
}

/** Копирует файлы с компьютера в папку сервера */
export async function upload(serverId: string, locals: string[], vdir: string) {
  const dir = abs(serverId, vdir)
  for (const l of locals) await copyTree(serverId, 'upload', resolve(l), dir)
  changed(serverId, vdir)
}

/** Копирует файлы сервера в выбранную папку на компьютере */
export async function download(serverId: string, vpaths: string[], localDir: string) {
  for (const v of vpaths) await copyTree(serverId, 'download', abs(serverId, v), resolve(localDir))
}

// ---------- архивы (встроенный в Windows tar) ----------

export async function decompress(serverId: string, vdir: string, name: string) {
  const dir = abs(serverId, vdir)
  const file = abs(serverId, `${vdir}/${name}`)
  const r = await runTar(['-xf', file], dir)
  if (r.code !== 0) throw new Error(tr('Не удалось распаковать: ') + r.out.slice(0, 300))
  changed(serverId, vdir)
}

export async function compress(serverId: string, vdir: string, names: string[]) {
  const dir = abs(serverId, vdir)
  for (const n of names) abs(serverId, `${vdir}/${n}`) // проверка путей
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/(\d{8})(\d{6})/, '$1-$2')
  const archive = names.length === 1 ? `${names[0]}.zip` : `archive-${stamp}.zip`
  const r = await runTar(['-a', '-c', '-f', archive, ...names], dir)
  if (r.code !== 0) throw new Error(tr('Не удалось создать архив: ') + r.out.slice(0, 300))
  changed(serverId, vdir)
  return archive
}

/** Скачивает файл по ссылке прямо в папку сервера */
export async function pull(serverId: string, vdir: string, url: string, fileName?: string) {
  if (!/^https:\/\//i.test(url)) throw new Error(tr('Нужна https-ссылка'))
  const dir = abs(serverId, vdir)
  const res = await fetch(url, { headers: { 'User-Agent': 'Nexus-ServerPanel/0.3 (desktop app)' } })
  if (!res.ok || !res.body) throw new Error(tr('Не удалось скачать (HTTP {0})', res.status))
  const cd = res.headers.get('content-disposition') ?? ''
  const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1]
  let name = fileName ?? (fromHeader ? decodeURIComponent(fromHeader) : decodeURIComponent(new URL(res.url).pathname.split('/').pop() || 'download'))
  name = name.replace(/[\\/:*?"<>|]/g, '_')
  const dest = join(dir, name)
  const tmp = dest + '.part'
  const out = createWriteStream(tmp)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
    await fsp.rename(tmp, dest)
  } catch (e) {
    out.destroy()
    await fsp.rm(tmp, { force: true })
    throw e
  }
  changed(serverId, vdir)
  return name
}

/** Показать файл в проводнике */
export function reveal(serverId: string, vpath: string) {
  shell.showItemInFolder(abs(serverId, vpath))
}

/** sha1 файлов (для определения модов/плагинов через Modrinth) */
export async function hash(serverId: string, vpaths: string[]) {
  const { createHash } = await import('node:crypto')
  const out: string[] = []
  for (const v of vpaths) out.push(createHash('sha1').update(await fsp.readFile(abs(serverId, v))).digest('hex'))
  return out
}
