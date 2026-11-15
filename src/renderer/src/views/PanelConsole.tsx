import { useCallback, useRef, useState } from 'react'
import {
  AlertTriangle, Cpu, ExternalLink, KeyRound, MemoryStick, Play, RefreshCw, RotateCcw, Search, Settings2, Skull,
  Square, Timer, Wifi, WifiOff
} from 'lucide-react'
import type { ConnectionProfile, PanelLink, PanelState, PanelStats } from '@shared/types'
import { api } from '../api'
import { useAction, useToast } from '../components/ui'
import { ConsoleTerminal } from '../components/ConsoleTerminal'
import { formatBytes, formatUptime } from '../util'
import { tr } from '@shared/i18n'

const STATE: Record<PanelState, { text: string; dot: string }> = {
  offline: { text: tr('Выключен'), dot: '' },
  starting: { text: tr('Запускается…'), dot: 'warn' },
  running: { text: tr('Работает'), dot: 'green' },
  stopping: { text: tr('Останавливается…'), dot: 'warn' }
}

/** Консоль Minecraft-сервера на хостинге через API панели (Pterodactyl) */
export function PanelConsole(props: { profile: ConnectionProfile; visible: boolean; onProfileChanged: () => void }) {
  const p = props.profile
  const configured = !!(p.panelUrl && p.panelServerId && p.hasPanelKey)
  const [setup, setSetup] = useState(false)

  if (!configured || setup)
    return (
      <PanelSetup
        profile={p}
        canCancel={configured}
        onCancel={() => setSetup(false)}
        onSaved={() => {
          setSetup(false)
          props.onProfileChanged()
        }}
      />
    )
  // key — чтобы после смены настроек консоль переподключилась
  return (
    <LiveConsole
      key={`${p.panelUrl}|${p.panelServerId}`}
      profile={p}
      visible={props.visible}
      onSettings={() => setSetup(true)}
    />
  )
}

function LiveConsole(props: { profile: ConnectionProfile; visible: boolean; onSettings: () => void }) {
  const run = useAction()
  const [consoleId, setConsoleId] = useState<string | null>(null)
  const [state, setState] = useState<PanelState>('offline')
  const [linkState, setLinkState] = useState<PanelLink>('connecting')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [stats, setStats] = useState<PanelStats | null>(null)
  const idRef = useRef<string | null>(null)

  const subscribe = useCallback(
    (write: (data: string) => void) => {
      const buffer: { id: string; data: string }[] = []
      const offs = [
        api.on('panel:output', (m: { id: string; data: string }) => {
          if (idRef.current === null) buffer.push(m)
          else if (m.id === idRef.current) write(m.data)
        }),
        api.on('panel:state', (m: { id: string; state: PanelState }) => m.id === idRef.current && setState(m.state)),
        api.on('panel:stats', (m: { id: string; stats: PanelStats }) => m.id === idRef.current && setStats(m.stats)),
        api.on('panel:link', (m: { id: string; state: PanelLink; error?: string }) => {
          if (m.id !== idRef.current) return
          setLinkState(m.state)
          setLinkError(m.error ?? null)
          if (m.state === 'connected') write(tr('\x1b[90m[NexAtom] Подключено к консоли сервера\x1b[0m\n'))
        })
      ]
      write(tr('\x1b[90m[NexAtom] Подключение к панели {0}…\x1b[0m\n', props.profile.panelUrl))
      let disposed = false
      api.panel.open(props.profile.id).then(
        (id) => {
          if (disposed) return void api.panel.close(id)
          idRef.current = id
          setConsoleId(id)
          for (const m of buffer) if (m.id === id) write(m.data)
        },
        (e: Error) => {
          write(`\x1b[31m[NexAtom] ${e.message}\x1b[0m\n`)
          setLinkState('closed')
          setLinkError(e.message)
        }
      )
      return () => {
        disposed = true
        offs.forEach((o) => o())
        if (idRef.current) api.panel.close(idRef.current)
        idRef.current = null
      }
    },
    [props.profile.id, props.profile.panelUrl]
  )

  const sendCommand = (c: string) => {
    if (!idRef.current) return Promise.reject(new Error(tr('Нет связи с консолью сервера')))
    return api.panel.command(idRef.current, c)
  }

  const power = (signal: 'start' | 'stop' | 'restart' | 'kill') => consoleId && run(() => api.panel.power(consoleId, signal))
  const connected = linkState === 'connected'
  const st = STATE[state] ?? STATE.offline

  return (
    <>
      <div className="term-bar" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span className={`dot ${connected ? st.dot : ''}`} />
        <b style={{ fontSize: 13 }}>{connected ? st.text : linkState === 'closed' ? tr('Нет связи') : tr('Подключение…')}</b>
        {connected ? (
          <span className="badge green" title={tr('Связь с консолью есть')}>
            <Wifi size={12} />{' '}{tr('онлайн')}
          </span>
        ) : linkState === 'closed' ? (
          <span className="badge red">
            <WifiOff size={12} />{' '}{tr('отключено')}
          </span>
        ) : (
          <span className="badge warn">
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> {linkState === 'reconnecting' ? tr('переподключение') : tr('подключение')}
          </span>
        )}
        {stats && state !== 'offline' && (
          <>
            <span className="badge" title={tr('Нагрузка процессора')}>
              <Cpu size={12} /> {stats.cpu.toFixed(0)}%
            </span>
            <span className="badge" title={tr('Оперативная память')}>
              <MemoryStick size={12} /> {formatBytes(stats.memory)}
              {stats.memoryLimit ? ` / ${formatBytes(stats.memoryLimit)}` : ''}
            </span>
            {stats.uptime > 0 && (
              <span className="badge" title={tr('Аптайм')}>
                <Timer size={12} /> {formatUptime(stats.uptime)}
              </span>
            )}
          </>
        )}
        <div className="spacer" />
        {state === 'offline' ? (
          <button className="btn sm primary" disabled={!connected} onClick={() => power('start')}>
            <Play size={13} fill="currentColor" />{' '}{tr('Запустить')}
          </button>
        ) : (
          <>
            <button className="btn sm" disabled={!connected || state === 'stopping'} onClick={() => power('restart')}>
              <RotateCcw size={13} />{' '}{tr('Перезапуск')}
            </button>
            <button className="btn sm danger" disabled={!connected || state === 'stopping'} onClick={() => power('stop')}>
              <Square size={12} fill="currentColor" />{' '}{tr('Остановить')}
            </button>
            {state === 'stopping' && (
              <button className="btn sm solid-danger" onClick={() => power('kill')} title={tr('Принудительно завершить')}>
                <Skull size={13} />{' '}{tr('Убить')}
              </button>
            )}
          </>
        )}
        {!connected && consoleId && (
          <button className="btn sm" onClick={() => api.panel.reconnect(consoleId)}>
            <RefreshCw size={13} />{' '}{tr('Переподключить')}
          </button>
        )}
        <button className="btn sm icon ghost" title={tr('Настройки консоли')} onClick={props.onSettings}>
          <Settings2 size={14} />
        </button>
      </div>
      {linkError && (
        <div className="callout danger" style={{ margin: '10px 14px 0', alignItems: 'center' }}>
          <AlertTriangle size={16} />
          <span style={{ flex: 1 }}>{linkError}</span>
          <button className="btn sm" onClick={props.onSettings}>
            {tr('Изменить настройки')}
          </button>
        </div>
      )}
      <ConsoleTerminal visible={props.visible} enabled={connected} subscribe={subscribe} onCommand={sendCommand} echo />
    </>
  )
}

// ---------- Настройка ----------

export function PanelSetup(props: { profile: ConnectionProfile; canCancel: boolean; onCancel: () => void; onSaved: () => void }) {
  const p = props.profile
  const toast = useToast()
  const run = useAction()
  const [url, setUrl] = useState(p.panelUrl ?? '')
  const [key, setKey] = useState('')
  const [servers, setServers] = useState<{ id: string; name: string }[] | null>(null)
  const [serverId, setServerId] = useState(p.panelServerId ?? guessServerId(p.username))
  const [busy, setBusy] = useState(false)

  const find = async () => {
    if (!url.trim() || (!key.trim() && !p.hasPanelKey)) return
    if (!key.trim()) {
      toast(tr('Введите API-ключ ещё раз, чтобы загрузить список серверов'), 'info')
      return
    }
    setBusy(true)
    const list = await run(() => api.panel.servers(url, key))
    setBusy(false)
    if (!list) return
    setServers(list)
    if (!list.length) toast(tr('По этому ключу не найдено ни одного сервера'), 'error')
    else if (!list.some((s) => s.id === serverId)) {
      const guess = guessServerId(p.username)
      setServerId(list.find((s) => s.id === guess)?.id ?? list[0].id)
    }
  }

  const save = async () => {
    setBusy(true)
    const panelUrl = await run(() => api.panel.normalize(url))
    if (panelUrl) {
      const ok = await run(
        () => api.profiles.save({ ...p, panelUrl, panelServerId: serverId.trim(), ...(key.trim() ? { panelKey: key.trim() } : {}) }),
        tr('Консоль настроена')
      )
      if (ok) props.onSaved()
    }
    setBusy(false)
  }

  const valid = url.trim() && serverId.trim() && (key.trim() || p.hasPanelKey)

  return (
    <div className="page">
      <div style={{ maxWidth: 640, margin: '0 auto' }} className="stack">
        <div>
          <h1 style={{ margin: 0, fontSize: 20 }}>{tr('Консоль сервера Minecraft')}</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {tr('Хостинги Minecraft дают по SFTP только файлы — SSH-консоли там нет. Консоль работает через API панели хостинга (Pterodactyl и совместимые). Настраивается один раз.')}
          </p>
        </div>

        <div className="card stack" style={{ padding: 18 }}>
          <div className="field">
            <label>{tr('1. Адрес панели хостинга')}</label>
            <input className="input mono" placeholder="https://panel.myhost.com" value={url} onChange={(e) => setUrl(e.target.value)} />
            <span className="hint">{tr('Сайт, где вы запускаете и останавливаете сервер. Можно вставить ссылку на страницу сервера.')}</span>
          </div>

          <div className="field">
            <label>{tr('2. API-ключ клиента')}</label>
            <input
              className="input mono"
              type="password"
              placeholder={p.hasPanelKey ? tr('•••••••• (сохранён — оставьте пустым, чтобы не менять)') : 'ptlc_…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <div className="callout" style={{ marginTop: 4 }}>
              <KeyRound size={16} />
              <span>
                {tr('В панели откройте')}{' '}<b>{tr('Аккаунт → API-ключи')}</b>{' '}{tr('(Account → API Credentials), нажмите «Создать», поле «Разрешённые IP» оставьте пустым и скопируйте ключ. Он хранится зашифрованным на этом ПК.')}
                {url.trim() && (
                  <>
                    {' '}
                    <a className="link" onClick={() => api.panel.normalize(url).then((u) => api.fs.openExternal(`${u}/account/api`)).catch(() => undefined)}>
                      {tr('Открыть страницу ключей')}{' '}<ExternalLink size={11} style={{ verticalAlign: -1 }} />
                    </a>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="field">
            <label>{tr('3. Сервер')}</label>
            <div className="row">
              {servers && servers.length > 0 ? (
                <select className="select" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input mono" placeholder={tr('ID сервера, например 1a2b3c4d')} value={serverId} onChange={(e) => setServerId(e.target.value)} />
              )}
              <button className="btn" disabled={busy || !url.trim() || !key.trim()} onClick={find}>
                {busy ? <span className="spinner" /> : <Search size={15} />}{' '}{tr('Найти серверы')}
              </button>
            </div>
            <span className="hint">
              {tr('ID — 8 символов из адреса страницы сервера в панели (…/server/')}<b>1a2b3c4d</b>{tr('). Обычно он же стоит в SFTP-логине после точки.')}
            </span>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {props.canCancel && (
            <button className="btn" onClick={props.onCancel}>
              {tr('Отмена')}
            </button>
          )}
          <button className="btn primary" disabled={!valid || busy} onClick={save}>
            {busy && <span className="spinner" />}
            {tr('Сохранить и подключить')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Pterodactyl: SFTP-логин вида "username.1a2b3c4d" → "1a2b3c4d" */
function guessServerId(username: string) {
  const m = username.match(/\.([a-z0-9]{8})$/i)
  return m ? m[1].toLowerCase() : ''
}
