import { useCallback, useEffect, useRef, useState } from 'react'
import { Boxes, Plug, X, Languages, Terminal as TermIcon } from 'lucide-react'
import { LANGS, getLang } from '@shared/i18n'
import { changeLang } from './langInit'
import { AtomMark } from './components/Logo'
import type { ConnectionProfile, ServerRuntime, SessionInfo } from '@shared/types'
import { api } from './api'
import { PromptModal, useToast } from './components/ui'
import { Connections } from './views/Connections'
import { SessionView } from './views/SessionView'
import { LocalServers } from './views/LocalServers'
import { tr } from '@shared/i18n'

type View = { kind: 'connections' } | { kind: 'local' } | { kind: 'session'; id: string }

export function App() {
  const toast = useToast()
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [view, setView] = useState<View>(() => {
    // после смены языка возвращаемся на тот же экран
    try {
      const v = sessionStorage.getItem('nexus.view')
      sessionStorage.removeItem('nexus.view')
      if (v) return JSON.parse(v) as View
    } catch {
      /* нет сохранённого экрана */
    }
    return { kind: 'connections' }
  })
  const [connecting, setConnecting] = useState<string | null>(null)
  const [askPassword, setAskPassword] = useState<ConnectionProfile | null>(null)
  const [savePassword, setSavePassword] = useState(true)
  const [runningCount, setRunningCount] = useState(0)
  const [version, setVersion] = useState('')
  const [reconnecting, setReconnecting] = useState<Record<string, string>>({})
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  const viewRef = useRef(view)
  viewRef.current = view

  const reloadProfiles = useCallback(() => api.profiles.list().then(setProfiles), [])

  useEffect(() => {
    reloadProfiles()
    api.app.version().then(setVersion).catch(() => undefined)
    // подключения, открытые до перезагрузки интерфейса
    api.ssh.list().then((list) => list.length && setSessions(list)).catch(() => undefined)
    api.mc.runtimes().then((r) => setRunningCount(r.length))
    const offStatus = api.on('server:status', () => api.mc.runtimes().then((r: ServerRuntime[]) => setRunningCount(r.length)))
    const offClosed = api.on('session:closed', ({ id }: { id: string }) => {
      let lost: SessionInfo | undefined
      setSessions((list) => {
        lost = list.find((x) => x.id === id)
        return list.filter((x) => x.id !== id)
      })
      const wasOpen = viewRef.current.kind === 'session' && viewRef.current.id === id
      setTimeout(async () => {
        if (!lost) return
        const prof = profilesRef.current.find((p) => p.id === lost!.profileId)
        // пароль сохранён — тихо переподключаемся
        if (prof && (prof.hasSecret || prof.authType === 'key')) {
          toast(tr('Соединение с «{0}» разорвано — переподключаюсь…', lost.name), 'info')
          setReconnecting((r) => ({ ...r, [id]: lost!.name }))
          const done = () =>
            setReconnecting((r) => {
              const n = { ...r }
              delete n[id]
              return n
            })
          for (const delay of [1000, 3000, 6000, 10000]) {
            await new Promise((r) => setTimeout(r, delay))
            try {
              const s = await api.ssh.connect(prof.id)
              setSessions((list) => [...list, s])
              if (wasOpen && viewRef.current.kind === 'session' && viewRef.current.id === id) setView({ kind: 'session', id: s.id })
              toast(tr('Соединение с «{0}» восстановлено', lost.name), 'success')
              done()
              return
            } catch {
              /* пробуем ещё раз */
            }
          }
        }
        setReconnecting((r) => {
          const n = { ...r }
          delete n[id]
          return n
        })
        toast(tr('Соединение с «{0}» разорвано', lost.name), 'error')
        if (viewRef.current.kind === 'session' && viewRef.current.id === id) setView({ kind: 'connections' })
      }, 0)
    })
    return () => {
      offStatus()
      offClosed()
    }
  }, [reloadProfiles, toast])

  const doConnect = async (profile: ConnectionProfile, secret?: string, remember = false) => {
    setConnecting(profile.id)
    try {
      const session = await api.ssh.connect(profile.id, secret)
      if (secret && remember) {
        await api.profiles.save({ ...profile, secret })
        reloadProfiles()
      }
      setSessions((s) => [...s, session])
      setView({ kind: 'session', id: session.id })
      return true
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
      return false
    } finally {
      setConnecting(null)
    }
  }

  const connect = (profile: ConnectionProfile) => {
    // уже подключены — просто переключаемся
    const open = sessions.find((s) => s.profileId === profile.id)
    if (open) return setView({ kind: 'session', id: open.id })
    if (profile.authType === 'password' && !profile.hasSecret) {
      setSavePassword(true)
      setAskPassword(profile)
    } else doConnect(profile)
  }

  const disconnect = async (id: string) => {
    await api.ssh.disconnect(id)
    setSessions((s) => s.filter((x) => x.id !== id))
    setView((v) => (v.kind === 'session' && v.id === id ? { kind: 'connections' } : v))
  }

  const activeSession = view.kind === 'session' ? sessions.find((s) => s.id === view.id) : undefined
  const subtitle =
    view.kind === 'connections' ? tr('Подключения') : view.kind === 'local' ? tr('Локальные серверы') : activeSession?.host ?? ''

  return (
    <div className="app">
      <div className="titlebar">
        <div className="logo">
          <AtomMark size={17} />
        </div>
        <span className="title">NexAtom</span>
        <span className="subtitle">· {subtitle}</span>
      </div>
      <div className="body">
        <aside className="sidebar">
          <button className={`nav-item ${view.kind === 'connections' ? 'active' : ''}`} onClick={() => setView({ kind: 'connections' })}>
            <Plug size={17} />
            <span className="grow">{tr('Подключения')}</span>
            {profiles.length > 0 && <span className="badge">{profiles.length}</span>}
          </button>
          <button className={`nav-item ${view.kind === 'local' ? 'active' : ''}`} onClick={() => setView({ kind: 'local' })}>
            <Boxes size={17} />
            <span className="grow">{tr('Локальные серверы')}</span>
            {runningCount > 0 && <span className="badge green">{runningCount}{' '}{tr('онлайн')}</span>}
          </button>

          <div className="section">{tr('Активные сессии')}</div>
          {sessions.length === 0 && <div className="empty">{tr('Нет открытых подключений')}</div>}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`nav-item ${view.kind === 'session' && view.id === s.id ? 'active' : ''}`}
              onClick={() => setView({ kind: 'session', id: s.id })}
              role="button"
            >
              <span className="dot green" />
              <div className="grow">
                <div>{s.name}</div>
                <div className="sub mono">{s.host}</div>
              </div>
              <button
                className="btn ghost sm icon x"
                title={tr('Отключиться')}
                onClick={(e) => {
                  e.stopPropagation()
                  disconnect(s.id)
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="footer">
            <div className="lang-switch" title={tr('Язык интерфейса')}>
              <Languages size={13} />
              {LANGS.map((l) => (
                <button key={l.id} className={getLang() === l.id ? 'on' : ''} onClick={() => getLang() !== l.id && changeLang(l.id, view)}>
                  {l.short}
                </button>
              ))}
            </div>
            <TermIcon size={12} style={{ verticalAlign: -2 }} /> NexAtom {version}
          </div>
        </aside>

        <main className="main">
          {view.kind === 'connections' && (
            <Connections profiles={profiles} connecting={connecting} onConnect={connect} onChanged={reloadProfiles} />
          )}
          <div style={{ display: view.kind === 'local' ? 'contents' : 'none' }}>
            <LocalServers visible={view.kind === 'local'} />
          </div>
          {view.kind === 'session' && reconnecting[view.id] && (
            <div className="empty-state" style={{ position: 'absolute', inset: 0 }}>
              <span className="spinner" style={{ width: 26, height: 26 }} />
              <h3>{tr('Переподключение к «')}{reconnecting[view.id]}»…</h3>
              <div>{tr('Связь с сервером прервалась. NexAtom пробует восстановить соединение.')}</div>
            </div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                inset: 0,
                visibility: view.kind === 'session' && view.id === s.id ? 'visible' : 'hidden'
              }}
            >
              <SessionView
                session={s}
                profile={profiles.find((p) => p.id === s.profileId)}
                active={view.kind === 'session' && view.id === s.id}
                onDisconnect={() => disconnect(s.id)}
                onProfileChanged={reloadProfiles}
              />
            </div>
          ))}
        </main>
      </div>

      {askPassword && (
        <PromptModal
          title={tr('Пароль для {0}@{1}', askPassword.username, askPassword.host)}
          label={tr('Пароль')}
          password
          okText={tr('Подключиться')}
          extra={
            <label className="check">
              <input type="checkbox" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
              <span>
                {tr('Сохранить пароль')}
                <div className="muted" style={{ fontSize: 12 }}>
                  {tr('Хранится зашифрованным средствами Windows (DPAPI)')}
                </div>
              </span>
            </label>
          }
          onClose={() => setAskPassword(null)}
          onSubmit={async (pw) => {
            const p = askPassword
            if (await doConnect(p, pw, savePassword)) setAskPassword(null)
          }}
        />
      )}
    </div>
  )
}
