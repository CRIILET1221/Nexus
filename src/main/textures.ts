import { app, protocol, net } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { downloadFile, getJson, runTar } from './minecraft'
import { emit } from './events'

/**
 * Иконки предметов: текстуры берутся из официального клиента Minecraft,
 * который скачивается с серверов Mojang (как это делает любой лаунчер) и
 * распаковывается локально. В приложение текстуры не встроены.
 */

export const TEX_SCHEME = 'nexus-tex'

const root = () => join(app.getPath('userData'), 'textures')
const metaFile = () => join(root(), 'meta.json')

export interface TextureStatus {
  installed: boolean
  version?: string
  items: string[]
  blocks: string[]
}

let cache: TextureStatus | null = null

/** Вызывать до app.ready */
export function registerTextureScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: TEX_SCHEME, privileges: { standard: true, secure: true } }])
}

/** nexus-tex://item/diamond_sword.png → файл из распакованных текстур */
export function handleTextureProtocol() {
  protocol.handle(TEX_SCHEME, (req) => {
    const u = new URL(req.url)
    const kind = u.hostname
    const file = decodeURIComponent(u.pathname.replace(/^\//, ''))
    if ((kind !== 'item' && kind !== 'block') || !/^[a-z0-9_]+\.png$/.test(file)) {
      return new Response('bad request', { status: 400 })
    }
    const p = join(root(), kind, file)
    if (!existsSync(p)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(p).toString())
  })
}

async function listPng(dir: string) {
  try {
    return (await fsp.readdir(dir)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))
  } catch {
    return []
  }
}

export async function status(): Promise<TextureStatus> {
  if (cache) return cache
  let version: string | undefined
  try {
    version = JSON.parse(await fsp.readFile(metaFile(), 'utf8')).version
  } catch {
    /* не установлены */
  }
  const [items, blocks] = await Promise.all([listPng(join(root(), 'item')), listPng(join(root(), 'block'))])
  cache = { installed: !!version && items.length > 0, version, items, blocks }
  return cache
}

export async function install(progressId: string): Promise<TextureStatus> {
  const progress = (stage: string, done = 0, total = 0) => emit('textures:progress', { id: progressId, stage, done, total })
  progress('Получаю список версий…')
  const manifest = await getJson<{ latest: { release: string }; versions: { id: string; url: string }[] }>(
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
  )
  const version = manifest.latest.release
  const entry = manifest.versions.find((v) => v.id === version)
  if (!entry) throw new Error('Не удалось найти последнюю версию Minecraft')
  const meta = await getJson<any>(entry.url)
  const client = meta.downloads?.client
  if (!client?.url) throw new Error('У версии нет клиента для загрузки')

  const dir = root()
  const tmp = join(dir, '_tmp')
  await fsp.rm(tmp, { recursive: true, force: true })
  await fsp.mkdir(tmp, { recursive: true })
  const jar = join(tmp, 'client.jar')
  try {
    await downloadFile({ url: client.url, hash: { algo: 'sha1', value: client.sha1 } }, jar, (d, t) =>
      progress(`Скачиваю Minecraft ${version}…`, d, t || client.size)
    )
    progress('Распаковываю текстуры…')
    const res = await runTar(['-xf', 'client.jar', 'assets/minecraft/textures/item', 'assets/minecraft/textures/block'], tmp)
    if (res.code !== 0) throw new Error('Не удалось распаковать текстуры: ' + res.out.slice(0, 300))
    const src = join(tmp, 'assets', 'minecraft', 'textures')
    for (const kind of ['item', 'block']) {
      await fsp.rm(join(dir, kind), { recursive: true, force: true })
      await fsp.rename(join(src, kind), join(dir, kind))
    }
    await fsp.writeFile(metaFile(), JSON.stringify({ version, installedAt: Date.now() }))
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
  cache = null
  progress('Готово')
  return status()
}

export async function remove() {
  await fsp.rm(root(), { recursive: true, force: true })
  cache = null
}
