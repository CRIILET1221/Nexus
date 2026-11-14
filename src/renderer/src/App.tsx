import { useCallback, useEffect, useState } from 'react'
import { Boxes, Plug, X, Terminal as TermIcon } from 'lucide-react'
import type { ConnectionProfile, ServerRuntime, SessionInfo } from '@shared/types'
import { api } from './api'
import { PromptModal, useToast } from './components/ui'
import { Connections } from './views/Connections'
import { SessionView } from './views/SessionView'
import { LocalServers } from './views/LocalServers'

type View = { kind: 'connections' } | { kind: 'local' } | { kind: 'session'; id: string }

export function App() {
  const toast = useToast()
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [view, setView] = useState<View>({ kind: 'connections' })
  const [connecting, setConnecting] = useState<string | null>(null)
  const [askPassword, setAskPassword] = useState<ConnectionProfile | null>(null)
  const [savePassword, setSavePassword] = useState(true)
  const [runningCount, setRunningCount] = useState(0)

  const reloadProfiles = useCallback(() => api.profiles.list().then(setProfiles), [])

  useEffect(() => {
    reloadProfiles()
    api.mc.runtimes().then((r) => setRunningCount(r.length))
    const offStatus = api.on('server:status', () => api.mc.runtimes().then((r: ServerRuntime[]) => setRunningCount(r.length)))
    const offClosed = api.on('session:closed', ({ id }: { id: string }) => {
      setSessions((list) => {
        const s = list.find((x) => x.id === id)
        if (s) toast(`Соединение с «${s.name}» разорвано`, 'error')
        return list.filter((x) => x.id !== id)
      })
      setView((v) => (v.kind === 'session' && v.id === id ? { kind: 'connections' } : v))
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
    view.kind === 'connections' ? 'Подключения' : view.kind === 'local' ? 'Локальные серверы' : activeSession?.host ?? ''

  return (
    <div className="app">
      <div className="titlebar">
        <div className="logo">N</div>
        <span className="title">Nexus</span>
        <span className="subtitle">· {subtitle}</span>
      </div>
      <div className="body">
        <aside className="sidebar">
          <button className={`nav-item ${view.kind === 'connections' ? 'active' : ''}`} onClick={() => setView({ kind: 'connections' })}>
            <Plug size={17} />
            <span className="grow">Подключения</span>
            {profiles.length > 0 && <span className="badge">{profiles.length}</span>}
          </button>
          <button className={`nav-item ${view.kind === 'local' ? 'active' : ''}`} onClick={() => setView({ kind: 'local' })}>
            <Boxes size={17} />
            <span className="grow">Локальные серверы</span>
            {runningCount > 0 && <span className="badge green">{runningCount} онлайн</span>}
          </button>

          <div className="section">Активные сессии</div>
          {sessions.length === 0 && <div className="empty">Нет открытых подключений</div>}
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
                title="Отключиться"
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
            <TermIcon size={12} style={{ verticalAlign: -2 }} /> Nexus 0.1 · SFTP / SSH / Minecraft
          </div>
        </aside>

        <main className="main">
          {view.kind === 'connections' && (
            <Connections profiles={profiles} connecting={connecting} onConnect={connect} onChanged={reloadProfiles} />
          )}
          <div style={{ display: view.kind === 'local' ? 'contents' : 'none' }}>
            <LocalServers visible={view.kind === 'local'} />
          </div>
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
          title={`Пароль для ${askPassword.username}@${askPassword.host}`}
          label="Пароль"
          password
          okText="Подключиться"
          extra={
            <label className="check">
              <input type="checkbox" checked={savePassword} onChange={(e) => setSavePassword(e.target.checked)} />
              <span>
                Сохранить пароль
                <div className="muted" style={{ fontSize: 12 }}>
                  Хранится зашифрованным средствами Windows (DPAPI)
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
