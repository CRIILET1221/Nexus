import { useEffect, useRef, useState } from 'react'
import MonacoEditor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import { FileCode2, Save } from 'lucide-react'
import { Modal, useToast } from './ui'
import { languageFor } from '../util'

// Monaco работает локально, без CDN
;(self as any).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  }
}
loader.config({ monaco })

monaco.editor.defineTheme('nexus', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0b0d12',
    'editor.lineHighlightBackground': '#151924',
    'editorLineNumber.foreground': '#3c4458',
    'editorLineNumber.activeForeground': '#aab2c5',
    'editorGutter.background': '#0b0d12'
  }
})

/** Модальный редактор текстового файла (удалённого или локального) */
export function EditorModal(props: {
  title: string
  path: string
  load: () => Promise<string>
  save: (content: string) => Promise<void>
  onClose: () => void
}) {
  const toast = useToast()
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const value = useRef('')

  useEffect(() => {
    props.load().then(
      (text) => {
        value.current = text
        setContent(text)
      },
      (e: Error) => setError(e.message)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doSave = async () => {
    setSaving(true)
    try {
      await props.save(value.current)
      setDirty(false)
      toast('Файл сохранён', 'success')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(doSave)
  saveRef.current = doSave

  const close = async () => {
    if (dirty) {
      const ok = window.confirm('Есть несохранённые изменения. Закрыть без сохранения?')
      if (!ok) return
    }
    props.onClose()
  }

  return (
    <Modal
      size="full"
      closeOnBackdrop={false}
      icon={<FileCode2 size={18} color="var(--blue)" />}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {props.title}
          {dirty && <span className="dirty" title="Есть несохранённые изменения" />}
          <span className="muted mono" style={{ fontSize: 12, fontWeight: 400 }}>
            {props.path}
          </span>
        </span>
      }
      onClose={close}
      footer={
        <>
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
            Ctrl+S — сохранить · Esc — закрыть
          </span>
          <button className="btn" onClick={close}>
            Закрыть
          </button>
          <button className="btn primary" disabled={!dirty || saving || content === null} onClick={doSave}>
            {saving ? <span className="spinner" /> : <Save size={15} />}
            Сохранить
          </button>
        </>
      }
    >
      <div className="editor-wrap" style={{ marginTop: 12 }}>
        {error ? (
          <div className="empty-state">
            <h3>Не удалось открыть файл</h3>
            <div>{error}</div>
          </div>
        ) : content === null ? (
          <div className="empty-state">
            <span className="spinner" />
          </div>
        ) : (
          <MonacoEditor
            theme="nexus"
            defaultValue={content}
            language={languageFor(props.path)}
            onChange={(v) => {
              value.current = v ?? ''
              setDirty(true)
            }}
            onMount={(editor) => {
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
              editor.focus()
            }}
            options={{
              fontFamily: "'Cascadia Code', Consolas, monospace",
              fontSize: 13.5,
              minimap: { enabled: true, scale: 1 },
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              scrollBeyondLastLine: false,
              renderWhitespace: 'selection',
              tabSize: 2,
              padding: { top: 10 }
            }}
          />
        )}
      </div>
    </Modal>
  )
}
