import { useState } from 'react'
import { Plus, RotateCcw, SquareTerminal, X } from 'lucide-react'
import type { Terminal } from '@xterm/xterm'
import { api } from '../api'
import { XTerm } from '../components/XTerm'

interface Tab {
  key: number
  title: string
  exited: boolean
  gen: number
}

let counter = 1

export function ShellConsole(props: { sessionId: string; visible: boolean }) {
  const [tabs, setTabs] = useState<Tab[]>(() => [{ key: counter++, title: 'Терминал 1', exited: false, gen: 0 }])
  const [active, setActive] = useState(tabs[0].key)

  const add = () => {
    const key = counter++
    setTabs((t) => [...t, { key, title: `Терминал ${t.length + 1}`, exited: false, gen: 0 }])
    setActive(key)
  }
  const close = (key: number) => {
    setTabs((t) => {
      const next = t.filter((x) => x.key !== key)
      if (next.length === 0) {
        const k = counter++
        setActive(k)
        return [{ key: k, title: 'Терминал 1', exited: false, gen: 0 }]
      }
      if (key === active) setActive(next[next.length - 1].key)
      return next
    })
  }
  const update = (key: number, patch: Partial<Tab>) => setTabs((t) => t.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  return (
    <>
      <div className="term-bar">
        <div className="term-tabs">
          {tabs.map((t) => (
            <div key={t.key} className={`term-tab ${t.key === active ? 'on' : ''}`} onClick={() => setActive(t.key)}>
              <SquareTerminal size={13} />
              {t.title}
              <span
                className="x"
                onClick={(e) => {
                  e.stopPropagation()
                  close(t.key)
                }}
              >
                <X size={12} />
              </span>
            </div>
          ))}
        </div>
        <button className="btn ghost sm" onClick={add}>
          <Plus size={14} /> Новая вкладка
        </button>
      </div>
      <div className="term-body">
        {tabs.map((t) => (
          <div key={`${t.key}-${t.gen}`} className={t.key === active ? '' : 'hidden'}>
            <XTerm
              visible={props.visible && t.key === active}
              attach={(term) => attachShell(term, props.sessionId, () => update(t.key, { exited: true }))}
            />
            {t.exited && (
              <div className="term-closed">
                <span className="muted">Сеанс завершён</span>
                <button className="btn sm primary" onClick={() => update(t.key, { exited: false, gen: t.gen + 1 })}>
                  <RotateCcw size={13} /> Переподключить
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function attachShell(term: Terminal, sessionId: string, onExit: () => void) {
  let shellId: string | null = null
  let disposed = false
  const pending: { id: string; data: string }[] = []

  const offData = api.on('shell:data', (msg: { id: string; data: string }) => {
    if (shellId === null) pending.push(msg)
    else if (msg.id === shellId) term.write(msg.data)
  })
  const offExit = api.on('shell:exit', ({ id }: { id: string }) => {
    if (id === shellId) {
      term.write('\r\n\x1b[90m[соединение закрыто]\x1b[0m\r\n')
      onExit()
    }
  })

  term.write('\x1b[90mОткрываю SSH-консоль…\x1b[0m\r\n')
  api.shell
    .open(sessionId, term.cols, term.rows)
    .then((id) => {
      if (disposed) {
        api.shell.close(id)
        return
      }
      shellId = id
      for (const m of pending) if (m.id === id) term.write(m.data)
      pending.length = 0
    })
    .catch((e: Error) => {
      term.write(`\x1b[31mНе удалось открыть SSH-терминал.\x1b[0m\r\n${e.message}\r\n`)
      onExit()
    })

  const d1 = term.onData((data) => shellId && api.shell.write(shellId, data))
  const d2 = term.onResize(({ cols, rows }) => shellId && api.shell.resize(shellId, cols, rows))

  return () => {
    disposed = true
    offData()
    offExit()
    d1.dispose()
    d2.dispose()
    if (shellId) api.shell.close(shellId).catch(() => undefined)
  }
}
