import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowUp, CheckCircle2, Copy, Download, Edit3, File, FileArchive, FileCog, FileImage, FilePlus, FileText,
  Folder, FolderOpen, FolderPlus, FolderUp, Home, Link2, Package, PackageOpen, RefreshCw, ScrollText, SquareTerminal, Trash2, Upload, XCircle
} from 'lucide-react'
import type { RemoteEntry, TransferInfo } from '@shared/types'
import type { FsBackend } from '../fsBackend'
import { api } from '../api'
import { ContextMenu, PromptModal, useAction, useToast, type MenuItem } from '../components/ui'
import { EditorModal } from '../components/Editor'
import { formatBytes, formatDate, formatMode, isProbablyBinary, joinRemote, parentDir } from '../util'
import { tr } from '@shared/i18n'

type SortKey = 'name' | 'size' | 'mtime'

function FileIcon({ e }: { e: RemoteEntry }) {
  if (e.isDir) return <Folder size={17} className="ficon dir" fill="currentColor" fillOpacity={0.18} />
  const ext = e.name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'jar') return <Package size={17} className="ficon jar" />
  if (['yml', 'yaml', 'json', 'properties', 'toml', 'conf', 'cfg', 'ini'].includes(ext)) return <FileCog size={17} className="ficon cfg" />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) return <FileImage size={17} className="ficon img" />
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return <FileArchive size={17} className="ficon arc" />
  if (ext === 'log') return <ScrollText size={17} className="ficon log" />
  if (['txt', 'md', 'sh', 'bat', 'js', 'ts', 'mcfunction', 'xml'].includes(ext)) return <FileText size={17} className="ficon file" />
  return <File size={17} className="ficon file" />
}

const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz|gz|tar\.bz2|tbz2|tar\.xz|txz|rar|7z)$/i

export function FileManager(props: { fs: FsBackend; active: boolean; onOpenConsole?: () => void }) {
  const fsb = props.fs
  const arc = fsb.archive
  const sid = fsb.key
  const home = fsb.home
  // права доступа имеют смысл только на Linux-сервере
  const showMode = !fsb.reveal
  const toast = useToast()
  const run = useAction()
  const [path, setPath] = useState(home)
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [editPath, setEditPath] = useState<string | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [prompt, setPrompt] = useState<null | { kind: 'mkdir' | 'newfile' | 'rename'; entry?: RemoteEntry }>(null)
  const [editing, setEditing] = useState<RemoteEntry | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<Record<string, TransferInfo>>({})
  const dragDepth = useRef(0)

  const load = useCallback(
    async (dir: string, keepSelection = false) => {
      setLoading(true)
      setError(null)
      try {
        const list = await fsb.list(dir)
        setEntries(list)
        setPath(dir)
        if (!keepSelection) setSelected(new Set())
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        if (dir !== path) toast(e instanceof Error ? e.message : String(e), 'error')
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fsb]
  )

  useEffect(() => {
    load(home)
  }, [load, home])

  const pathRef = useRef(path)
  pathRef.current = path

  useEffect(() => {
    const off1 = api.on('transfer:update', (t: TransferInfo) => {
      if (t.sessionId === sid) setTransfers((m) => ({ ...m, [t.id]: t }))
    })
    const off2 = api.on('sftp:changed', (e: { sessionId: string; dir: string }) => {
      if (e.sessionId === sid && e.dir === pathRef.current) load(pathRef.current, true)
    })
    return () => {
      off1()
      off2()
    }
  }, [sid, load])

  const sorted = useMemo(() => {
    const k = sort.key
    const m = sort.asc ? 1 : -1
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      if (k === 'name') return m * a.name.localeCompare(b.name, 'ru', { numeric: true })
      return m * ((a[k] as number) - (b[k] as number)) || a.name.localeCompare(b.name)
    })
  }, [entries, sort])

  const selEntries = sorted.filter((e) => selected.has(e.path))

  // ---------- Действия ----------

  const open = (e: RemoteEntry) => {
    if (e.isDir) load(e.path)
    else if (isProbablyBinary(e.name)) toast(tr('Бинарный файл нельзя открыть в редакторе — скачайте его'), 'info')
    else setEditing(e)
  }

  const uploadPaths = async (locals: string[], dir = path) => {
    if (!locals.length) return
    await run(() => fsb.upload(locals, dir))
  }

  const pickUpload = async (directories: boolean) => {
    const files = await api.dialog.open({ multi: true, directories, title: directories ? tr('Загрузить папки') : tr('Загрузить файлы') })
    uploadPaths(files)
  }

  const download = async (list: RemoteEntry[]) => {
    if (!list.length) return
    const [dir] = await api.dialog.open({ directories: true, title: tr('Куда сохранить') })
    if (dir) await run(() => fsb.download(list.map((e) => e.path), dir))
  }

  const remove = async (list: RemoteEntry[]) => {
    if (!list.length) return
    const ok = await api.dialog.confirm({
      title: tr('Удаление'),
      message: list.length === 1 ? tr('Удалить «{0}»?', list[0].name) : tr('Удалить выбранные объекты ({0})?', list.length),
      detail: fsb.trash
        ? tr('Файлы попадут в корзину Windows — их можно будет восстановить.')
        : list.some((e) => e.isDir)
          ? tr('Папки будут удалены вместе со всем содержимым. Это действие нельзя отменить.')
          : tr('Это действие нельзя отменить.'),
      ok: tr('Удалить'),
      danger: true
    })
    if (!ok) return
    await run(() => fsb.remove(list.map((e) => e.path)), tr('Удалено'))
    load(path)
  }

  // ---------- Архивы на сервере (через API панели) ----------

  const [archiving, setArchiving] = useState<string | null>(null)
  const [pullOpen, setPullOpen] = useState(false)

  const decompress = async (e: RemoteEntry) => {
    if (!arc) return
    setArchiving(tr('Распаковка {0}…', e.name))
    await run(() => arc.decompress(path, e.name), tr('Архив {0} распакован', e.name))
    setArchiving(null)
    load(path, true)
  }

  const compress = async (list: RemoteEntry[]) => {
    if (!arc || !list.length) return
    setArchiving(tr('Архивация ({0})…', list.length))
    const res = await run(
      () => arc.compress(path, list.map((e) => e.name)),
      tr('Архив создан')
    )
    setArchiving(null)
    await load(path, true)
    if (res) setSelected(new Set([joinRemote(path, res)]))
  }

  const pull = async (url: string) => {
    if (!arc) return
    const ok = await run(
      () => arc.pull(url.trim(), path).then(() => true),
      tr('Скачивание запущено на сервере — файл появится через некоторое время')
    )
    if (ok) {
      setPullOpen(false)
      setTimeout(() => load(pathRef.current, true), 3000)
    }
  }

  const copyPath = (e: RemoteEntry) => {
    navigator.clipboard.writeText(e.path)
    toast(tr('Путь скопирован'), 'success')
  }

  // ---------- Выделение ----------

  const onRowClick = (ev: MouseEvent, e: RemoteEntry) => {
    if (ev.shiftKey && anchor) {
      const a = sorted.findIndex((x) => x.path === anchor)
      const b = sorted.findIndex((x) => x.path === e.path)
      const [from, to] = a < b ? [a, b] : [b, a]
      setSelected(new Set(sorted.slice(from, to + 1).map((x) => x.path)))
    } else if (ev.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(e.path)) n.delete(e.path)
        else n.add(e.path)
        return n
      })
      setAnchor(e.path)
    } else {
      setSelected(new Set([e.path]))
      setAnchor(e.path)
    }
  }

  const onRowContext = (ev: MouseEvent, e: RemoteEntry) => {
    ev.preventDefault()
    ev.stopPropagation()
    let list = selEntries
    if (!selected.has(e.path)) {
      setSelected(new Set([e.path]))
      setAnchor(e.path)
      list = [e]
    }
    const single = list.length === 1
    setCtx({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: e.isDir ? tr('Открыть') : tr('Редактировать'), icon: e.isDir ? <Folder size={15} /> : <Edit3 size={15} />, kbd: 'Enter', onClick: () => open(e), hidden: !single },
        { label: list.length > 1 ? tr('Скачать ({0})', list.length) : tr('Скачать'), icon: <Download size={15} />, onClick: () => download(list) },
        { label: tr('Загрузить сюда'), icon: <Upload size={15} />, onClick: () => api.dialog.open({ multi: true }).then((f) => uploadPaths(f, e.path)), hidden: !(single && e.isDir) },
        { separator: true, hidden: !arc },
        { label: tr('Распаковать здесь'), icon: <PackageOpen size={15} />, onClick: () => decompress(e), hidden: !(arc && single && !e.isDir && ARCHIVE_RE.test(e.name)) },
        { label: list.length > 1 ? tr('Запаковать в архив ({0})', list.length) : tr('Запаковать в архив'), icon: <FileArchive size={15} />, onClick: () => compress(list), hidden: !arc },
        { separator: true },
        { label: tr('Переименовать'), icon: <Edit3 size={15} />, kbd: 'F2', onClick: () => setPrompt({ kind: 'rename', entry: e }), hidden: !single },
        { label: tr('Копировать путь'), icon: <Copy size={15} />, onClick: () => copyPath(e), hidden: !single },
        { label: tr('Показать в проводнике'), icon: <FolderOpen size={15} />, onClick: () => fsb.reveal?.(e.path), hidden: !(single && fsb.reveal) },
        { separator: true },
        { label: list.length > 1 ? tr('Удалить ({0})', list.length) : tr('Удалить'), icon: <Trash2 size={15} />, kbd: 'Del', danger: true, onClick: () => remove(list) }
      ]
    })
  }

  const onBgContext = (ev: MouseEvent) => {
    ev.preventDefault()
    setSelected(new Set())
    setCtx({
      x: ev.clientX,
      y: ev.clientY,
      items: [
        { label: tr('Загрузить файлы'), icon: <Upload size={15} />, onClick: () => pickUpload(false) },
        { label: tr('Загрузить папку'), icon: <FolderUp size={15} />, onClick: () => pickUpload(true) },
        { separator: true },
        { label: tr('Новая папка'), icon: <FolderPlus size={15} />, onClick: () => setPrompt({ kind: 'mkdir' }) },
        { label: tr('Новый файл'), icon: <FilePlus size={15} />, onClick: () => setPrompt({ kind: 'newfile' }) },
        { label: tr('Скачать на сервер по ссылке'), icon: <Link2 size={15} />, onClick: () => setPullOpen(true), hidden: !arc },
        { separator: true },
        { label: tr('Обновить'), icon: <RefreshCw size={15} />, kbd: 'F5', onClick: () => load(path, true) }
      ]
    })
  }

  // ---------- Клавиатура ----------

  useEffect(() => {
    if (!props.active || prompt || editing) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.key === 'F5') {
        e.preventDefault()
        load(path, true)
      } else if (e.key === 'Delete') remove(selEntries)
      else if (e.key === 'F2' && selEntries.length === 1) setPrompt({ kind: 'rename', entry: selEntries[0] })
      else if (e.key === 'Enter' && selEntries.length === 1) open(selEntries[0])
      else if (e.key === 'Backspace') load(parentDir(path))
      else if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(new Set(entries.map((x) => x.path)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---------- Drag & drop из проводника ----------

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current++
    setDragOver(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current--
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragOver(false)
      setDropTarget(null)
    }
  }
  const onDrop = (e: DragEvent, targetDir?: string) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragOver(false)
    setDropTarget(null)
    const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean)
    uploadPaths(paths, targetDir ?? path)
  }

  // ---------- Хлебные крошки ----------

  const crumbs = useMemo(() => {
    const parts = path.split('/').filter(Boolean)
    return [{ name: '/', path: '/' }, ...parts.map((p, i) => ({ name: p, path: '/' + parts.slice(0, i + 1).join('/') }))]
  }, [path])

  const transferList = Object.values(transfers)
  const activeTransfers = transferList.filter((t) => t.state === 'active').length
  const totalSize = entries.filter((e) => !e.isDir).reduce((s, e) => s + e.size, 0)

  const sortBy = (key: SortKey) => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))
  const arrow = (key: SortKey) => (sort.key === key ? (sort.asc ? ' ↑' : ' ↓') : '')

  return (
    <>
      <div className="fm-toolbar">
        <button className="btn icon" title={tr('Вверх (Backspace)')} onClick={() => load(parentDir(path))} disabled={path === '/'}>
          <ArrowUp size={16} />
        </button>
        <button className="btn icon" title={tr('Домашняя папка')} onClick={() => load(home)}>
          <Home size={16} />
        </button>
        <button className="btn icon" title={tr('Обновить (F5)')} onClick={() => load(path, true)}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} style={loading ? { animation: 'spin .8s linear infinite' } : undefined} />
        </button>
        <div className="crumbs" onClick={() => editPath === null && setEditPath(path)}>
          {editPath !== null ? (
            <input
              autoFocus
              value={editPath}
              onChange={(e) => setEditPath(e.target.value)}
              onBlur={() => setEditPath(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  load(editPath.trim() || '/')
                  setEditPath(null)
                } else if (e.key === 'Escape') setEditPath(null)
              }}
            />
          ) : (
            crumbs.map((c, i) => (
              <span key={c.path} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 1 && <span className="sep">/</span>}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    load(c.path)
                  }}
                >
                  {c.name}
                </button>
              </span>
            ))
          )}
        </div>
        <button className="btn" onClick={() => setPrompt({ kind: 'mkdir' })} title={tr('Новая папка')}>
          <FolderPlus size={16} />
        </button>
        <button className="btn" onClick={() => setPrompt({ kind: 'newfile' })} title={tr('Новый файл')}>
          <FilePlus size={16} />
        </button>
        <button className="btn" onClick={() => download(selEntries)} disabled={!selEntries.length} title={tr('Скачать выбранное')}>
          <Download size={16} />
        </button>
        {arc && (
          <>
            {selEntries.length === 1 && !selEntries[0].isDir && ARCHIVE_RE.test(selEntries[0].name) ? (
              <button className="btn" onClick={() => decompress(selEntries[0])} disabled={!!archiving} title={tr('Распаковать архив на сервере')}>
                <PackageOpen size={16} />
              </button>
            ) : (
              <button className="btn" onClick={() => compress(selEntries)} disabled={!selEntries.length || !!archiving} title={tr('Запаковать выбранное в архив на сервере')}>
                <FileArchive size={16} />
              </button>
            )}
            <button className="btn" onClick={() => setPullOpen(true)} title={tr('Скачать файл на сервер по ссылке')}>
              <Link2 size={16} />
            </button>
          </>
        )}
        <button className="btn primary" onClick={() => pickUpload(false)}>
          <Upload size={16} />{' '}{tr('Загрузить')}
        </button>
        {props.onOpenConsole && (
          <button className="btn icon" title={tr('Консоль')} onClick={props.onOpenConsole}>
            <SquareTerminal size={16} />
          </button>
        )}
      </div>

      <div
        className="fm-list"
        onContextMenu={onBgContext}
        onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDrop={(e) => onDrop(e)}
      >
        {error && !entries.length ? (
          <div className="empty-state">
            <XCircle size={28} color="var(--danger)" />
            <h3>{tr('Не удалось открыть папку')}</h3>
            <div>{error}</div>
            <button className="btn" onClick={() => load(home)}>
              {tr('Вернуться домой')}
            </button>
          </div>
        ) : (
          <table className="fm-table">
            <colgroup>
              <col />
              <col style={{ width: 110 }} />
              <col style={{ width: 160 }} />
              {showMode && <col style={{ width: 110 }} />}
            </colgroup>
            <thead>
              <tr>
                <th onClick={() => sortBy('name')}>{tr('Имя')}{arrow('name')}</th>
                <th onClick={() => sortBy('size')} style={{ textAlign: 'right' }}>
                  {tr('Размер')}{arrow('size')}
                </th>
                <th onClick={() => sortBy('mtime')}>{tr('Изменён')}{arrow('mtime')}</th>
                {showMode && <th>{tr('Права')}</th>}
              </tr>
            </thead>
            <tbody>
              {path !== '/' && (
                <tr className="item" onDoubleClick={() => load(parentDir(path))}>
                  <td>
                    <div className="name">
                      <Folder size={17} className="ficon dir" />
                      <span>..</span>
                    </div>
                  </td>
                  <td />
                  <td />
                  {showMode && <td />}
                </tr>
              )}
              {sorted.map((e) => (
                <tr
                  key={e.path}
                  className={`item ${selected.has(e.path) || dropTarget === e.path ? 'sel' : ''}`}
                  onClick={(ev) => onRowClick(ev, e)}
                  onDoubleClick={() => open(e)}
                  onContextMenu={(ev) => onRowContext(ev, e)}
                  onDragOver={(ev) => {
                    if (e.isDir && hasFiles(ev)) {
                      ev.preventDefault()
                      setDropTarget(e.path)
                    }
                  }}
                  onDrop={(ev) => e.isDir && onDrop(ev, e.path)}
                >
                  <td>
                    <div className="name">
                      <FileIcon e={e} />
                      <span>{e.name}</span>
                      {e.isLink && <span className="badge">{tr('ссылка')}</span>}
                    </div>
                  </td>
                  <td className="num">{e.isDir ? '' : formatBytes(e.size)}</td>
                  <td className="muted">{formatDate(e.mtime)}</td>
                  {showMode && <td className="dim">{formatMode(e.mode)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!error && !loading && entries.length === 0 && (
          <div className="empty-state">
            <FolderUp size={28} />
            <div>{tr('Папка пуста — перетащите сюда файлы из проводника')}</div>
          </div>
        )}
        {dragOver && (
          <div className="drop-zone">
            <div>
              <Upload size={32} />
              {dropTarget ? tr('Загрузить в «{0}»', dropTarget.split('/').pop()) : tr('Отпустите, чтобы загрузить в {0}', path)}
            </div>
          </div>
        )}
      </div>

      {transferList.length > 0 && (
        <div className="transfers">
          <div className="transfers-head">
            {activeTransfers ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <CheckCircle2 size={14} color="var(--accent)" />}
            <b>{tr('Передачи')}</b>
            <span className="muted">{activeTransfers ? tr('{0} в процессе', activeTransfers) : tr('все завершены')}</span>
            <div className="spacer" />
            <button
              className="btn ghost sm"
              onClick={() => setTransfers((m) => Object.fromEntries(Object.entries(m).filter(([, t]) => t.state === 'active')))}
            >
              {tr('Очистить завершённые')}
            </button>
          </div>
          <div className="transfers-list">
            {transferList
              .slice()
              .reverse()
              .map((t) => {
                const pct = t.total ? Math.min(100, (t.transferred / t.total) * 100) : t.state === 'done' ? 100 : 0
                return (
                  <div key={t.id} className="transfer">
                    {t.kind === 'upload' ? <Upload size={15} color="var(--accent)" /> : <Download size={15} color="var(--blue)" />}
                    <div>
                      <div className="meta">
                        <span>
                          {t.name}
                          {t.stage && t.state === 'active' && <span className="muted"> · {t.stage}</span>}
                        </span>
                        <span>
                          {t.state === 'error' ? (
                            <span style={{ color: 'var(--danger)' }}>{t.error}</span>
                          ) : (
                            <>
                              {t.state === 'active' && t.speed ? `${formatBytes(t.speed)}/${tr('с')} · ` : ''}
                              {`${formatBytes(t.transferred)} / ${formatBytes(t.total)}`}
                            </>
                          )}
                        </span>
                      </div>
                      <div className={`progress ${t.state === 'error' ? 'error' : ''}`}>
                        <div style={{ width: `${t.state === 'error' ? 100 : pct}%` }} />
                      </div>
                    </div>
                    <span className="muted" style={{ textAlign: 'right' }}>
                      {t.state === 'done' ? tr('Готово') : t.state === 'error' ? tr('Ошибка') : `${pct.toFixed(0)}%`}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      <div className="fm-status">
        <span>
          {entries.filter((e) => e.isDir).length}{' '}{tr('папок ·')}{' '}{entries.filter((e) => !e.isDir).length}{' '}{tr('файлов ·')}{' '}{formatBytes(totalSize)}
        </span>
        {selected.size > 0 && <span>{tr('Выбрано:')}{' '}{selected.size}</span>}
        <div className="spacer" />
        {archiving ? (
          <span style={{ color: 'var(--warn)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="spinner" style={{ width: 11, height: 11 }} /> {archiving}
          </span>
        ) : (
          <span>{arc ? arc.hint : tr('Перетащите файлы из проводника для загрузки')}</span>
        )}
      </div>

      {ctx && <ContextMenu {...ctx} onClose={() => setCtx(null)} />}

      {prompt && (
        <PromptModal
          title={prompt.kind === 'mkdir' ? tr('Новая папка') : prompt.kind === 'newfile' ? tr('Новый файл') : tr('Переименовать')}
          label={tr('Имя')}
          initial={prompt.kind === 'rename' ? prompt.entry!.name : ''}
          okText={prompt.kind === 'rename' ? tr('Переименовать') : tr('Создать')}
          onClose={() => setPrompt(null)}
          onSubmit={async (name) => {
            name = name.trim()
            if (name.includes('/')) {
              toast(tr('Имя не должно содержать «/»'), 'error')
              return
            }
            const target = joinRemote(path, name)
            const ok = await run(async () => {
              if (prompt.kind === 'mkdir') await fsb.mkdir(target)
              else if (prompt.kind === 'newfile') await fsb.writeText(target, '')
              else await fsb.rename(prompt.entry!.path, target)
              return true
            })
            if (ok) {
              setPrompt(null)
              await load(path, true)
              setSelected(new Set([target]))
            }
          }}
        />
      )}

      {pullOpen && (
        <PromptModal
          title={tr('Скачать файл на сервер')}
          label={tr('Ссылка на файл — он сохранится в {0}', path)}
          okText={tr('Скачать')}
          onClose={() => setPullOpen(false)}
          onSubmit={pull}
          extra={<div className="muted" style={{ fontSize: 12 }}>{tr('Например, прямая ссылка на плагин или мод (.jar). Некоторые хостинги отключают эту функцию.')}</div>}
        />
      )}

      {editing && (
        <EditorModal
          title={editing.name}
          path={editing.path}
          load={() => fsb.readText(editing.path)}
          save={(content) => fsb.writeText(editing.path, content)}
          onClose={() => {
            setEditing(null)
            load(path, true)
          }}
        />
      )}
    </>
  )
}
