import { useState } from 'react'
import { KeyRound, Lock, Pencil, Plug, Plus, Server, Trash2, FolderOpen } from 'lucide-react'
import type { ConnectionProfile, ProfileInput } from '@shared/types'
import { api } from '../api'
import { Modal, useAction } from '../components/ui'

const COLORS = ['#34d399', '#60a5fa', '#c084fc', '#f472b6', '#fbbf24', '#fb923c', '#f87171', '#22d3ee']

export function Connections(props: {
  profiles: ConnectionProfile[]
  connecting: string | null
  onConnect: (p: ConnectionProfile) => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<ConnectionProfile | 'new' | null>(null)
  const run = useAction()

  const remove = async (p: ConnectionProfile) => {
    const ok = await api.dialog.confirm({
      title: 'Удаление',
      message: `Удалить подключение «${p.name}»?`,
      detail: 'Сохранённый пароль тоже будет удалён.',
      ok: 'Удалить',
      danger: true
    })
    if (ok) await run(() => api.profiles.remove(p.id), 'Подключение удалено')
    props.onChanged()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Подключения</h1>
          <p>Ваши серверы: SFTP-файлы и SSH-консоль в одном окне</p>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Новое подключение
        </button>
      </div>

      {props.profiles.length === 0 ? (
        <div className="empty-state">
          <div className="icon">
            <Server size={28} />
          </div>
          <h3>Пока нет ни одного сервера</h3>
          <div>Добавьте хостинг или VPS: адрес, порт SFTP и данные для входа.</div>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Добавить сервер
          </button>
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
                <span className="badge" title={p.authType === 'key' ? 'Вход по ключу' : 'Вход по паролю'}>
                  {p.authType === 'key' ? <KeyRound size={12} /> : <Lock size={12} />}
                  {p.authType === 'key' ? 'ключ' : 'пароль'}
                </span>
              </div>
              <div className="actions">
                <button className="btn primary" style={{ flex: 1 }} disabled={props.connecting !== null} onClick={() => props.onConnect(p)}>
                  {props.connecting === p.id ? <span className="spinner" /> : <Plug size={15} />}
                  {props.connecting === p.id ? 'Подключение…' : 'Подключиться'}
                </button>
                <button className="btn icon" title="Изменить" onClick={() => setEditing(p)}>
                  <Pencil size={15} />
                </button>
                <button className="btn icon danger" title="Удалить" onClick={() => remove(p)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
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
    const res = await run(() => api.profiles.save(input), p ? 'Сохранено' : 'Подключение добавлено')
    setBusy(false)
    if (res) props.onSaved()
  }

  const pickKey = async () => {
    const [file] = await api.dialog.open({ title: 'Приватный ключ' })
    if (file) set('keyPath', file)
  }

  return (
    <Modal
      title={p ? 'Изменить подключение' : 'Новое подключение'}
      onClose={props.onClose}
      closeOnBackdrop={false}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            Отмена
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={save}>
            {busy && <span className="spinner" />}
            Сохранить
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        <div className="field">
          <label>Название</label>
          <input className="input" placeholder="Мой сервер" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </div>
        <div className="grid-3">
          <div className="field">
            <label>Адрес (хост)</label>
            <input className="input mono" placeholder="mc.example.com" value={form.host} onChange={(e) => onHostChange(e.target.value)} />
          </div>
          <div className="field">
            <label>Порт</label>
            <input className="input mono" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
          </div>
          <div className="field">
            <label>Пользователь</label>
            <input className="input mono" placeholder="root" value={form.username} onChange={(e) => set('username', e.target.value)} />
          </div>
        </div>
        <div className="callout">
          <span>
            На хостингах Minecraft SFTP часто работает на порту <b>2022</b>, а логин имеет вид <span className="mono">user.abc123</span> — смотрите
            данные SFTP в панели хостинга.
          </span>
        </div>

        <div className="field">
          <label>Способ входа</label>
          <div className="seg">
            <button className={form.authType === 'password' ? 'on' : ''} onClick={() => set('authType', 'password')}>
              <Lock size={14} /> Пароль
            </button>
            <button className={form.authType === 'key' ? 'on' : ''} onClick={() => set('authType', 'key')}>
              <KeyRound size={14} /> SSH-ключ
            </button>
          </div>
        </div>

        {form.authType === 'key' && (
          <div className="field">
            <label>Файл приватного ключа</label>
            <div className="row">
              <input className="input mono" value={form.keyPath} placeholder="C:\Users\...\.ssh\id_ed25519" onChange={(e) => set('keyPath', e.target.value)} />
              <button className="btn" onClick={pickKey}>
                <FolderOpen size={15} /> Обзор
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label>{form.authType === 'key' ? 'Парольная фраза ключа (если есть)' : 'Пароль'}</label>
          <input
            className="input"
            type="password"
            value={secret}
            placeholder={p?.hasSecret && !clearSecret ? '•••••••• (сохранён — оставьте пустым, чтобы не менять)' : form.authType === 'password' ? 'Оставьте пустым, чтобы вводить при подключении' : ''}
            onChange={(e) => setSecret(e.target.value)}
          />
          {p?.hasSecret && !secret && (
            <label className="check" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
              Удалить сохранённый пароль
            </label>
          )}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Стартовая папка</label>
            <input className="input mono" placeholder="домашняя" value={form.remotePath} onChange={(e) => set('remotePath', e.target.value)} />
          </div>
          <div className="field">
            <label>Цвет</label>
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
