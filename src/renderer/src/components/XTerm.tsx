import { useEffect, useRef } from 'react'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

export const TERM_THEME: ITerminalOptions['theme'] = {
  background: '#07090d',
  foreground: '#d7dce6',
  cursor: '#34d399',
  cursorAccent: '#07090d',
  selectionBackground: 'rgba(96,165,250,0.35)',
  black: '#1b2030',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d7dce6',
  brightBlack: '#5c6680',
  brightRed: '#fca5a5',
  brightGreen: '#6ee7b7',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff'
}

/**
 * Обёртка над xterm.js. attach() вызывается один раз после монтирования
 * и должна вернуть функцию очистки.
 */
export function XTerm(props: {
  attach: (term: Terminal) => (() => void) | void
  visible: boolean
  options?: ITerminalOptions
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const options: ITerminalOptions = {
      fontFamily: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      theme: TERM_THEME,
      ...props.options
    }
    // xterm меряет ширину символа при открытии — сначала дожидаемся загрузки шрифта
    let disposed = false
    let cleanup: (() => void) | undefined
    const first = options.fontFamily!.split(',')[0].trim()
    document.fonts
      .load(`${options.fontSize}px ${first}`)
      .catch(() => undefined)
      .then(() => {
        if (!disposed) cleanup = init(options)
      })
    return () => {
      disposed = true
      cleanup?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function init(options: ITerminalOptions) {
    const term = new Terminal(options)
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(ref.current!)
    // WebGL-рендер: быстрее и рисует символы строго по сетке (кириллица не «вылезает»)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      /* без WebGL остаётся DOM-рендер */
    }
    termRef.current = term
    fitRef.current = fit

    // Копирование/вставка: Ctrl+C при выделении, Ctrl+Shift+C/V, Ctrl+V
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const key = e.key.toLowerCase()
      if (e.ctrlKey && key === 'c' && (e.shiftKey || term.hasSelection())) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (e.ctrlKey && key === 'v') {
        e.preventDefault()
        navigator.clipboard.readText().then((t) => t && term.paste(t))
        return false
      }
      return true
    })
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      if (term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
      } else navigator.clipboard.readText().then((t) => t && term.paste(t))
    }
    ref.current!.addEventListener('contextmenu', onContext)

    const safeFit = () => {
      const el = ref.current
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        try {
          fit.fit()
        } catch {
          /* ignore */
        }
      }
    }
    safeFit()
    const ro = new ResizeObserver(() => safeFit())
    ro.observe(ref.current!)

    const detach = props.attach(term)
    const el = ref.current!
    if (props.visible) requestAnimationFrame(() => (safeFit(), !options.disableStdin && term.focus()))
    return () => {
      ro.disconnect()
      el.removeEventListener('contextmenu', onContext)
      detach?.()
      term.dispose()
    }
  }

  useEffect(() => {
    if (props.visible) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
        } catch {
          /* ignore */
        }
        if (!props.options?.disableStdin) termRef.current?.focus()
      })
    }
  }, [props.visible, props.options?.disableStdin])

  // отступы — на внешней обёртке: FitAddon меряет родителя без учёта его padding
  return (
    <div className={props.className ?? 'term-wrap'}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}
