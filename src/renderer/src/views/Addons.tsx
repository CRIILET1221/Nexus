import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpCircle, CheckCircle2, Download, ExternalLink, Info, Package, RefreshCw, RotateCcw, Search, Trash2
} from 'lucide-react'
import type { RemoteEntry } from '@shared/types'
import { api, type AddonType, type ModVersion, type ProjectInfo, type SearchHit } from '../api'
import type { ServerAdapter } from '../adapter'
import { errText } from '../adapter'
import type { FsBackend } from '../fsBackend'
import { Switch, useAction, useToast } from '../components/ui'
import { formatBytes, formatDate, joinRemote } from '../util'
import { worldName } from '../mc/world'

/** Что и куда ставим */
export interface AddonTarget {
  type: AddonType
  /** ядро: paper / purpur / fabric / forge / … */
  loader: string
  gameVersion?: string
}

const LOADERS: Record<AddonType, { id: string; name: string; search: string[] }[]> = {
  plugin: [
    { id: 'paper', name: 'Paper', search: ['paper', 'spigot', 'bukkit'] },
    { id: 'purpur', name: 'Purpur', search: ['purpur', 'paper', 'spigot', 'bukkit'] },
    { id: 'spigot', name: 'Spigot / Bukkit', search: ['spigot', 'bukkit'] },
    { id: 'folia', name: 'Folia', search: ['folia'] }
  ],
  mod: [
    { id: 'fabric', name: 'Fabric', search: ['fabric'] },
    { id: 'quilt', name: 'Quilt', search: ['quilt', 'fabric'] },
    { id: 'forge', name: 'Forge', search: ['forge'] },
    { id: 'neoforge', name: 'NeoForge', search: ['neoforge'] }
  ],
  datapack: [{ id: 'datapack', name: 'Датапак', search: ['datapack'] }]
}

const TYPE_NAMES: Record<AddonType, { many: string; one: string; folder: string }> = {
  plugin: { many: 'Плагины', one: 'плагин', folder: 'plugins' },
  mod: { many: 'Моды', one: 'мод', folder: 'mods' },
  datapack: { many: 'Датапаки', one: 'датапак', folder: 'datapacks' }
}

const loaderOf = (t: AddonTarget) => LOADERS[t.type].find((l) => l.id === t.loader) ?? LOADERS[t.type][0]

/** Определяет тип сервера на хостинге по файлам и ответу на пинг */
export async function detectTarget(fs: FsBackend, ad: ServerAdapter): Promise<AddonTarget> {
  const [root, ping] = await Promise.all([fs.list(fs.home).catch(() => [] as RemoteEntry[]), ad.ping().catch(() => null)])
  const names = new Set(root.map((e) => e.name.toLowerCase()))
  const v = ping?.version ?? ''
  const gameVersion = /(\d+\.\d+(?:\.\d+)?)/.exec(v)?.[1]
  const libs = names.has('libraries') ? await fs.list(joinRemote(fs.home, 'libraries/net')).catch(() => [] as RemoteEntry[]) : []
  const lib = new Set(libs.map((e) => e.name))
  if (names.has('mods') || /forge|fabric|quilt/i.test(v)) {
    const loader = /neoforge/i.test(v) || lib.has('neoforged')
      ? 'neoforge'
      : /forge/i.test(v) || lib.has('minecraftforge')
        ? 'forge'
        : /quilt/i.test(v) || names.has('.quilt')
          ? 'quilt'
          : 'fabric'
    return { type: 'mod', loader, gameVersion }
  }
  if (names.has('plugins') || /paper|purpur|spigot|bukkit|folia/i.test(v)) {
    const loader = /purpur/i.test(v) ? 'purpur' : /folia/i.test(v) ? 'folia' : /paper/i.test(v) ? 'paper' : names.has('plugins') ? 'paper' : 'spigot'
    return { type: 'plugin', loader, gameVersion }
  }
  return { type: 'datapack', loader: 'datapack', gameVersion }
}

interface Installed {
  entry: RemoteEntry
  enabled: boolean
  baseName: string
  sha1?: string
  version?: ModVersion
  project?: ProjectInfo
  update?: ModVersion
}

const STORE_KEY = (k: string) => `nexus.addons.${k}`

export function AddonsView(props: {
  fs: FsBackend
  adapter: ServerAdapter
  visible: boolean
  /** известный тип сервера (у локальных); у хостинга определяется автоматически */
  preset?: AddonTarget
}) {
  const { fs, adapter: ad } = props
  const run = useAction()
  const toast = useToast()
  const [target, setTarget] = useState<AddonTarget | null>(() => {
    if (props.preset) return props.preset
    try {
      const saved = localStorage.getItem(STORE_KEY(ad.key))
      return saved ? (JSON.parse(saved) as AddonTarget) : null
    } catch {
      return null
    }
  })
  const [tab, setTab] = useState<'installed' | 'catalog'>('installed')
  const [world, setWorld] = useState('world')
  const [needRestart, setNeedRestart] = useState(false)

  // автоопределение для хостинга
  useEffect(() => {
    if (target || !props.visible) return
    detectTarget(fs, ad)
      .then(setTarget)
      .catch(() => setTarget({ type: 'plugin', loader: 'paper' }))
  }, [target, props.visible, fs, ad])

  useEffect(() => {
    if (!props.preset && target) {
      try {
        localStorage.setItem(STORE_KEY(ad.key), JSON.stringify(target))
      } catch {
        /* без сохранения */
      }
    }
  }, [target, props.preset, ad.key])

  useEffect(() => {
    if (target?.type === 'datapack') worldName(ad).then(setWorld)
  }, [target?.type, ad])

  const dir = useMemo(() => {
    if (!target) return null
    return target.type === 'datapack' ? joinRemote(fs.home, `${world}/datapacks`) : joinRemote(fs.home, TYPE_NAMES[target.type].folder)
  }, [target, fs.home, world])

  // ---------- установленные ----------

  const [items, setItems] = useState<Installed[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [identifying, setIdentifying] = useState(false)
  const [needIdentify, setNeedIdentify] = useState<number>(0)

  const isAddonFile = useCallback(
    (e: RemoteEntry) => {
      if (target?.type === 'datapack') return e.isDir || /\.zip(\.disabled)?$/i.test(e.name)
      return !e.isDir && /\.jar(\.disabled)?$/i.test(e.name)
    },
    [target?.type]
  )

  const identify = useCallback(
    async (list: Installed[]) => {
      if (!target) return
      const files = list.filter((x) => !x.entry.isDir)
      if (!files.length) return
      setIdentifying(true)
      try {
        const hashes = await fs.hash(files.map((x) => x.entry.path))
        const byHash = new Map(files.map((x, i) => [hashes[i], x]))
        const [found, upd] = await Promise.all([
          api.modrinth.identify(hashes),
          api.modrinth.updates(hashes, loaderOf(target).search, target.gameVersion).catch(() => ({}) as Record<string, ModVersion>)
        ])
        const projects = await api.modrinth.projects([...new Set(Object.values(found).map((v) => v.projectId))])
        const pmap = new Map(projects.map((p) => [p.id, p]))
        setItems((cur) =>
          (cur ?? list).map((x) => {
            const h = hashes[files.findIndex((f) => f.entry.path === x.entry.path)]
            if (!h || !byHash.has(h)) return x
            const version = found[h]
            const u = upd[h]
            return {
              ...x,
              sha1: h,
              version,
              project: version ? pmap.get(version.projectId) : undefined,
              update: u && version && u.id !== version.id && u.published > version.published ? u : undefined
            }
          })
        )
      } catch (e) {
        toast(errText(e), 'error')
      } finally {
        setIdentifying(false)
        setNeedIdentify(0)
      }
    },
    [fs, target, toast]
  )

  const loadInstalled = useCallback(
    async (autoIdentify = true) => {
      if (!dir) return
      setListError(null)
      try {
        const entries = await fs.list(dir).catch((e) => {
          if (/not exist|no such|не найден/i.test(String(e))) return [] as RemoteEntry[]
          throw e
        })
        const list = entries
          .filter(isAddonFile)
          .map((entry) => ({ entry, enabled: !/\.disabled$/i.test(entry.name), baseName: entry.name.replace(/\.disabled$/i, '') }))
          .sort((a, b) => a.baseName.localeCompare(b.baseName))
        setItems(list)
        const total = list.reduce((s, x) => s + (x.entry.isDir ? 0 : x.entry.size), 0)
        // локально хешируем всегда; на хостинге — если файлов немного (иначе придётся их скачать)
        if (autoIdentify && (fs.trash || total < 64 * 1024 * 1024)) identify(list)
        else setNeedIdentify(total)
      } catch (e) {
        setItems([])
        setListError(errText(e))
      }
    },
    [dir, fs, isAddonFile, identify]
  )

  useEffect(() => {
    if (props.visible && dir) loadInstalled()
  }, [props.visible, dir, loadInstalled])

  const installedProjects = useMemo(() => new Set((items ?? []).map((x) => x.version?.projectId).filter(Boolean) as string[]), [items])

  const toggle = async (x: Installed) => {
    const to = joinRemote(dir!, x.enabled ? x.baseName + '.disabled' : x.baseName)
    if (await run(() => fs.rename(x.entry.path, to).then(() => true), x.enabled ? `${title(x)} отключён` : `${title(x)} включён`)) {
      setNeedRestart(true)
      loadInstalled(false).then(() => setItems((cur) => cur?.map((c) => (c.baseName === x.baseName ? { ...c, version: x.version, project: x.project, update: x.update, sha1: x.sha1 } : c)) ?? null))
    }
  }

  const remove = async (x: Installed) => {
    const ok = await api.dialog.confirm({
      title: 'Удаление',
      message: `Удалить ${title(x)}?`,
      detail: fs.trash ? 'Файл попадёт в корзину Windows.' : 'Файл будет удалён с сервера. Его настройки (папка конфига) останутся.',
      ok: 'Удалить',
      danger: true
    })
    if (!ok) return
    if (await run(() => fs.remove([x.entry.path]).then(() => true), `${title(x)} удалён`)) {
      setNeedRestart(true)
      setItems((cur) => cur?.filter((c) => c.entry.path !== x.entry.path) ?? null)
    }
  }

  // ---------- установка ----------

  const [busy, setBusy] = useState<Record<string, string>>({})

  const putVersion = async (v: ModVersion) => {
    const tmp = await api.modrinth.downloadTemp(v.file)
    try {
      await fs.mkdir(dir!).catch(() => undefined)
      await fs.upload([tmp], dir!)
    } finally {
      api.modrinth.cleanupTemp(tmp)
    }
  }

  const pickVersion = async (projectId: string): Promise<ModVersion | null> => {
    const list = await api.modrinth.versions(projectId, loaderOf(target!).search, target!.gameVersion)
    return list.find((v) => v.type === 'release') ?? list[0] ?? null
  }

  /** ставит проект и его обязательные зависимости */
  const install = async (projectId: string, name: string) => {
    if (!target || !dir) return
    setBusy((b) => ({ ...b, [projectId]: 'Ищу версию…' }))
    try {
      const v = await pickVersion(projectId)
      if (!v) throw new Error(`У «${name}» нет версии для ${loaderOf(target).name}${target.gameVersion ? ' ' + target.gameVersion : ''}`)
      const have = new Set(installedProjects)
      const queue: ModVersion[] = [v]
      const extra: string[] = []
      // обязательные зависимости (на 2 уровня вглубь)
      for (let depth = 0, cur = [v]; depth < 2 && cur.length; depth++) {
        const next: ModVersion[] = []
        for (const dep of cur.flatMap((x) => x.dependencies.filter((d) => d.type === 'required'))) {
          if (dep.projectId && (have.has(dep.projectId) || queue.some((q) => q.projectId === dep.projectId))) continue
          const dv = dep.versionId ? await api.modrinth.version(dep.versionId) : dep.projectId ? await pickVersion(dep.projectId) : null
          if (dv && !queue.some((q) => q.projectId === dv.projectId) && !have.has(dv.projectId)) {
            queue.push(dv)
            next.push(dv)
          }
        }
        cur = next
      }
      if (queue.length > 1) {
        const names = await api.modrinth.projects(queue.slice(1).map((q) => q.projectId))
        extra.push(...names.map((p) => p.title))
      }
      for (let i = 0; i < queue.length; i++) {
        setBusy((b) => ({ ...b, [projectId]: queue.length > 1 ? `Скачиваю ${i + 1}/${queue.length}…` : 'Скачиваю…' }))
        await putVersion(queue[i])
      }
      toast(`Установлено: ${name}${extra.length ? ` + зависимости: ${extra.join(', ')}` : ''}`, 'success')
      setNeedRestart(true)
      loadInstalled()
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy((b) => {
        const n = { ...b }
        delete n[projectId]
        return n
      })
    }
  }

  const update = async (x: Installed) => {
    if (!x.update) return
    const key = x.entry.path
    setBusy((b) => ({ ...b, [key]: 'Обновляю…' }))
    try {
      await putVersion(x.update)
      if (x.update.file.filename !== x.entry.name) await fs.remove([x.entry.path])
      toast(`${title(x)} обновлён до ${x.update.number}`, 'success')
      setNeedRestart(true)
      loadInstalled()
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy((b) => {
        const n = { ...b }
        delete n[key]
        return n
      })
    }
  }

  const updateAll = async () => {
    for (const x of (items ?? []).filter((i) => i.update)) await update(x)
  }

  if (!target) {
    return (
      <div className="view">
        <div className="empty-row" style={{ padding: 40, textAlign: 'center' }}>
          <span className="spinner" style={{ display: 'inline-block', verticalAlign: -3 }} /> Определяю тип сервера…
        </div>
      </div>
    )
  }

  const names = TYPE_NAMES[target.type]
  const updatesCount = (items ?? []).filter((i) => i.update).length

  return (
    <div className="view">
      <div className="view-narrow">
        {/* тип сервера */}
        <div className="addon-target card">
          <Package size={18} />
          {props.preset ? (
            <span>
              <b>{names.many}</b> для {loaderOf(target).name}
              {target.gameVersion ? ` ${target.gameVersion}` : ''}
            </span>
          ) : (
            <>
              <div className="seg">
                {(['plugin', 'mod', 'datapack'] as AddonType[]).map((t) => (
                  <button key={t} className={target.type === t ? 'on' : ''} onClick={() => setTarget({ ...target, type: t, loader: LOADERS[t][0].id })}>
                    {TYPE_NAMES[t].many}
                  </button>
                ))}
              </div>
              {target.type !== 'datapack' && (
                <select className="select" style={{ width: 150 }} value={target.loader} onChange={(e) => setTarget({ ...target, loader: e.target.value })}>
                  {LOADERS[target.type].map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="input mono"
                style={{ width: 110 }}
                placeholder="версия"
                title="Версия Minecraft (например 1.21.4)"
                value={target.gameVersion ?? ''}
                onChange={(e) => setTarget({ ...target, gameVersion: e.target.value.trim() || undefined })}
              />
            </>
          )}
          <div className="spacer" />
          <span className="muted mono" style={{ fontSize: 12 }}>
            {dir}
          </span>
        </div>

        {needRestart && (
          <div className="callout warn" style={{ marginBottom: 14, alignItems: 'center' }}>
            <Info size={16} />
            <span style={{ flex: 1 }}>
              {ad.canCommand ? 'Изменения вступят в силу после перезапуска сервера.' : 'Изменения применятся при следующем запуске сервера.'}
            </span>
            {ad.restart && ad.canCommand && (
              <button className="btn sm" onClick={() => run(() => ad.restart!().then(() => setNeedRestart(false)), 'Сервер перезапускается')}>
                <RotateCcw size={13} /> Перезапустить
              </button>
            )}
          </div>
        )}

        <div className="pp-bar">
          <div className="subtabs" style={{ margin: 0 }}>
            <button className={tab === 'installed' ? 'on' : ''} onClick={() => setTab('installed')}>
              <CheckCircle2 size={14} /> Установленные {items && <span className="badge">{items.length}</span>}
            </button>
            <button className={tab === 'catalog' ? 'on' : ''} onClick={() => setTab('catalog')}>
              <Search size={14} /> Каталог Modrinth
            </button>
          </div>
          <div className="spacer" />
          {tab === 'installed' && (
            <>
              {updatesCount > 0 && (
                <button className="btn sm primary" onClick={updateAll}>
                  <ArrowUpCircle size={13} /> Обновить всё ({updatesCount})
                </button>
              )}
              <button className="btn sm ghost" onClick={() => loadInstalled()} disabled={identifying}>
                {identifying ? <span className="spinner" /> : <RefreshCw size={13} />} Обновить список
              </button>
            </>
          )}
        </div>

        {tab === 'installed' ? (
          <>
            {needIdentify > 0 && !identifying && (
              <div className="callout" style={{ marginBottom: 12, alignItems: 'center' }}>
                <Info size={16} />
                <span style={{ flex: 1 }}>
                  Чтобы узнать названия и проверить обновления, Nexus прочитает файлы с сервера ({formatBytes(needIdentify)}).
                </span>
                <button className="btn sm" onClick={() => identify(items ?? [])}>
                  Проверить
                </button>
              </div>
            )}
            <div className="rows">
              {listError ? (
                <div className="empty-row">{listError}</div>
              ) : items === null ? (
                <div className="empty-row">Загрузка…</div>
              ) : items.length === 0 ? (
                <div className="empty-row">
                  {names.many} не установлены.{' '}
                  <a className="link" onClick={() => setTab('catalog')}>
                    Открыть каталог
                  </a>
                </div>
              ) : (
                items.map((x) => (
                  <div className={`r addon-row${x.enabled ? '' : ' off'}`} key={x.entry.path}>
                    <AddonIcon url={x.project?.icon} name={title(x)} />
                    <div className="main">
                      <b>
                        {title(x)}
                        {x.version && <span className="muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12.5 }}>{x.version.number}</span>}
                        {!x.enabled && <span className="badge" style={{ marginLeft: 8 }}>отключён</span>}
                        {x.update && (
                          <span className="badge green" style={{ marginLeft: 8 }} title={`Доступна версия ${x.update.number}`}>
                            обновление {x.update.number}
                          </span>
                        )}
                      </b>
                      <span className="mono">
                        {x.entry.name}
                        {!x.entry.isDir && ` · ${formatBytes(x.entry.size)}`}
                        {identifying && !x.version && ' · определяю…'}
                      </span>
                    </div>
                    <div className="acts">
                      {busy[x.entry.path] ? (
                        <span className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                          <span className="spinner" style={{ width: 13, height: 13 }} /> {busy[x.entry.path]}
                        </span>
                      ) : (
                        x.update && (
                          <button className="btn sm" onClick={() => update(x)}>
                            <ArrowUpCircle size={13} /> Обновить
                          </button>
                        )
                      )}
                      {x.project && (
                        <button className="btn sm ghost icon" title="Страница на Modrinth" onClick={() => api.fs.openExternal(`https://modrinth.com/project/${x.project!.slug}`)}>
                          <ExternalLink size={13} />
                        </button>
                      )}
                      <span title={x.enabled ? 'Отключить' : 'Включить'} style={{ display: 'flex', alignItems: 'center' }}>
                        <Switch checked={x.enabled} onChange={() => toggle(x)} />
                      </span>
                      <button className="btn sm ghost icon danger" title="Удалить" onClick={() => remove(x)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <Catalog target={target} installed={installedProjects} busy={busy} onInstall={install} />
        )}
      </div>
    </div>
  )
}

function title(x: Installed) {
  return x.project?.title ?? x.baseName.replace(/\.(jar|zip)$/i, '').replace(/[-_](\d[\w.+-]*)$/, '')
}

function AddonIcon({ url, name, size = 34 }: { url?: string; name: string; size?: number }) {
  const [err, setErr] = useState(false)
  if (url && !err) return <img className="addon-icon" src={url} alt="" style={{ width: size, height: size }} onError={() => setErr(true)} />
  return (
    <div className="addon-icon fallback" style={{ width: size, height: size }}>
      <Package size={size * 0.5} />
    </div>
  )
}

const fmtNum = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} млн` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} тыс` : String(n)

function Catalog(props: {
  target: AddonTarget
  installed: Set<string>
  busy: Record<string, string>
  onInstall: (projectId: string, name: string) => void
}) {
  const { target } = props
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<'relevance' | 'downloads' | 'updated'>('relevance')
  const [res, setRes] = useState<{ hits: SearchHit[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)
  const reqId = useRef(0)

  useEffect(() => {
    const id = ++reqId.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.modrinth.search({
          query: query.trim(),
          type: target.type,
          loaders: loaderOf(target).search,
          gameVersion: target.gameVersion,
          index: query.trim() ? index : index === 'relevance' ? 'downloads' : index,
          offset
        })
        if (id !== reqId.current) return
        setRes((prev) => (offset > 0 && prev ? { total: r.total, hits: [...prev.hits, ...r.hits] } : r))
        setError(null)
      } catch (e) {
        if (id === reqId.current) setError(errText(e))
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [query, index, offset, target])

  useEffect(() => setOffset(0), [query, index, target])

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="input-icon" style={{ flex: 1 }}>
          <Search size={14} />
          <input className="input" autoFocus placeholder={`Поиск: ${TYPE_NAMES[target.type].one}…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" style={{ width: 170 }} value={index} onChange={(e) => setIndex(e.target.value as typeof index)}>
          <option value="relevance">По релевантности</option>
          <option value="downloads">По скачиваниям</option>
          <option value="updated">Недавно обновлённые</option>
        </select>
      </div>
      {!target.gameVersion && (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <Info size={16} />
          <span>Версия Minecraft не определена — в выдаче могут быть несовместимые версии. Укажите её в поле выше.</span>
        </div>
      )}
      {error ? (
        <div className="callout danger">
          <Info size={16} />
          <span>{error}</span>
        </div>
      ) : !res ? (
        <div className="empty-row" style={{ padding: 30, textAlign: 'center' }}>
          <span className="spinner" style={{ display: 'inline-block', verticalAlign: -3 }} /> Загрузка каталога…
        </div>
      ) : res.hits.length === 0 ? (
        <div className="empty-row" style={{ padding: 30, textAlign: 'center' }}>
          Ничего не найдено для {loaderOf(target).name}
          {target.gameVersion ? ` ${target.gameVersion}` : ''}
        </div>
      ) : (
        <>
          <div className="addon-grid">
            {res.hits.map((h) => {
              const inst = props.installed.has(h.id)
              const busy = props.busy[h.id]
              return (
                <div className="card addon-card" key={h.id}>
                  <AddonIcon url={h.icon} name={h.title} size={48} />
                  <div className="ab">
                    <div className="t">
                      <b title={h.title}>{h.title}</b>
                      <span className="muted">от {h.author}</span>
                    </div>
                    <div className="d">{h.description}</div>
                    <div className="m muted">
                      <Download size={12} /> {fmtNum(h.downloads)} · обновлён {formatDate(Date.parse(h.updated)).split(',')[0]}
                    </div>
                  </div>
                  <div className="a">
                    {busy ? (
                      <button className="btn sm" disabled>
                        <span className="spinner" /> {busy}
                      </button>
                    ) : inst ? (
                      <span className="badge green">
                        <CheckCircle2 size={12} /> установлен
                      </span>
                    ) : (
                      <button className="btn sm primary" onClick={() => props.onInstall(h.id, h.title)}>
                        <Download size={13} /> Установить
                      </button>
                    )}
                    <button className="btn sm ghost icon" title="Открыть на Modrinth" onClick={() => api.fs.openExternal(`https://modrinth.com/project/${h.slug}`)}>
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {res.hits.length < res.total && (
            <div style={{ textAlign: 'center', margin: '14px 0' }}>
              <button className="btn" disabled={loading} onClick={() => setOffset(res.hits.length)}>
                {loading && <span className="spinner" />} Показать ещё
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
