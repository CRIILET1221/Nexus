import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { tr } from '@shared/i18n'

// ---------- Модальное окно ----------

export function Modal(props: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'normal' | 'wide' | 'full'
  icon?: ReactNode
  closeOnBackdrop?: boolean
}) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const down = useRef(false)
  return (
    <div
      className="overlay"
      onMouseDown={(e) => (down.current = e.target === e.currentTarget)}
      onMouseUp={(e) => {
        if (props.closeOnBackdrop !== false && down.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal ${props.size === 'wide' ? 'wide' : props.size === 'full' ? 'full' : ''}`}>
        <div className="modal-head">
          {props.icon}
          <h2>{props.title}</h2>
          <button className="btn ghost sm icon" onClick={onClose} title={tr('Закрыть')}>
            <X size={16} />
          </button>
        </div>
        {props.children}
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}

// ---------- Уведомления ----------

type ToastKind = 'info' | 'success' | 'error'
interface Toast {
  id: number
  kind: ToastKind
  text: string
}

const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-4), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' ? <AlertCircle size={17} /> : t.kind === 'success' ? <CheckCircle2 size={17} /> : <Info size={17} />}
            <div style={{ flex: 1 }}>{t.text}</div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/** Оборачивает async-действие: показывает ошибку тостом */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        if (success) toast(success, 'success')
        return r
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error')
        return undefined
      }
    },
    [toast]
  )
}

// ---------- Контекстное меню ----------

export interface MenuItem {
  label?: string
  icon?: ReactNode
  kbd?: string
  danger?: boolean
  onClick?: () => void
  separator?: boolean
  hidden?: boolean
}

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: props.x, y: props.y })
  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({
        x: Math.min(props.x, window.innerWidth - r.width - 8),
        y: Math.min(props.y, window.innerHeight - r.height - 8)
      })
    }
    const close = () => props.onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="ctx" ref={ref} style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
      {props.items
        .filter((i) => !i.hidden)
        .map((item, idx) =>
          item.separator ? (
            <hr key={idx} />
          ) : (
            <button
              key={idx}
              className={item.danger ? 'danger' : ''}
              onClick={() => {
                props.onClose()
                item.onClick?.()
              }}
            >
              {item.icon}
              {item.label}
              {item.kbd && <kbd>{item.kbd}</kbd>}
            </button>
          )
        )}
    </div>
  )
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span />
    </label>
  )
}

/** Простое модальное окно ввода строки */
export function PromptModal(props: {
  title: string
  label?: string
  initial?: string
  okText?: string
  password?: boolean
  extra?: ReactNode
  onSubmit: (value: string) => void | Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(props.initial ?? '')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    // для имени файла выделяем без расширения
    const dot = (props.initial ?? '').lastIndexOf('.')
    if (dot > 0) el.setSelectionRange(0, dot)
    else el.select()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const submit = async () => {
    if (!value.trim() && !props.password) return
    setBusy(true)
    try {
      await props.onSubmit(value)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {tr('Отмена')}
          </button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy && <span className="spinner" />}
            {props.okText ?? 'OK'}
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        <div className="field">
          {props.label && <label>{props.label}</label>}
          <input
            ref={inputRef}
            className="input"
            type={props.password ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {props.extra}
      </div>
    </Modal>
  )
}
