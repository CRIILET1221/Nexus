// Каталог плагинов/модов Modrinth: поиск, версии, определение установленных файлов по хешу.
// API: https://docs.modrinth.com/api/  (без ключа, нужен User-Agent)
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const API = 'https://api.modrinth.com/v2'
const UA = 'Nexus-ServerPanel/0.4 (desktop app)'

async function get<T = any>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  } catch {
    throw new Error('Modrinth недоступен — проверьте интернет')
  }
  if (res.status === 404) return null as T
  if (res.status === 429) throw new Error('Слишком много запросов к Modrinth — подождите минуту')
  if (!res.ok) throw new Error(`Modrinth ответил ошибкой ${res.status}`)
  return (await res.json()) as T
}

export interface SearchHit {
  id: string
  slug: string
  title: string
  description: string
  author: string
  icon?: string
  downloads: number
  follows: number
  updated: string
  categories: string[]
  clientSide?: string
  serverSide?: string
}

export async function search(opts: {
  query: string
  type: 'plugin' | 'mod' | 'datapack'
  loaders: string[]
  gameVersion?: string
  index?: 'relevance' | 'downloads' | 'updated' | 'follows'
  offset?: number
}): Promise<{ hits: SearchHit[]; total: number }> {
  const facets: string[][] = [[`project_type:${opts.type}`]]
  if (opts.loaders.length) facets.push(opts.loaders.map((l) => `categories:${l}`))
  if (opts.gameVersion) facets.push([`versions:${opts.gameVersion}`])
  // для модов скрываем чисто клиентские (шейдеры, миникарты и т.п.)
  if (opts.type === 'mod') facets.push(['server_side:required', 'server_side:optional'])
  const q = new URLSearchParams({
    query: opts.query,
    facets: JSON.stringify(facets),
    index: opts.index ?? 'relevance',
    offset: String(opts.offset ?? 0),
    limit: '20'
  })
  const r = await get<any>(`/search?${q}`)
  return {
    total: r?.total_hits ?? 0,
    hits: (r?.hits ?? []).map((h: any) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      author: h.author,
      icon: h.icon_url || undefined,
      downloads: h.downloads,
      follows: h.follows,
      updated: h.date_modified,
      categories: h.categories ?? [],
      clientSide: h.client_side,
      serverSide: h.server_side
    }))
  }
}

export interface VersionFile {
  url: string
  filename: string
  sha1: string
  size: number
}

export interface ModVersion {
  id: string
  projectId: string
  name: string
  number: string
  type: string
  published: string
  gameVersions: string[]
  loaders: string[]
  file: VersionFile
  dependencies: { projectId?: string; versionId?: string; type: string }[]
}

function mapVersion(v: any): ModVersion | null {
  const f = (v.files ?? []).find((x: any) => x.primary) ?? v.files?.[0]
  if (!f) return null
  return {
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    number: v.version_number,
    type: v.version_type,
    published: v.date_published,
    gameVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    file: { url: f.url, filename: f.filename, sha1: f.hashes?.sha1, size: f.size },
    dependencies: (v.dependencies ?? []).map((d: any) => ({ projectId: d.project_id ?? undefined, versionId: d.version_id ?? undefined, type: d.dependency_type }))
  }
}

/** Подходящие версии проекта (новые сверху) */
export async function versions(projectId: string, loaders: string[], gameVersion?: string): Promise<ModVersion[]> {
  const q = new URLSearchParams()
  if (loaders.length) q.set('loaders', JSON.stringify(loaders))
  if (gameVersion) q.set('game_versions', JSON.stringify([gameVersion]))
  const r = await get<any[]>(`/project/${encodeURIComponent(projectId)}/version?${q}`)
  return (r ?? []).map(mapVersion).filter((x): x is ModVersion => !!x)
}

export async function version(id: string): Promise<ModVersion | null> {
  const r = await get<any>(`/version/${encodeURIComponent(id)}`)
  return r ? mapVersion(r) : null
}

export interface ProjectInfo {
  id: string
  slug: string
  title: string
  icon?: string
  description: string
}

export async function projects(ids: string[]): Promise<ProjectInfo[]> {
  if (!ids.length) return []
  const r = await get<any[]>(`/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)
  return (r ?? []).map((p) => ({ id: p.id, slug: p.slug, title: p.title, icon: p.icon_url || undefined, description: p.description }))
}

/** sha1 файлов → версии Modrinth (что это за мод) */
export async function identify(hashes: string[]): Promise<Record<string, ModVersion>> {
  if (!hashes.length) return {}
  const r = await get<Record<string, any>>('/version_files', { method: 'POST', body: JSON.stringify({ hashes, algorithm: 'sha1' }) })
  const out: Record<string, ModVersion> = {}
  for (const [h, v] of Object.entries(r ?? {})) {
    const m = mapVersion(v)
    if (m) out[h] = m
  }
  return out
}

/** sha1 файлов → последняя подходящая версия (для проверки обновлений) */
export async function updates(hashes: string[], loaders: string[], gameVersion?: string): Promise<Record<string, ModVersion>> {
  if (!hashes.length) return {}
  const body: any = { hashes, algorithm: 'sha1', loaders }
  if (gameVersion) body.game_versions = [gameVersion]
  const r = await get<Record<string, any>>('/version_files/update', { method: 'POST', body: JSON.stringify(body) })
  const out: Record<string, ModVersion> = {}
  for (const [h, v] of Object.entries(r ?? {})) {
    const m = mapVersion(v)
    if (m) out[h] = m
  }
  return out
}

/** Скачивает файл версии во временную папку с проверкой sha1 */
export async function downloadTemp(file: VersionFile): Promise<string> {
  const u = new URL(file.url)
  if (u.protocol !== 'https:' || !/(^|\.)modrinth\.com$/.test(u.hostname)) throw new Error('Неожиданный адрес файла')
  const dir = join(tmpdir(), 'nexus-dl', randomUUID())
  await fsp.mkdir(dir, { recursive: true })
  const dest = join(dir, file.filename.replace(/[\\/:*?"<>|]/g, '_'))
  const res = await fetch(file.url, { headers: { 'User-Agent': UA } })
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${file.filename} (HTTP ${res.status})`)
  const hash = createHash('sha1')
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
    }
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())))
  } catch (e) {
    out.destroy()
    throw e
  }
  if (file.sha1 && hash.digest('hex') !== file.sha1) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw new Error(`Контрольная сумма ${file.filename} не совпала — файл повреждён`)
  }
  return dest
}

export async function cleanupTemp(path: string) {
  const base = join(tmpdir(), 'nexus-dl')
  if (!path.startsWith(base)) return
  await fsp.rm(join(path, '..'), { recursive: true, force: true }).catch(() => undefined)
}
