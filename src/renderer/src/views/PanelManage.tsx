import { useCallback, useEffect, useState } from 'react'
import {
  Copy, Database, Eye, EyeOff, History, KeyRound, Network, Plus, RefreshCw, Rocket, Save, Server, Star, Trash2, Users, Wrench
} from 'lucide-react'
import { api } from '../api'
import { errText, usePanelServer } from '../adapter'
import { Modal, useAction, useToast } from '../components/ui'
import { formatBytes, formatDate } from '../util'

type Sub = 'startup' | 'network' | 'databases' | 'users' | 'activity' | 'settings'

const SUBS: { id: Sub; label: string; icon: React.ReactNode }[] = [
  { id: 'startup', label: 'Запуск', icon: <Rocket size={14} /> },
  { id: 'network', label: 'Сеть', icon: <Network size={14} /> },
  { id: 'databases', label: 'Базы данных', icon: <Database size={14} /> },
  { id: 'users', label: 'Пользователи', icon: <Users size={14} /> },
  { id: 'activity', label: 'Журнал', icon: <History size={14} /> },
  { id: 'settings', label: 'Сервер', icon: <Wrench size={14} /> }
]

export function PanelManage(props: { profileId: string; visible: boolean }) {
  const [sub, setSub] = useState<Sub>('startup')
  return (
    <div className="view">
      <div className="view-narrow">
        <div className="subtabs">
          {SUBS.map((s) => (
            <button key={s.id} className={sub === s.id ? 'on' : ''} onClick={() => setSub(s.id)}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
        {props.visible && sub === 'startup' && <Startup pid={props.profileId} />}
        {props.visible && sub === 'network' && <NetworkTab pid={props.profileId} />}
        {props.visible && sub === 'databases' && <Databases pid={props.profileId} />}
        {props.visible && sub === 'users' && <UsersTab pid={props.profileId} />}
        {props.visible && sub === 'activity' && <Activity pid={props.profileId} />}
        {props.visible && sub === 'settings' && <Settings pid={props.profileId} />}
      </div>
    </div>
  )
}

function useCopy() {
  const toast = useToast()
  return (text: string) => {
    navigator.clipboard.writeText(text)
    toast('Скопировано', 'success')
  }
}

function Loading({ error }: { error: string | null }) {
  return <div className="rows"><div className="empty-row">{error ?? 'Загрузка…'}</div></div>
}

// ---------- Запуск ----------

interface Variable {
  name: string
  description: string
  env: string
  value: string
  def: string
  editable: boolean
  rules: string
}

function Startup({ pid }: { pid: string }) {
  const run = useAction()
  const { info, reload } = usePanelServer(pid)
  const [vars, setVars] = useState<Variable[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [command, setCommand] = useState('')
  const [images, setImages] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(pid, 'GET', '/startup')
      setVars(
        res.data.map((v: any) => ({
          name: v.attributes.name,
          description: v.attributes.description,
          env: v.attributes.env_variable,
          value: v.attributes.server_value ?? '',
          def: v.attributes.default_value ?? '',
          editable: v.attributes.is_editable,
          rules: v.attributes.rules ?? ''
        }))
      )
      setCommand(res.meta?.startup_command ?? '')
      setImages(res.meta?.docker_images ?? {})
      setEdits({})
    } catch (e) {
      setError(errText(e))
    }
  }, [pid])
  useEffect(() => {
    load()
  }, [load])

  const saveVar = async (v: Variable) => {
    const value = edits[v.env]
    if (await run(() => api.panel.request(pid, 'PUT', '/startup/variable', { key: v.env, value }).then(() => true), `${v.name}: сохранено`)) load()
  }

  const setImage = async (image: string) => {
    if (await run(() => api.panel.request(pid, 'PUT', '/settings/docker-image', { docker_image: image }).then(() => true), 'Образ изменён — перезапустите сервер')) reload()
  }

  if (!vars) return <Loading error={error} />
  return (
    <div className="stack">
      <div>
        <div className="section-title">Команда запуска</div>
        <div className="card mono" style={{ padding: 12, fontSize: 12.5, userSelect: 'text', overflowWrap: 'anywhere' }}>
          {command || '—'}
        </div>
      </div>

      {Object.keys(images).length > 0 && (
        <div>
          <div className="section-title">Образ Docker (версия Java)</div>
          <select className="select" value={info?.dockerImage ?? ''} onChange={(e) => setImage(e.target.value)}>
            {!Object.values(images).includes(info?.dockerImage ?? '') && <option value={info?.dockerImage ?? ''}>{info?.dockerImage || '—'}</option>}
            {Object.entries(images).map(([label, image]) => (
              <option key={image} value={image}>
                {label}
              </option>
            ))}
          </select>
          <div className="hint muted" style={{ fontSize: 12, marginTop: 6 }}>
            Новые версии Minecraft требуют новую Java: 1.20.5+ — Java 21, 26.x — Java 25.
          </div>
        </div>
      )}

      <div>
        <div className="section-title">Переменные</div>
        <div className="rows">
          {vars.map((v) => {
            const options = v.rules.match(/in:([^|]+)/)?.[1].split(',')
            const current = edits[v.env] ?? v.value
            const dirty = edits[v.env] !== undefined && edits[v.env] !== v.value
            return (
              <div className="r" key={v.env} style={{ alignItems: 'flex-start' }}>
                <div className="main">
                  <b>{v.name}</b>
                  <span>{v.description}</span>
                  <div className="mono muted" style={{ fontSize: 11, marginTop: 3 }}>
                    {v.env}
                  </div>
                </div>
                <div className="acts" style={{ width: 340 }}>
                  {options ? (
                    <select className="select" disabled={!v.editable} value={current} onChange={(e) => setEdits({ ...edits, [v.env]: e.target.value })}>
                      {options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input mono"
                      disabled={!v.editable}
                      placeholder={v.def}
                      value={current}
                      onChange={(e) => setEdits({ ...edits, [v.env]: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && dirty && saveVar(v)}
                    />
                  )}
                  <button className="btn icon" disabled={!dirty} title="Сохранить" onClick={() => saveVar(v)}>
                    <Save size={15} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="hint muted" style={{ fontSize: 12, marginTop: 8 }}>
          Изменения применяются при следующем запуске сервера.
        </div>
      </div>
    </div>
  )
}

// ---------- Сеть ----------

function NetworkTab({ pid }: { pid: string }) {
  const run = useAction()
  const copy = useCopy()
  const { info, reload } = usePanelServer(pid)
  const [list, setList] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(pid, 'GET', '/network/allocations')
      setList(res.data.map((a: any) => a.attributes))
    } catch (e) {
      setError(errText(e))
    }
  }, [pid])
  useEffect(() => {
    load()
  }, [load])

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    await run(fn, msg)
    load()
    reload()
  }

  const limit = info?.featureLimits.allocations ?? 0
  if (!list) return <Loading error={error} />
  return (
    <div>
      <div className="section-title">
        Порты и адреса <span className="badge">{list.length} из {limit || list.length}</span>
        <div className="spacer" />
        <button
          className="btn primary sm"
          disabled={!!limit && list.length >= limit}
          title={limit && list.length >= limit ? 'Достигнут лимит тарифа' : ''}
          onClick={() => act(() => api.panel.request(pid, 'POST', '/network/allocations'), 'Порт добавлен')}
        >
          <Plus size={14} /> Добавить порт
        </button>
      </div>
      <div className="rows">
        {list.map((a) => {
          const addr = `${a.ip_alias || a.ip}:${a.port}`
          return (
            <div className="r" key={a.id}>
              <Network size={17} color={a.is_default ? 'var(--accent)' : 'var(--muted)'} />
              <div className="main">
                <b className="mono">
                  {addr} {a.is_default && <span className="badge green">основной</span>}
                </b>
                <input
                  className="input"
                  style={{ height: 28, marginTop: 4, maxWidth: 320 }}
                  placeholder="Заметка (например: голосовой чат)"
                  defaultValue={a.notes ?? ''}
                  onBlur={(e) => e.target.value !== (a.notes ?? '') && act(() => api.panel.request(pid, 'POST', `/network/allocations/${a.id}`, { notes: e.target.value }), 'Заметка сохранена')}
                />
              </div>
              <div className="acts">
                <button className="btn sm icon" title="Копировать" onClick={() => copy(addr)}>
                  <Copy size={14} />
                </button>
                {!a.is_default && (
                  <>
                    <button className="btn sm" onClick={() => act(() => api.panel.request(pid, 'POST', `/network/allocations/${a.id}/primary`), 'Основной порт изменён')}>
                      <Star size={13} /> Сделать основным
                    </button>
                    <button
                      className="btn sm icon danger"
                      title="Удалить"
                      onClick={async () => {
                        if (await api.dialog.confirm({ title: 'Удаление порта', message: `Удалить ${addr}?`, ok: 'Удалить', danger: true }))
                          act(() => api.panel.request(pid, 'DELETE', `/network/allocations/${a.id}`), 'Порт удалён')
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Базы данных ----------

function Databases({ pid }: { pid: string }) {
  const run = useAction()
  const copy = useCopy()
  const { info } = usePanelServer(pid)
  const [list, setList] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(pid, 'GET', '/databases?include=password')
      setList(res.data.map((d: any) => ({ ...d.attributes, password: d.attributes.relationships?.password?.attributes?.password ?? '' })))
    } catch (e) {
      setError(errText(e))
    }
  }, [pid])
  useEffect(() => {
    load()
  }, [load])

  const limit = info?.featureLimits.databases ?? 0
  if (!list) return <Loading error={error} />
  return (
    <div>
      <div className="section-title">
        Базы данных MySQL <span className="badge">{list.length} из {limit}</span>
        <div className="spacer" />
        <button className="btn primary sm" disabled={list.length >= limit} onClick={() => setCreating(true)}>
          <Plus size={14} /> Создать базу
        </button>
      </div>
      {limit === 0 && <div className="callout warn" style={{ marginBottom: 12 }}>Тариф не включает базы данных.</div>}
      <div className="stack">
        {list.length === 0 && limit > 0 && <div className="rows"><div className="empty-row">Баз пока нет. Они нужны плагинам вроде LuckPerms, CoreProtect, Plan.</div></div>}
        {list.map((d) => {
          const host = `${d.host.address}:${d.host.port}`
          const jdbc = `jdbc:mysql://${host}/${d.name}`
          const vis = shown.has(d.id)
          return (
            <div className="card" key={d.id} style={{ padding: 16 }}>
              <div className="row" style={{ marginBottom: 12 }}>
                <Database size={18} color="var(--blue)" />
                <b style={{ flex: 1 }}>{d.name}</b>
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (await api.dialog.confirm({ title: 'Новый пароль', message: 'Сменить пароль базы?', detail: 'Плагины со старым паролем перестанут подключаться.', ok: 'Сменить' }))
                      run(() => api.panel.request(pid, 'POST', `/databases/${d.id}/rotate-password`), 'Пароль изменён').then(load)
                  }}
                >
                  <KeyRound size={13} /> Сменить пароль
                </button>
                <button
                  className="btn sm icon danger"
                  onClick={async () => {
                    if (await api.dialog.confirm({ title: 'Удаление базы', message: `Удалить базу ${d.name}?`, detail: 'Все данные в ней будут потеряны безвозвратно.', ok: 'Удалить', danger: true }))
                      run(() => api.panel.request(pid, 'DELETE', `/databases/${d.id}`), 'База удалена').then(load)
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="kv">
                {[
                  ['Хост', host],
                  ['База', d.name],
                  ['Пользователь', d.username],
                  ['Пароль', vis ? d.password : '••••••••••'],
                  ['Подключения с', d.connections_from],
                  ['JDBC', jdbc]
                ].map(([k, v]) => (
                  <Fragment2 key={k} k={k} v={v} onCopy={() => copy(k === 'Пароль' ? d.password : v)} extra={k === 'Пароль' ? (
                    <button className="btn ghost sm icon" onClick={() => setShown((s) => { const n = new Set(s); vis ? n.delete(d.id) : n.add(d.id); return n })}>
                      {vis ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  ) : null} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {creating && <CreateDb pid={pid} onClose={() => setCreating(false)} onDone={() => (setCreating(false), load())} />}
    </div>
  )
}

function Fragment2(props: { k: string; v: string; onCopy: () => void; extra?: React.ReactNode }) {
  return (
    <>
      <span>{props.k}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1 }}>{props.v}</span>
        {props.extra}
        <button className="btn ghost sm icon" onClick={props.onCopy} title="Копировать">
          <Copy size={13} />
        </button>
      </span>
    </>
  )
}

function CreateDb(props: { pid: string; onClose: () => void; onDone: () => void }) {
  const run = useAction()
  const [name, setName] = useState('')
  const [remote, setRemote] = useState('%')
  return (
    <Modal
      title="Новая база данных"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>Отмена</button>
          <button
            className="btn primary"
            disabled={!/^[\w-]{1,48}$/.test(name)}
            onClick={async () => {
              if (await run(() => api.panel.request(props.pid, 'POST', '/databases', { database: name, remote }), 'База создана')) props.onDone()
            }}
          >
            Создать
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        <div className="field">
          <label>Имя базы</label>
          <input className="input mono" placeholder="luckperms" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <span className="hint">Латиница, цифры, «_» и «-». Панель добавит к имени префикс.</span>
        </div>
        <div className="field">
          <label>Разрешить подключения с</label>
          <input className="input mono" value={remote} onChange={(e) => setRemote(e.target.value)} />
          <span className="hint">% — откуда угодно (нужно, чтобы подключиться с ПК). Для доступа только с сервера укажите его IP.</span>
        </div>
      </div>
    </Modal>
  )
}

// ---------- Пользователи ----------

const PERMS = {
  full: {
    label: 'Полный доступ',
    list: [
      'control.console', 'control.start', 'control.stop', 'control.restart',
      'user.create', 'user.read', 'user.update', 'user.delete',
      'file.create', 'file.read', 'file.read-content', 'file.update', 'file.delete', 'file.archive', 'file.sftp',
      'backup.create', 'backup.read', 'backup.delete', 'backup.download', 'backup.restore',
      'allocation.read', 'allocation.create', 'allocation.update', 'allocation.delete',
      'startup.read', 'startup.update', 'startup.docker-image',
      'database.create', 'database.read', 'database.update', 'database.delete', 'database.view_password',
      'schedule.create', 'schedule.read', 'schedule.update', 'schedule.delete',
      'settings.rename', 'settings.reinstall', 'activity.read', 'websocket.connect'
    ]
  },
  admin: {
    label: 'Администратор (без пользователей и переустановки)',
    list: [
      'control.console', 'control.start', 'control.stop', 'control.restart',
      'file.create', 'file.read', 'file.read-content', 'file.update', 'file.delete', 'file.archive', 'file.sftp',
      'backup.create', 'backup.read', 'backup.download', 'backup.restore',
      'allocation.read', 'startup.read', 'database.read', 'schedule.read', 'schedule.create', 'schedule.update',
      'activity.read', 'websocket.connect'
    ]
  },
  moderator: {
    label: 'Модератор (консоль и питание)',
    list: ['control.console', 'control.start', 'control.stop', 'control.restart', 'file.read', 'file.read-content', 'websocket.connect']
  },
  viewer: { label: 'Только просмотр', list: ['file.read', 'file.read-content', 'websocket.connect'] }
}
type PermKey = keyof typeof PERMS

function presetOf(perms: string[]): string {
  for (const [k, p] of Object.entries(PERMS)) if (p.list.length === perms.length && p.list.every((x) => perms.includes(x))) return k
  return 'custom'
}

function UsersTab({ pid }: { pid: string }) {
  const run = useAction()
  const [list, setList] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [preset, setPreset] = useState<PermKey>('moderator')

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(pid, 'GET', '/users')
      setList(res.data.map((u: any) => u.attributes))
    } catch (e) {
      setError(errText(e))
    }
  }, [pid])
  useEffect(() => {
    load()
  }, [load])

  const invite = async () => {
    if (await run(() => api.panel.request(pid, 'POST', '/users', { email: email.trim(), permissions: PERMS[preset].list }), 'Приглашение отправлено')) {
      setEmail('')
      load()
    }
  }

  if (!list) return <Loading error={error} />
  return (
    <div>
      <div className="section-title">Совладельцы сервера</div>
      <div className="card row" style={{ padding: 12, marginBottom: 14 }}>
        <input className="input" placeholder="E-mail аккаунта в панели" value={email} onChange={(e) => setEmail(e.target.value)} />
        <select className="select" style={{ width: 330 }} value={preset} onChange={(e) => setPreset(e.target.value as PermKey)}>
          {Object.entries(PERMS).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
        <button className="btn primary" disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} onClick={invite}>
          <Plus size={15} /> Пригласить
        </button>
      </div>
      <div className="rows">
        {list.length === 0 ? (
          <div className="empty-row">Доступ к серверу есть только у вас</div>
        ) : (
          list.map((u) => {
            const p = presetOf(u.permissions)
            return (
              <div className="r" key={u.uuid}>
                <div className="head-img">{(u.username ?? u.email).slice(0, 1).toUpperCase()}</div>
                <div className="main">
                  <b>{u.username}</b>
                  <span>{u.email} {u['2fa_enabled'] && <span className="badge green">2FA</span>}</span>
                </div>
                <div className="acts">
                  <select
                    className="select"
                    style={{ width: 300, height: 30 }}
                    value={p}
                    onChange={(e) =>
                      e.target.value !== 'custom' &&
                      run(() => api.panel.request(pid, 'POST', `/users/${u.uuid}`, { permissions: PERMS[e.target.value as PermKey].list }), 'Права изменены').then(load)
                    }
                  >
                    {p === 'custom' && <option value="custom">Особые права ({u.permissions.length})</option>}
                    {Object.entries(PERMS).map(([k, x]) => (
                      <option key={k} value={k}>{x.label}</option>
                    ))}
                  </select>
                  <button
                    className="btn sm icon danger"
                    onClick={async () => {
                      if (await api.dialog.confirm({ title: 'Удаление доступа', message: `Забрать доступ у ${u.email}?`, ok: 'Удалить', danger: true }))
                        run(() => api.panel.request(pid, 'DELETE', `/users/${u.uuid}`), 'Доступ удалён').then(load)
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------- Журнал ----------

const EVENTS: Record<string, string> = {
  'server:console.command': 'Команда в консоли',
  'server:power.start': 'Запуск сервера',
  'server:power.stop': 'Остановка сервера',
  'server:power.restart': 'Перезапуск сервера',
  'server:power.kill': 'Принудительное завершение',
  'server:backup.start': 'Создание бэкапа',
  'server:backup.complete': 'Бэкап создан',
  'server:backup.fail': 'Ошибка бэкапа',
  'server:backup.delete': 'Бэкап удалён',
  'server:backup.restore': 'Восстановление бэкапа',
  'server:backup.download': 'Скачивание бэкапа',
  'server:file.write': 'Файл изменён',
  'server:file.delete': 'Файлы удалены',
  'server:file.rename': 'Переименование',
  'server:file.upload': 'Загрузка файла',
  'server:file.compress': 'Архивация',
  'server:file.decompress': 'Распаковка',
  'server:file.pull': 'Скачивание по ссылке',
  'server:sftp.write': 'SFTP: запись',
  'server:sftp.create': 'SFTP: создание',
  'server:sftp.delete': 'SFTP: удаление',
  'server:sftp.rename': 'SFTP: переименование',
  'server:schedule.create': 'Создано расписание',
  'server:schedule.update': 'Изменено расписание',
  'server:schedule.execute': 'Запуск расписания',
  'server:startup.edit': 'Изменена переменная запуска',
  'server:settings.rename': 'Сервер переименован',
  'server:settings.reinstall': 'Переустановка',
  'server:database.create': 'Создана база данных',
  'server:subuser.create': 'Добавлен пользователь',
  'server:allocation.create': 'Добавлен порт'
}

function Activity({ pid }: { pid: string }) {
  const [list, setList] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(pid, 'GET', `/activity?page=${page}&per_page=50&include=actor`)
      setList(res.data.map((x: any) => x.attributes))
      setPages(res.meta?.pagination?.total_pages ?? 1)
    } catch (e) {
      setError(/не найден/.test(errText(e)) ? 'Журнал действий не поддерживается этой версией панели.' : errText(e))
    }
  }, [pid, page])
  useEffect(() => {
    load()
  }, [load])

  if (!list) return <Loading error={error} />
  return (
    <div>
      <div className="section-title">
        Журнал действий
        <div className="spacer" />
        <button className="btn sm ghost" onClick={load}><RefreshCw size={13} /> Обновить</button>
      </div>
      <div className="rows">
        {list.length === 0 && <div className="empty-row">Записей нет</div>}
        {list.map((a, i) => {
          const props = a.properties ?? {}
          const detail = props.command ?? props.name ?? props.file ?? (Array.isArray(props.files) ? props.files.join(', ') : '') ?? ''
          return (
            <div className="r" key={a.id ?? i}>
              <History size={15} color="var(--muted)" />
              <div className="main">
                <b>{EVENTS[a.event] ?? a.event}</b>
                <span className="mono">{String(detail || props.directory || '').slice(0, 160)}</span>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12 }}>
                <div>{a.relationships?.actor?.attributes?.username ?? (a.is_api ? 'API' : 'система')}</div>
                <div className="muted">{formatDate(Date.parse(a.timestamp))} · {a.ip}</div>
              </div>
            </div>
          )
        })}
      </div>
      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Новее</button>
          <span className="muted">{page} / {pages}</span>
          <button className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Старее →</button>
        </div>
      )}
    </div>
  )
}

// ---------- Сервер ----------

function Settings({ pid }: { pid: string }) {
  const run = useAction()
  const copy = useCopy()
  const { info, reload } = usePanelServer(pid)
  const [name, setName] = useState<string | null>(null)
  const [desc, setDesc] = useState<string | null>(null)
  if (!info) return <Loading error={null} />
  const n = name ?? info.name
  const d = desc ?? info.description
  const sftp = `sftp://${info.sftp.ip}:${info.sftp.port}`
  return (
    <div className="stack">
      <div>
        <div className="section-title"><Server size={16} /> Сервер</div>
        <div className="card" style={{ padding: 16 }}>
          <div className="kv" style={{ marginBottom: 16 }}>
            <span>Память</span><span>{info.limits.memory ? formatBytes(info.limits.memory * 1024 * 1024) : 'без ограничений'}</span>
            <span>Диск</span><span>{info.limits.disk ? formatBytes(info.limits.disk * 1024 * 1024) : 'без ограничений'}</span>
            <span>Процессор</span><span>{info.limits.cpu ? `${info.limits.cpu}%` : 'без ограничений'}</span>
            <span>SFTP</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {sftp}
              <button className="btn ghost sm icon" onClick={() => copy(sftp)}><Copy size={13} /></button>
            </span>
          </div>
          <div className="stack">
            <div className="field">
              <label>Название</label>
              <input className="input" value={n} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Описание</label>
              <textarea className="input" rows={2} value={d} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <button
              className="btn primary"
              style={{ alignSelf: 'flex-start' }}
              disabled={n === info.name && d === info.description}
              onClick={async () => {
                await run(() => api.panel.request(pid, 'POST', '/settings/rename', { name: n, description: d }), 'Сохранено')
                reload()
              }}
            >
              <Save size={15} /> Сохранить
            </button>
          </div>
        </div>
      </div>
      <div>
        <div className="section-title" style={{ color: 'var(--danger)' }}>Опасная зона</div>
        <div className="card row" style={{ padding: 16, borderColor: 'rgba(248,113,113,.35)' }}>
          <div style={{ flex: 1 }}>
            <b>Переустановить сервер</b>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
              Сервер остановится, будет заново выполнен скрипт установки ядра. Некоторые файлы могут быть удалены или перезаписаны — сделайте бэкап.
            </div>
          </div>
          <button
            className="btn solid-danger"
            onClick={async () => {
              const ok = await api.dialog.confirm({
                title: 'Переустановка сервера',
                message: 'Точно переустановить сервер?',
                detail: 'Сервер будет остановлен, установка ядра выполнится заново. Файлы могут быть перезаписаны. Рекомендуется сначала сделать бэкап.',
                ok: 'Переустановить',
                danger: true
              })
              if (ok) run(() => api.panel.request(pid, 'POST', '/settings/reinstall'), 'Переустановка запущена — следите за консолью')
            }}
          >
            Переустановить
          </button>
        </div>
      </div>
    </div>
  )
}
