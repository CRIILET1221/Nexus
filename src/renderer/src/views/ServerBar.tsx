import { useCallback, useEffect, useState } from 'react'
import { Copy, Cpu, MemoryStick, Play, RotateCcw, Square } from 'lucide-react'
import { api } from '../api'
import { fetchPanelServer, gameAddress } from '../adapter'
import { useAction, useToast } from '../components/ui'
import { formatBytes } from '../util'
import { tr } from '@shared/i18n'

type State = 'offline' | 'starting' | 'running' | 'stopping'

const TEXT: Record<State, string> = { offline: tr('Выключен'), starting: tr('Запускается'), running: tr('Работает'), stopping: tr('Останавливается') }
const DOT: Record<State, string> = { offline: '', starting: 'warn', running: 'green', stopping: 'warn' }

/**
 * Строка состояния сервера хостинга в шапке сессии: статус, нагрузка, адрес для игроков
 * и кнопки питания — доступны с любой вкладки.
 */
export function ServerBar(props: { profileId: string; sftpHost: string; active: boolean }) {
  const run = useAction()
  const toast = useToast()
  const [state, setState] = useState<State | null>(null)
  const [res, setRes] = useState<{ cpu: number; mem: number; memLimit: number } | null>(null)
  const [addr, setAddr] = useState<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const r = await api.panel.request<any>(props.profileId, 'GET', '/resources')
      const a = r?.attributes
      setState((a?.current_state as State) ?? 'offline')
      setRes(a?.resources ? { cpu: a.resources.cpu_absolute ?? 0, mem: a.resources.memory_bytes ?? 0, memLimit: 0 } : null)
    } catch {
      setState(null)
    }
  }, [props.profileId])

  useEffect(() => {
    fetchPanelServer(props.profileId)
      .then((info) => {
        const g = gameAddress(info, props.sftpHost)
        setAddr(g.port === 25565 ? g.host : `${g.host}:${g.port}`)
        setRes((r) => (r ? { ...r, memLimit: info.limits.memory * 1024 * 1024 } : r))
      })
      .catch(() => undefined)
  }, [props.profileId, props.sftpHost])

  useEffect(() => {
    if (!props.active) return
    poll()
    const t = setInterval(poll, state === 'starting' || state === 'stopping' ? 2000 : 6000)
    return () => clearInterval(t)
  }, [props.active, poll, state])

  const power = async (signal: 'start' | 'stop' | 'restart') => {
    await run(() => api.panel.request(props.profileId, 'POST', '/power', { signal }))
    setState(signal === 'stop' ? 'stopping' : 'starting')
    setTimeout(poll, 1200)
  }

  return (
    <div className="server-bar">
      {state && (
        <span className="sb-state">
          <span className={`dot ${DOT[state]}`} /> {TEXT[state]}
        </span>
      )}
      {res && state === 'running' && (
        <>
          <span className="sb-metric" title={tr('Нагрузка на процессор')}>
            <Cpu size={13} /> {res.cpu.toFixed(0)}%
          </span>
          <span className="sb-metric" title={tr('Оперативная память')}>
            <MemoryStick size={13} /> {formatBytes(res.mem)}
          </span>
        </>
      )}
      {addr && (
        <button
          className="sb-addr mono"
          title={tr('Адрес для входа в игру — нажмите, чтобы скопировать')}
          onClick={() => navigator.clipboard.writeText(addr).then(() => toast(tr('Скопировано: {0}', addr), 'success'))}
        >
          {addr} <Copy size={12} />
        </button>
      )}
      {state && (
        <div className="sb-power">
          {state === 'offline' ? (
            <button className="btn sm primary" onClick={() => power('start')}>
              <Play size={13} fill="currentColor" />{' '}{tr('Запустить')}
            </button>
          ) : (
            <>
              <button className="btn sm" disabled={state === 'stopping'} onClick={() => power('restart')}>
                <RotateCcw size={13} />{' '}{tr('Перезапуск')}
              </button>
              <button className="btn sm danger" disabled={state === 'stopping'} onClick={() => power('stop')}>
                <Square size={12} fill="currentColor" />{' '}{tr('Стоп')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
