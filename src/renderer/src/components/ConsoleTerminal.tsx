import { useCallback, useEffect, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import { XTerm } from './XTerm'

const PROMPT = '\x1b[1;32m>\x1b[0m '
const PROMPT_LEN = 2
/** Классический шрифт 8×16 — лучше всего выглядит при размере, кратном 16 */
const CONSOLE_OPTIONS = {
  fontFamily: "'Classic Console Neue', 'Cascadia Mono', Consolas, monospace",
  fontSize: 16,
  lineHeight: 1,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: 'block' as const,
  cursorInactiveStyle: 'outline' as const
}
const stripAnsi =(s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

/**
 * Классическая консоль: ввод прямо в терминале после «> » с мигающим блочным курсором.
 * Вывод сервера печатается над строкой ввода, набранный текст не теряется.
 *
 * Клавиши: Enter, ←/→, Home/End, Backspace/Delete, ↑/↓ — история,
 * Ctrl+C — сбросить строку, Ctrl+U — стереть строку, Ctrl+W — стереть слово, Ctrl+L — очистить экран.
 */
export function ConsoleTerminal(props: {
  visible: boolean
  /** можно ли сейчас вводить команды */
  enabled: boolean
  /** подписка на вывод; вызывайте write(data) для каждого куска текста */
  subscribe: (write: (data: string) => void) => () => void
  onCommand: (cmd: string) => Promise<unknown>
  /** печатать введённую команду локально (если сервер сам её не повторяет) */
  echo?: boolean
}) {
  const enabledRef = useRef(props.enabled)
  const cmdRef = useRef(props.onCommand)
  cmdRef.current = props.onCommand
  const ctl = useRef<{ setEnabled: (v: boolean) => void } | null>(null)

  useEffect(() => {
    enabledRef.current = props.enabled
    ctl.current?.setEnabled(props.enabled)
  }, [props.enabled])

  const attach = useCallback(
    (term: Terminal) => {
      // Все изменения за один такт отправляем одной записью в режиме синхронного вывода:
      // иначе xterm успевает отрисовать «пустую» строку между стиранием и перерисовкой,
      // и стрелка «>» мигает, а курсор на долю секунды прыгает в начало строки.
      let queue = ''
      const flush = () => {
        const s = queue
        queue = ''
        if (s) term.write('\x1b[?2026h' + s + '\x1b[?2026l')
      }
      const w = (s: string) => {
        if (!queue) queueMicrotask(flush)
        queue += s
      }

      const st = {
        buf: '',
        pos: 0,
        curRow: 0, // строка курсора относительно начала строки ввода
        drawn: false,
        hist: [] as string[],
        hi: -1,
        draft: '',
        pending: '', // незавершённая строка вывода
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        echoCmd: null as string | null,
        echoUntil: 0
      }

      const clearInput = () => {
        if (!st.drawn) return
        w((st.curRow > 0 ? `\x1b[${st.curRow}A` : '') + '\r\x1b[J')
        st.drawn = false
        st.curRow = 0
      }

      const drawInput = () => {
        if (!enabledRef.current) return
        const c = term.cols
        const end = PROMPT_LEN + st.buf.length
        const target = PROMPT_LEN + st.pos
        const endRow = end > 0 && end % c === 0 ? end / c - 1 : Math.floor(end / c)
        const tRow = Math.floor(target / c)
        const tCol = target % c
        let s = PROMPT + st.buf
        if (endRow > tRow) s += `\x1b[${endRow - tRow}A`
        else if (tRow > endRow) s += '\r\n'
        s += '\r' + (tCol ? `\x1b[${tCol}C` : '')
        w(s)
        st.drawn = true
        st.curRow = tRow
      }

      const redraw = () => {
        clearInput()
        drawInput()
      }

      const writeLines = (text: string) => {
        // скрываем «эхо» сервера, если команду уже напечатали сами
        if (st.echoCmd && Date.now() < st.echoUntil) {
          const lines = text.split('\r\n')
          const i = lines.findIndex((l) => stripAnsi(l).trim() === st.echoCmd)
          if (i >= 0) {
            lines.splice(i, 1)
            st.echoCmd = null
            text = lines.join('\r\n')
          }
        }
        if (text) w(text)
      }

      const output = (data: string) => {
        st.pending += data.replace(/\r?\n/g, '\r\n')
        const idx = st.pending.lastIndexOf('\n')
        if (idx >= 0) {
          const complete = st.pending.slice(0, idx + 1)
          st.pending = st.pending.slice(idx + 1)
          clearInput()
          writeLines(complete)
          drawInput()
        }
        clearTimeout(st.timer)
        if (st.pending) {
          // хвост без перевода строки — выводим, если продолжение не пришло
          st.timer = setTimeout(() => {
            if (!st.pending) return
            clearInput()
            w(st.pending + '\r\n')
            st.pending = ''
            drawInput()
          }, 150)
        }
      }

      const submit = () => {
        const cmd = st.buf.trim().replace(/^\//, '')
        clearInput()
        st.buf = ''
        st.pos = 0
        st.hi = -1
        if (cmd) {
          st.hist = [cmd, ...st.hist.filter((h) => h !== cmd)].slice(0, 100)
          if (props.echo) {
            w(`\x1b[90m> ${cmd}\x1b[0m\r\n`)
            st.echoCmd = cmd
            st.echoUntil = Date.now() + 2000
          }
          cmdRef.current(cmd).catch((e: Error) => output(`\x1b[31m[Nexus] ${e.message}\x1b[0m\n`))
        }
        drawInput()
      }

      const histMove = (dir: 1 | -1) => {
        if (!st.hist.length) return
        if (st.hi === -1 && dir === 1) st.draft = st.buf
        const next = Math.max(-1, Math.min(st.hist.length - 1, st.hi + dir))
        if (next === st.hi) return
        st.hi = next
        st.buf = next === -1 ? st.draft : st.hist[next]
        st.pos = st.buf.length
        redraw()
      }

      const insert = (text: string) => {
        const clean = text.replace(/[\x00-\x1f\x7f]/g, '')
        if (!clean) return
        st.buf = st.buf.slice(0, st.pos) + clean + st.buf.slice(st.pos)
        st.pos += clean.length
      }

      const onData = term.onData((d) => {
        if (!enabledRef.current) return
        switch (d) {
          case '\r':
            return submit()
          case '\x7f':
          case '\b':
            if (st.pos > 0) {
              st.buf = st.buf.slice(0, st.pos - 1) + st.buf.slice(st.pos)
              st.pos--
              redraw()
            }
            return
          case '\x1b[3~':
            if (st.pos < st.buf.length) {
              st.buf = st.buf.slice(0, st.pos) + st.buf.slice(st.pos + 1)
              redraw()
            }
            return
          case '\x1b[D':
            if (st.pos > 0) st.pos--, redraw()
            return
          case '\x1b[C':
            if (st.pos < st.buf.length) st.pos++, redraw()
            return
          case '\x1b[H':
          case '\x1bOH':
          case '\x1b[1~':
            st.pos = 0
            return redraw()
          case '\x1b[F':
          case '\x1bOF':
          case '\x1b[4~':
            st.pos = st.buf.length
            return redraw()
          case '\x1b[A':
            return histMove(1)
          case '\x1b[B':
            return histMove(-1)
          case '\x03': // Ctrl+C
            clearInput()
            if (st.buf) w(`${PROMPT}${st.buf}\x1b[90m^C\x1b[0m\r\n`)
            st.buf = ''
            st.pos = 0
            st.hi = -1
            return drawInput()
          case '\x15': // Ctrl+U
            st.buf = st.buf.slice(st.pos)
            st.pos = 0
            return redraw()
          case '\x17': {
            // Ctrl+W
            const left = st.buf.slice(0, st.pos).replace(/\S+\s*$/, '')
            st.buf = left + st.buf.slice(st.pos)
            st.pos = left.length
            return redraw()
          }
          case '\x0c': // Ctrl+L
            clearInput()
            flush()
            term.clear()
            return drawInput()
          case '\t':
            return
        }
        if (d.startsWith('\x1b')) return // прочие спец-клавиши
        // обычный ввод или вставка (возможно, несколько строк)
        const lines = d.replace(/\r\n/g, '\r').split(/[\r\n]/)
        lines.forEach((line, i) => {
          insert(line)
          if (i < lines.length - 1) submit()
        })
        redraw()
      })

      // перерисовка строки ввода при изменении ширины
      const onResize = term.onResize(() => {
        st.drawn = false
        w('\r\x1b[J')
        drawInput()
      })

      ctl.current = {
        setEnabled(v) {
          if (v) {
            w('\x1b[?25h')
            redraw()
          } else {
            clearInput()
            w('\x1b[?25l')
          }
        }
      }
      if (!enabledRef.current) w('\x1b[?25l')

      const unsub = props.subscribe(output)
      drawInput()

      return () => {
        clearTimeout(st.timer)
        onData.dispose()
        onResize.dispose()
        unsub()
        ctl.current = null
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <XTerm visible={props.visible} attach={attach} options={CONSOLE_OPTIONS} />
    </div>
  )
}
