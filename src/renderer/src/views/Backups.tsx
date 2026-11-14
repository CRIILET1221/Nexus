import { useCallback, useEffect, useState } from 'react'
import { Archive, Download, FolderOpen, Lock, Plus, RefreshCw, RotateCcw, Trash2, Unlock } from 'lucide-react'
import type { LocalBackup } from '@shared/types'
import { api } from '../api'
import { errText, usePanelServer } from '../adapter'
import { Modal, useAction, useToast } from '../components/ui'
import { formatBytes, formatDate, uid } from '../util'

interface PanelBackup {
  uuid: string
  name: string
  bytes: number
  created: number
  completed: number | null
  ok: boolean
  locked: boolean
  ignored: string
}

// ---------- Бэкапы на хостинге ----------

export function PanelBackups(props: { profileId: string; visible: boolean }) {
  const run = useAction()
  const toast = useToast()
  const { info } = usePanelServer(props.profileId)
  const [list, setList] = useState<PanelBackup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, { name: string; transferred: number; total: number; done?: boolean; error?: string }>>({})

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(props.profileId, 'GET', '/backups?per_page=100')
      setList(
        res.data.map((b: any) => ({
          uuid: b.attributes.uuid,
          name: b.attributes.name,
          bytes: b.attributes.bytes,
          created: Date.parse(b.attributes.created_at),
          completed: b.attributes.completed_at ? Date.parse(b.attributes.completed_at) : null,
          ok: b.attributes.is_successful,
          locked: b.attributes.is_locked,
          ignored: (b.attributes.ignored_files ?? []).join('\n')
        }))
      )
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [props.profileId])

  useEffect(() => {
    if (props.visible) load()
  }, [props.visible, load])

  // пока бэкап создаётся — обновляем список
  const pending = list?.some((b) => !b.completed)
  useEffect(() => {
    if (!props.visible || !pending) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [props.visible, pending, load])

  useEffect(
    () =>
      api.on('download:progress', (p: any) =>
        setDownloads((d) => (d[p.id] ? { ...d, [p.id]: { ...d[p.id], ...p } } : d))
      ),
    []
  )

  const download = async (b: PanelBackup) => {
    const res = await run(() => api.panel.request<any>(props.profileId, 'GET', `/backups/${b.uuid}/download`))
    if (!res) return
    const id = uid()
    setDownloads((d) => ({ ...d, [id]: { name: b.name, transferred: 0, total: b.bytes } }))
    const path = await run(() => api.panel.download(res.attributes.url, `${b.name.replace(/[<>:"/\\|?*]/g, '_')}.tar.gz`, id))
    if (!path)
      setDownloads((d) => {
        const n = { ...d }
        delete n[id]
        return n
      })
  }

  const restore = async (b: PanelBackup) => {
    const ok = await api.dialog.confirm({
      title: 'Восстановление бэкапа',
      message: `Восстановить «${b.name}»?`,
      detail: 'Сервер будет остановлен, файлы из бэкапа заменят текущие. Файлы, которых нет в бэкапе, останутся.',
      ok: 'Восстановить',
      danger: true
    })
    if (!ok) return
    const truncate = await api.dialog.confirm({
      title: 'Очистить сервер?',
      message: 'Удалить ВСЕ текущие файлы сервера перед восстановлением?',
      detail: 'Выберите «Удалить», чтобы сервер стал точной копией бэкапа. «Отмена» — восстановить поверх текущих файлов.',
      ok: 'Удалить и восстановить',
      danger: true
    })
    if (await run(() => api.panel.request(props.profileId, 'POST', `/backups/${b.uuid}/restore`, { truncate }), 'Восстановление запущено — следите за консолью'))
      load()
  }

  const remove = async (b: PanelBackup) => {
    if (b.locked) return toast('Бэкап закреплён — сначала снимите замок', 'error')
    const ok = await api.dialog.confirm({ title: 'Удаление', message: `Удалить бэкап «${b.name}»?`, detail: 'Это нельзя отменить.', ok: 'Удалить', danger: true })
    if (ok && (await run(() => api.panel.request(props.profileId, 'DELETE', `/backups/${b.uuid}`), 'Бэкап удалён'))) load()
    else if (ok) load()
  }

  const toggleLock = async (b: PanelBackup) => {
    await run(() => api.panel.request(props.profileId, 'POST', `/backups/${b.uuid}/lock`))
    load()
  }

  const limit = info?.featureLimits.backups ?? null
  const used = list?.length ?? 0

  return (
    <div className="view">
      <div className="view-narrow">
        <div className="section-title">
          <Archive size={16} /> Бэкапы сервера
          {limit !== null && (
            <span className={`badge ${limit && used >= limit ? 'warn' : ''}`}>
              {used} из {limit || '∞'}
            </span>
          )}
          <div className="spacer" />
          <button className="btn sm ghost" onClick={load}>
            <RefreshCw size={13} /> Обновить
          </button>
          <button className="btn primary sm" disabled={limit === 0 || (!!limit && used >= limit)} onClick={() => setCreating(true)}>
            <Plus size={14} /> Создать бэкап
          </button>
        </div>
        {limit === 0 && (
          <div className="callout warn" style={{ marginBottom: 14 }}>
            Ваш тариф хостинга не включает бэкапы (лимит 0).
          </div>
        )}
        {!!limit && used >= limit && (
          <div className="callout warn" style={{ marginBottom: 14 }}>
            Достигнут лимит бэкапов. Удалите старый (незакреплённый) бэкап, чтобы создать новый.
          </div>
        )}

        <DownloadList downloads={downloads} />

        <div className="rows">
          {error ? (
            <div className="empty-row">{error}</div>
          ) : !list ? (
            <div className="empty-row">Загрузка…</div>
          ) : list.length === 0 ? (
            <div className="empty-row">Бэкапов пока нет</div>
          ) : (
            list.map((b) => (
              <div className="r" key={b.uuid}>
                <Archive size={18} color={b.completed ? (b.ok ? 'var(--accent)' : 'var(--danger)') : 'var(--warn)'} />
                <div className="main">
                  <b>
                    {b.name} {b.locked && <Lock size={12} style={{ verticalAlign: -1, color: 'var(--warn)' }} />}
                  </b>
                  <span>
                    {!b.completed ? (
                      <>
                        <span className="spinner" style={{ display: 'inline-block', width: 11, height: 11, verticalAlign: -2 }} /> Создаётся…
                      </>
                    ) : b.ok ? (
                      `${formatBytes(b.bytes)} · ${formatDate(b.created)}`
                    ) : (
                      <span style={{ color: 'var(--danger)' }}>Ошибка создания · {formatDate(b.created)}</span>
                    )}
                  </span>
                </div>
                <div className="acts">
                  <button className="btn sm icon" title={b.locked ? 'Открепить' : 'Закрепить (защита от удаления)'} disabled={!b.completed} onClick={() => toggleLock(b)}>
                    {b.locked ? <Unlock size={14} /> : <Lock size={14} />}
                  </button>
                  <button className="btn sm" disabled={!b.completed || !b.ok} onClick={() => download(b)}>
                    <Download size={14} /> Скачать
                  </button>
                  <button className="btn sm" disabled={!b.completed || !b.ok} onClick={() => restore(b)}>
                    <RotateCcw size={14} /> Восстановить
                  </button>
                  <button className="btn sm icon danger" title="Удалить" disabled={!b.completed} onClick={() => remove(b)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {creating && (
        <CreatePanelBackup
          profileId={props.profileId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function CreatePanelBackup(props: { profileId: string; onClose: () => void; onCreated: () => void }) {
  const run = useAction()
  const [name, setName] = useState('')
  const [ignored, setIgnored] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title="Новый бэкап"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const ok = await run(
                () => api.panel.request(props.profileId, 'POST', '/backups', { name: name.trim() || undefined, ignored: ignored.trim(), is_locked: locked }),
                'Создание бэкапа запущено'
              )
              setBusy(false)
              if (ok !== undefined) props.onCreated()
            }}
          >
            {busy && <span className="spinner" />} Создать
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        <div className="field">
          <label>Название</label>
          <input className="input" placeholder="Например: перед обновлением модов" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Не включать в бэкап</label>
          <textarea className="input mono" rows={4} placeholder={'logs/\ncache/\n*.log'} value={ignored} onChange={(e) => setIgnored(e.target.value)} />
          <span className="hint">По одному пути или маске на строку, как в .gitignore</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          <span>Закрепить — защитить от удаления и автоматической ротации</span>
        </label>
      </div>
    </Modal>
  )
}

function DownloadList(props: { downloads: Record<string, { name: string; transferred: number; total: number; done?: boolean; error?: string }> }) {
  const items = Object.entries(props.downloads)
  if (!items.length) return null
  return (
    <div className="card" style={{ padding: 12, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map(([id, d]) => {
        const pct = d.total ? Math.min(100, (d.transferred / d.total) * 100) : d.done ? 100 : 0
        return (
          <div key={id} className="transfer" style={{ gridTemplateColumns: '18px 1fr 120px' }}>
            <Download size={15} color="var(--blue)" />
            <div>
              <div className="meta">
                <span>{d.name}</span>
                <span>{d.error ? <span style={{ color: 'var(--danger)' }}>{d.error}</span> : `${formatBytes(d.transferred)} / ${formatBytes(d.total)}`}</span>
              </div>
              <div className={`progress ${d.error ? 'error' : ''}`}>
                <div style={{ width: `${d.error ? 100 : pct}%` }} />
              </div>
            </div>
            <span className="muted" style={{ textAlign: 'right' }}>
              {d.done ? 'Скачано' : d.error ? 'Ошибка' : `${pct.toFixed(0)}%`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Локальные бэкапы ----------

export function LocalBackups(props: { serverId: string; running: boolean; visible: boolean }) {
  const run = useAction()
  const [list, setList] = useState<LocalBackup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')

  const load = useCallback(() => api.mc.backups(props.serverId).then(setList, () => setList([])), [props.serverId])
  useEffect(() => {
    if (props.visible) load()
  }, [props.visible, load])

  const create = async () => {
    setBusy(true)
    await run(() => api.mc.backupCreate(props.serverId, label), 'Бэкап создан')
    setBusy(false)
    setLabel('')
    load()
  }

  const restore = async (b: LocalBackup) => {
    const ok = await api.dialog.confirm({
      title: 'Восстановление',
      message: `Восстановить «${b.name}»?`,
      detail: 'Текущие файлы сервера будут перемещены в корзину Windows (их можно вернуть), затем бэкап распакуется.',
      ok: 'Восстановить',
      danger: true
    })
    if (!ok) return
    setBusy(true)
    await run(() => api.mc.backupRestore(props.serverId, b.name), 'Бэкап восстановлен')
    setBusy(false)
  }

  const remove = async (b: LocalBackup) => {
    const ok = await api.dialog.confirm({ title: 'Удаление', message: `Удалить «${b.name}»?`, detail: 'Файл будет перемещён в корзину.', ok: 'Удалить', danger: true })
    if (ok) await run(() => api.mc.backupDelete(props.serverId, b.name), 'Бэкап удалён')
    load()
  }

  const total = list?.reduce((s, b) => s + b.size, 0) ?? 0

  return (
    <div className="view">
      <div className="view-narrow">
        <div className="section-title">
          <Archive size={16} /> Бэкапы
          {list && <span className="badge">{list.length} · {formatBytes(total)}</span>}
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => api.mc.backupsDir(props.serverId).then((d) => api.fs.openPath(d))}>
            <FolderOpen size={13} /> Открыть папку
          </button>
        </div>
        <div className="card row" style={{ padding: 12, marginBottom: 14 }}>
          <input className="input" placeholder="Подпись (необязательно)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <button className="btn primary" disabled={busy} onClick={create}>
            {busy ? <span className="spinner" /> : <Plus size={15} />} Создать бэкап
          </button>
        </div>
        {props.running && (
          <div className="callout" style={{ marginBottom: 14 }}>
            Сервер запущен: перед архивацией Nexus выполнит save-all и временно отключит автосохранение, чтобы мир не повредился.
          </div>
        )}
        <div className="rows">
          {!list ? (
            <div className="empty-row">Загрузка…</div>
          ) : list.length === 0 ? (
            <div className="empty-row">Бэкапов пока нет. Они сохраняются в папку backups внутри сервера.</div>
          ) : (
            list.map((b) => (
              <div className="r" key={b.name}>
                <Archive size={18} color="var(--accent)" />
                <div className="main">
                  <b>{b.name}</b>
                  <span>
                    {formatBytes(b.size)} · {formatDate(b.mtime)}
                  </span>
                </div>
                <div className="acts">
                  <button className="btn sm" disabled={busy || props.running} title={props.running ? 'Остановите сервер' : ''} onClick={() => restore(b)}>
                    <RotateCcw size={14} /> Восстановить
                  </button>
                  <button className="btn sm icon danger" disabled={busy} onClick={() => remove(b)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
