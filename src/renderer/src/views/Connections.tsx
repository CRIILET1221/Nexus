import { useState } from 'react'
import { KeyRound, Lock, Pencil, Plug, Plus, Server, Trash2, FolderOpen, Zap, ExternalLink, Info } from 'lucide-react'
import type { ConnectionProfile, ProfileInput } from '@shared/types'
import { api } from '../api'
import { Modal, useAction } from '../components/ui'
import { tr } from '@shared/i18n'

const COLORS = ['#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fbbf24', '#fb923c', '#f87171', '#22d3ee']

export function Connections(props: {
  profiles: ConnectionProfile[]
  connecting: string | null
  onConnect: (p: ConnectionProfile) => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<ConnectionProfile | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const run = useAction()

  const remove = async (p: ConnectionProfile) => {
    const ok = await api.dialog.confirm({
      title: tr('Удаление'),
      message: tr('Удалить подключение «{0}»?', p.name),
      detail: tr('Сохранённый пароль тоже будет удалён.'),
      ok: tr('Удалить'),
      danger: true
    })
    if (ok) await run(() => api.profiles.remove(p.id), tr('Подключение удалено'))
    props.onChanged()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{tr('Подключения')}</h1>
          <p>{tr('Ваши серверы: SFTP-файлы и SSH-консоль в одном окне')}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setEditing('new')}>
            <Plus size={16} />{' '}{tr('Вручную (SFTP)')}
          </button>
          <button className="btn primary" onClick={() => setImporting(true)}>
            <Zap size={16} />{' '}{tr('Добавить с хостинга')}
          </button>
        </div>
      </div>

      {props.profiles.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <Server size={28} />
          </div>
          <h3>{tr('Пока нет ни одного сервера')}</h3>
          <div>{tr('Проще всего — по API-ключу панели хостинга: NexAtom сам найдёт ваши серверы и настроит файлы, консоль и всё остальное.')}</div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => setImporting(true)}>
              <Zap size={16} />{' '}{tr('Добавить с хостинга')}
            </button>
            <button className="btn" onClick={() => setEditing('new')}>
              <Plus size={16} />{' '}{tr('Вручную (SFTP / VPS)')}
            </button>
          </div>
        </div>
      ) : (
        <div className="profiles">
          {props.profiles.map((p) => (
            <div key={p.id} className="card profile-card" onDoubleClick={() => props.onConnect(p)}>
              <div className="top">
                <div className="avatar" style={{ background: (p.color ?? COLORS[0]) + '22', color: p.color ?? COLORS[0] }}>
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="name">{p.name}</div>
                  <div className="addr">
                    {p.username}@{p.host}:{p.port}
                  </div>
                </div>
                <span className="badge" title={p.authType === 'key' ? tr('Вход по ключу') : tr('Вход по паролю')}>
                  {p.authType === 'key' ? <KeyRound size={12} /> : <Lock size={12} />}
                  {p.authType === 'key' ? tr('ключ') : tr('пароль')}
                </span>
              </div>
              <div className="actions">
                <button className="btn primary" style={{ flex: 1 }} disabled={props.connecting !== null} onClick={() => props.onConnect(p)}>
                  {props.connecting === p.id ? <span className="spinner" /> : <Plug size={15} />}
                  {props.connecting === p.id ? tr('Подключение…') : tr('Подключиться')}
                </button>
                <button className="btn icon" title={tr('Изменить')} onClick={() => setEditing(p)}>
                  <Pencil size={15} />
                </button>
                <button className="btn icon danger" title={tr('Удалить')} onClick={() => remove(p)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {importing && (
        <HostingImport
          existing={props.profiles}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false)
            props.onChanged()
          }}
        />
      )}

      {editing && (
        <ProfileModal
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            props.onChanged()
          }}
        />
      )}
    </div>
  )
}

function ProfileModal(props: { profile: ConnectionProfile | null; onClose: () => void; onSaved: () => void }) {
  const p = props.profile
  const [form, setForm] = useState<ProfileInput>({
    id: p?.id,
    name: p?.name ?? '',
    host: p?.host ?? '',
    port: p?.port ?? 22,
    username: p?.username ?? '',
    authType: p?.authType ?? 'password',
    keyPath: p?.keyPath ?? '',
    remotePath: p?.remotePath ?? '',
    color: p?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]
  })
  const [secret, setSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = useAction()
  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  // Удобство: вставка "user@host:port" в поле адреса
  const onHostChange = (v: string) => {
    const m = v.match(/^(?:sftp:\/\/)?(?:([^@\s]+)@)?([^:\s/]+)(?::(\d+))?\/?$/)
    if (m && (m[1] || m[3])) {
      setForm((f) => ({ ...f, host: m[2], username: m[1] ?? f.username, port: m[3] ? Number(m[3]) : f.port }))
    } else set('host', v.trim())
  }

  const valid = form.host && form.username && form.port > 0 && form.port < 65536 && (form.authType === 'password' || form.keyPath)

  const save = async () => {
    setBusy(true)
    const input: ProfileInput = { ...form, name: form.name.trim() || form.host }
    if (secret) input.secret = secret
    else if (clearSecret) input.secret = ''
    const res = await run(() => api.profiles.save(input), p ? tr('Сохранено') : tr('Подключение добавлено'))
    setBusy(false)
    if (res) props.onSaved()
  }

  const pickKey = async () => {
    const [file] = await api.dialog.open({ title: tr('Приватный ключ') })
    if (file) set('keyPath', file)
  }

  return (
    <Modal
      title={p ? tr('Изменить подключение') : tr('Новое подключение')}
      onClose={props.onClose}
      closeOnBackdrop={false}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {tr('Отмена')}
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>
            {busy && <span className="spinner" />}
            {tr('Сохранить')}
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        <div className="field">
          <label>{tr('Название')}</label>
          <input className="input" placeholder={tr('Мой сервер')} value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>
        <div className="grid-3">
          <div className="field">
            <label>{tr('Адрес (хост)')}</label>
            <input className="input mono" placeholder="mc.example.com" value={form.host} onChange={(e) => onHostChange(e.target.value)} />
          </div>
          <div className="field">
            <label>{tr('Порт')}</label>
            <input className="input mono" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>{tr('Пользователь')}</label>
            <input className="input mono" placeholder="root" value={form.username} onChange={(e) => set('username', e.target.value)} />
          </div>
        </div>
        <div className="callout">
          <span>
            {tr('На хостингах Minecraft SFTP часто работает на порту')}{' '}<b>2022</b>{tr(', а логин имеет вид')}{' '}<span className="mono">user.abc123</span>{' '}{tr('— смотрите данные SFTP в панели хостинга.')}
          </span>
        </div>

        <div className="field">
          <label>{tr('Способ входа')}</label>
          <div className="seg">
            <button className={form.authType === 'password' ? 'on' : ''} onClick={() => set('authType', 'password')}>
              <Lock size={14} />{' '}{tr('Пароль')}
            </button>
            <button className={form.authType === 'key' ? 'on' : ''} onClick={() => set('authType', 'key')}>
              <KeyRound size={14} />{' '}{tr('SSH-ключ')}
            </button>
          </div>
        </div>

        {form.authType === 'key' && (
          <div className="field">
            <label>{tr('Файл приватного ключа')}</label>
            <div className="row">
              <input className="input mono" value={form.keyPath} placeholder="C:\Users\...\.ssh\id_ed25519" onChange={(e) => set('keyPath', e.target.value)} />
              <button className="btn" onClick={pickKey}>
                <FolderOpen size={15} />{' '}{tr('Обзор')}
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label>{form.authType === 'key' ? tr('Парольная фраза ключа (если есть)') : tr('Пароль')}</label>
          <input
            className="input"
            type="password"
            value={secret}
            placeholder={p?.hasSecret && !clearSecret ? tr('•••••••• (сохранён — оставьте пустым, чтобы не менять)') : form.authType === 'password' ? tr('Оставьте пустым, чтобы вводить при подключении') : ''}
            onChange={(e) => setSecret(e.target.value)}
          />
          {p?.hasSecret && !secret && (
            <label className="check" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
              {tr('Удалить сохранённый пароль')}
            </label>
          )}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>{tr('Стартовая папка')}</label>
            <input className="input mono" placeholder={tr('домашняя')} value={form.remotePath} onChange={(e) => set('remotePath', e.target.value)} />
          </div>
          <div className="field">
            <label>{tr('Цвет')}</label>
            <div className="colors" style={{ height: 36, alignItems: 'center' }}>
              {COLORS.map((c) => (
                <button key={c} className={form.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set('color', c)} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

type Found = Awaited<ReturnType<typeof api.panel.discover>>

/** Добавление серверов хостинга по API-ключу панели: данные SFTP подставляются сами */
function HostingImport(props: { existing: ConnectionProfile[]; onClose: () => void; onDone: () => void }) {
  const run = useAction()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [found, setFound] = useState<Found | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [password, setPassword] = useState('')

  const exists = (id: string) => props.existing.some((p) => p.panelServerId === id)

  const find = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.panel.discover(url, key)
      setFound(r)
      setPicked(new Set(r.servers.filter((s) => !exists(s.id)).map((s) => s.id)))
      if (!r.servers.length) setError(tr('По этому ключу не найдено ни одного сервера'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const create = async () => {
    if (!found) return
    setBusy(true)
    const list = found.servers.filter((s) => picked.has(s.id))
    const ok = await run(
      async () => {
        for (const [i, s] of list.entries()) {
          await api.profiles.save({
            name: s.name,
            host: s.sftpHost,
            port: s.sftpPort,
            username: s.sftpUser,
            authType: 'password',
            remotePath: '',
            color: COLORS[(props.existing.length + i) % COLORS.length],
            panelUrl: found.panelUrl,
            panelServerId: s.id,
            panelKey: key.trim(),
            secret: password || undefined
          })
        }
        return true
      },
      list.length === 1 ? tr('Сервер добавлен') : tr('Добавлено серверов: {0}', list.length)
    )
    setBusy(false)
    if (ok) props.onDone()
  }

  const keyUrl = () =>
    api.panel
      .normalize(url)
      .then((u) => api.fs.openExternal(`${u}/account/api`))
      .catch(() => undefined)

  return (
    <Modal
      title={tr('Добавить сервер с хостинга')}
      icon={<Zap size={18} />}
      onClose={props.onClose}
      closeOnBackdrop={false}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {tr('Отмена')}
          </button>
          {found ? (
            <button className="btn primary" disabled={busy || picked.size === 0} onClick={create}>
              {busy && <span className="spinner" />}{' '}{tr('Добавить (')}{picked.size})
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !url.trim() || !key.trim()} onClick={find}>
              {busy && <span className="spinner" />}{' '}{tr('Найти серверы')}
            </button>
          )}
        </>
      }
    >
      <div className="modal-body stack">
        {!found ? (
          <>
            <div className="callout">
              <Info size={16} />
              <span>
                {tr('Подходит для хостингов на панели')}{' '}<b>Pterodactyl</b>{' '}{tr('или')}{' '}<b>Pelican</b>{tr('. NexAtom получит список ваших серверов и сам подставит адрес, порт и логин SFTP.')}
              </span>
            </div>
            <div className="field">
              <label>{tr('Адрес панели')}</label>
              <input className="input mono" autoFocus placeholder="https://panel.example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="field">
              <label>
                {tr('API-ключ клиента')}
                <a className="link" style={{ marginLeft: 8 }} onClick={keyUrl}>
                  {tr('создать ключ')}{' '}<ExternalLink size={11} style={{ verticalAlign: -1 }} />
                </a>
              </label>
              <input
                className="input mono"
                type="password"
                placeholder="ptlc_…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && url.trim() && key.trim() && find()}
              />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {tr('В панели:')}{' '}<b>{tr('Аккаунт → API Credentials → Create')}</b>{tr('. Описание любое, поле IP оставьте пустым. Ключ хранится зашифрованным.')}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 13 }}>
              {tr('Аккаунт')}{' '}<b style={{ color: 'var(--text)' }}>{found.username}</b> · {found.panelUrl}
            </div>
            <div className="rows">
              {found.servers.map((s) => {
                const had = exists(s.id)
                return (
                  <label className="r" key={s.id} style={{ cursor: had ? 'default' : 'pointer', opacity: had ? 0.55 : 1 }}>
                    <input
                      type="checkbox"
                      disabled={had}
                      checked={picked.has(s.id)}
                      onChange={(e) =>
                        setPicked((cur) => {
                          const n = new Set(cur)
                          if (e.target.checked) n.add(s.id)
                          else n.delete(s.id)
                          return n
                        })
                      }
                    />
                    <div className="main">
                      <b>
                        {s.name} {had && <span className="badge">{tr('уже добавлен')}</span>} {!s.isOwner && <span className="badge blue">{tr('доступ выдан')}</span>}
                      </b>
                      <span className="mono">
                        {s.sftpUser}@{s.sftpHost}:{s.sftpPort}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="field">
              <label>{tr('Пароль от панели (он же пароль SFTP)')}</label>
              <input
                className="input"
                type="password"
                placeholder={tr('Можно не указывать — спросим при подключении')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </>
        )}
        {error && (
          <div className="callout danger">
            <Info size={16} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}
