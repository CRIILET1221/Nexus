import type { ServerAdapter } from '../adapter'
import { readNbtFile } from './nbt'
import { parseAdvancements, parsePlayer, parseStats, type PlayerData, type PlayerStats } from './player'

/** Игрок, известный серверу (есть файл в playerdata) */
export interface KnownPlayer {
  uuid: string
  name?: string
  /** время изменения файла — примерно последний выход/автосохранение */
  mtime: number
}

export interface PlayerProfile {
  uuid: string
  name?: string
  data: PlayerData
  stats: PlayerStats
  advancements?: number
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function worldName(ad: ServerAdapter): Promise<string> {
  const props = await ad.readFile('server.properties').catch(() => null)
  const m = props ? /^level-name\s*=\s*(.*)$/m.exec(props) : null
  const name = m?.[1]?.trim()
  // защита от выхода за пределы папки сервера
  return name && !/(^|[\\/])\.\.([\\/]|$)/.test(name) && !/^[\\/]|^[a-z]:/i.test(name) ? name.replace(/\\/g, '/') : 'world'
}

/** Имена игроков по UUID: usercache.json + списки ops/whitelist/bans */
export async function nameMap(ad: ServerAdapter): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const files = ['banned-players.json', 'whitelist.json', 'ops.json', 'usercache.json']
  const texts = await Promise.all(files.map((f) => ad.readFile(f).catch(() => null)))
  for (const t of texts) {
    if (!t) continue
    try {
      for (const e of JSON.parse(t) as { uuid?: string; name?: string }[]) {
        if (e?.uuid && e?.name) map.set(e.uuid.toLowerCase(), e.name)
      }
    } catch {
      /* битый json — пропускаем */
    }
  }
  return map
}

export async function listPlayers(ad: ServerAdapter, world: string): Promise<KnownPlayer[] | null> {
  const [entries, names] = await Promise.all([ad.listDir(`${world}/playerdata`), nameMap(ad)])
  if (!entries) return null
  return entries
    .filter((e) => !e.isDir && e.name.endsWith('.dat') && UUID_RE.test(e.name.slice(0, -4)))
    .map((e) => {
      const uuid = e.name.slice(0, -4).toLowerCase()
      return { uuid, name: names.get(uuid), mtime: e.mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

export async function loadProfile(ad: ServerAdapter, world: string, uuid: string, name?: string): Promise<PlayerProfile> {
  if (!UUID_RE.test(uuid)) throw new Error('Неверный UUID игрока')
  const [bin, statsText, advText] = await Promise.all([
    ad.readBinary(`${world}/playerdata/${uuid}.dat`),
    ad.readFile(`${world}/stats/${uuid}.json`).catch(() => null),
    ad.readFile(`${world}/advancements/${uuid}.json`).catch(() => null)
  ])
  if (!bin) throw new Error('Файл игрока не найден — он ещё не заходил на сервер или мир называется иначе')
  const data = parsePlayer(await readNbtFile(bin))
  return {
    uuid,
    name: name ?? data.lastKnownName,
    data,
    stats: parseStats(statsText),
    advancements: parseAdvancements(advText)
  }
}

/** UUID без дефисов → с дефисами */
export function dashedUuid(id: string) {
  const s = id.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(s)) return id.toLowerCase()
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}
