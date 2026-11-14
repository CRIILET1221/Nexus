import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileCog, RotateCcw, Save, Search } from 'lucide-react'
import type { ServerAdapter } from '../adapter'
import { errText } from '../adapter'
import { Switch, useAction } from '../components/ui'
import { EditorModal } from '../components/Editor'

type Kind = 'bool' | 'number' | 'text' | 'password' | { options: [string, string][] }
interface Def {
  key: string
  label: string
  kind: Kind
}

const GROUPS: { title: string; defs: Def[] }[] = [
  {
    title: 'Основное',
    defs: [
      { key: 'motd', label: 'Описание сервера (MOTD)', kind: 'text' },
      { key: 'max-players', label: 'Максимум игроков', kind: 'number' },
      { key: 'gamemode', label: 'Режим игры', kind: { options: [['survival', 'Выживание'], ['creative', 'Творческий'], ['adventure', 'Приключение'], ['spectator', 'Наблюдатель']] } },
      { key: 'force-gamemode', label: 'Принудительный режим при входе', kind: 'bool' },
      { key: 'difficulty', label: 'Сложность', kind: { options: [['peaceful', 'Мирная'], ['easy', 'Лёгкая'], ['normal', 'Нормальная'], ['hard', 'Сложная']] } },
      { key: 'hardcore', label: 'Хардкор', kind: 'bool' },
      { key: 'pvp', label: 'PvP', kind: 'bool' },
      { key: 'online-mode', label: 'Лицензионный режим', kind: 'bool' },
      { key: 'white-list', label: 'Белый список', kind: 'bool' },
      { key: 'enforce-whitelist', label: 'Кикать не из белого списка', kind: 'bool' },
      { key: 'allow-flight', label: 'Разрешить полёт (без кика)', kind: 'bool' },
      { key: 'spawn-protection', label: 'Защита спавна (блоков)', kind: 'number' },
      { key: 'player-idle-timeout', label: 'Кик за AFK (минут, 0 — нет)', kind: 'number' }
    ]
  },
  {
    title: 'Мир',
    defs: [
      { key: 'level-name', label: 'Папка мира', kind: 'text' },
      { key: 'level-seed', label: 'Сид', kind: 'text' },
      {
        key: 'level-type',
        label: 'Тип мира',
        kind: { options: [['minecraft:normal', 'Обычный'], ['minecraft:flat', 'Плоский'], ['minecraft:large_biomes', 'Большие биомы'], ['minecraft:amplified', 'Расширенный']] }
      },
      { key: 'generate-structures', label: 'Генерировать постройки', kind: 'bool' },
      { key: 'allow-nether', label: 'Разрешить Незер', kind: 'bool' },
      { key: 'spawn-monsters', label: 'Монстры', kind: 'bool' },
      { key: 'spawn-animals', label: 'Животные', kind: 'bool' },
      { key: 'spawn-npcs', label: 'Жители', kind: 'bool' },
      { key: 'view-distance', label: 'Дальность прорисовки', kind: 'number' },
      { key: 'simulation-distance', label: 'Дальность симуляции', kind: 'number' },
      { key: 'max-world-size', label: 'Радиус мира', kind: 'number' }
    ]
  },
  {
    title: 'Сеть и доступ',
    defs: [
      { key: 'server-port', label: 'Порт', kind: 'number' },
      { key: 'server-ip', label: 'IP (обычно пусто)', kind: 'text' },
      { key: 'enable-status', label: 'Показывать в списке серверов', kind: 'bool' },
      { key: 'hide-online-players', label: 'Скрывать список игроков', kind: 'bool' },
      { key: 'enforce-secure-profile', label: 'Требовать подпись чата', kind: 'bool' },
      { key: 'prevent-proxy-connections', label: 'Блокировать VPN/прокси', kind: 'bool' },
      { key: 'enable-rcon', label: 'RCON', kind: 'bool' },
      { key: 'rcon.port', label: 'Порт RCON', kind: 'number' },
      { key: 'rcon.password', label: 'Пароль RCON', kind: 'password' },
      { key: 'enable-query', label: 'Query (GameSpy)', kind: 'bool' },
      { key: 'query.port', label: 'Порт Query', kind: 'number' },
      { key: 'network-compression-threshold', label: 'Порог сжатия', kind: 'number' }
    ]
  },
  {
    title: 'Прочее',
    defs: [
      { key: 'enable-command-block', label: 'Командные блоки', kind: 'bool' },
      { key: 'op-permission-level', label: 'Уровень прав OP', kind: { options: [['1', '1 — обход защиты спавна'], ['2', '2 — команды читов'], ['3', '3 — модерация'], ['4', '4 — все команды']] } },
      { key: 'function-permission-level', label: 'Уровень прав функций', kind: 'number' },
      { key: 'resource-pack', label: 'Ресурс-пак (URL)', kind: 'text' },
      { key: 'require-resource-pack', label: 'Обязательный ресурс-пак', kind: 'bool' },
      { key: 'sync-chunk-writes', label: 'Синхронная запись чанков', kind: 'bool' },
      { key: 'max-tick-time', label: 'Watchdog (мс, -1 — выкл.)', kind: 'number' },
      { key: 'entity-broadcast-range-percentage', label: 'Дальность сущностей, %', kind: 'number' }
    ]
  }
]

const KNOWN = new Set(GROUPS.flatMap((g) => g.defs.map((d) => d.key)))
const unescape = (v: string) => v.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')

function parse(text: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[#!]/.test(line) || !line.trim()) continue
    const idx = line.search(/[=:]/)
    if (idx < 0) continue
    m.set(line.slice(0, idx).trim(), unescape(line.slice(idx + 1).trim()))
  }
  return m
}

function serialize(original: string, values: Map<string, string>): string {
  const done = new Set<string>()
  const lines = original.split(/\r?\n/).map((line) => {
    if (/^\s*[#!]/.test(line) || !line.trim()) return line
    const idx = line.search(/[=:]/)
    if (idx < 0) return line
    const key = line.slice(0, idx).trim()
    if (!values.has(key)) return line
    done.add(key)
    return `${key}=${escape(values.get(key)!)}`
  })
  for (const [k, v] of values) if (!done.has(k)) lines.splice(lines.length - (lines[lines.length - 1] === '' ? 1 : 0), 0, `${k}=${escape(v)}`)
  return lines.join('\n')
}

export function PropertiesForm(props: { adapter: ServerAdapter; visible: boolean }) {
  const ad = props.adapter
  const run = useAction()
  const [original, setOriginal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<Map<string, string>>(new Map())
  const [initial, setInitial] = useState<Map<string, string>>(new Map())
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [raw, setRaw] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const text = await ad.readFile('server.properties')
      if (text === null) {
        setError('Файл server.properties ещё не создан — он появится после первого запуска сервера.')
        return
      }
      setOriginal(text)
      const m = parse(text)
      setValues(new Map(m))
      setInitial(m)
    } catch (e) {
      setError(errText(e))
    }
  }, [ad])

  useEffect(() => {
    if (props.visible && original === null) load()
  }, [props.visible, original, load])

  const changed = useMemo(() => [...values].filter(([k, v]) => initial.get(k) !== v).map(([k]) => k), [values, initial])
  const set = (k: string, v: string) => setValues((m) => new Map(m).set(k, v))

  const save = async (restart: boolean) => {
    if (original === null) return
    setSaving(true)
    const text = serialize(original, values)
    const ok = await run(async () => {
      await ad.writeFile('server.properties', text)
      if (restart && ad.restart) await ad.restart()
      return true
    }, restart ? 'Сохранено, сервер перезапускается' : 'Сохранено — применится после перезапуска')
    setSaving(false)
    if (ok) {
      setOriginal(text)
      setInitial(new Map(values))
    }
  }

  const q = query.trim().toLowerCase()
  const match = (key: string, label: string) => !q || key.includes(q) || label.toLowerCase().includes(q)
  const extra = [...values.keys()].filter((k) => !KNOWN.has(k) && match(k, k)).sort()

  if (error)
    return (
      <div className="view">
        <div className="empty-state">
          <FileCog size={28} />
          <div>{error}</div>
          <button className="btn" onClick={load}>
            Повторить
          </button>
        </div>
      </div>
    )
  if (original === null)
    return (
      <div className="view">
        <div className="empty-state">
          <span className="spinner" />
        </div>
      </div>
    )

  return (
    <>
      <div className="fm-toolbar">
        <div className="crumbs" style={{ cursor: 'default', maxWidth: 360 }}>
          <Search size={14} className="muted" style={{ margin: '0 4px 0 6px' }} />
          <input placeholder="Поиск настройки…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="spacer" />
        {changed.length > 0 && <span className="badge warn">Изменено: {changed.length}</span>}
        <button className="btn" onClick={() => setRaw(true)}>
          <FileCog size={15} /> Как текст
        </button>
        <button className="btn" disabled={!changed.length} onClick={() => setValues(new Map(initial))}>
          <RotateCcw size={15} /> Отменить
        </button>
        <button className="btn" disabled={!changed.length || saving} onClick={() => save(false)}>
          <Save size={15} /> Сохранить
        </button>
        {ad.restart && (
          <button className="btn primary" disabled={!changed.length || saving || !ad.canCommand} onClick={() => save(true)}>
            {saving ? <span className="spinner" /> : <RotateCcw size={15} />} Сохранить и перезапустить
          </button>
        )}
      </div>
      <div className="view">
        <div className="view-narrow">
          {GROUPS.map((g) => {
            const defs = g.defs.filter((d) => values.has(d.key) && match(d.key, d.label))
            if (!defs.length) return null
            return (
              <div key={g.title} style={{ marginBottom: 26 }}>
                <div className="section-title">{g.title}</div>
                <div className="props-grid">
                  {defs.map((d) => (
                    <Prop key={d.key} def={d} value={values.get(d.key) ?? ''} changed={changed.includes(d.key)} onChange={(v) => set(d.key, v)} />
                  ))}
                </div>
              </div>
            )
          })}
          {extra.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div className="section-title">Дополнительно</div>
              <div className="props-grid">
                {extra.map((k) => {
                  const v = values.get(k) ?? ''
                  const def: Def = { key: k, label: k, kind: v === 'true' || v === 'false' ? 'bool' : /^-?\d+$/.test(v) ? 'number' : 'text' }
                  return <Prop key={k} def={def} value={v} changed={changed.includes(k)} onChange={(nv) => set(k, nv)} />
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {raw && (
        <EditorModal
          title="server.properties"
          path="server.properties"
          load={async () => serialize(original, values)}
          save={async (c) => {
            await ad.writeFile('server.properties', c)
            setOriginal(c)
            const m = parse(c)
            setValues(new Map(m))
            setInitial(m)
          }}
          onClose={() => setRaw(false)}
        />
      )}
    </>
  )
}

function Prop(props: { def: Def; value: string; changed: boolean; onChange: (v: string) => void }) {
  const { def, value } = props
  return (
    <div className="prop">
      <div className="lbl">
        <b style={props.changed ? { color: 'var(--warn)' } : undefined}>{def.label}</b>
        <span>{def.key}</span>
      </div>
      <div className="ctl">
        {def.kind === 'bool' ? (
          <Switch checked={value === 'true'} onChange={(v) => props.onChange(String(v))} />
        ) : typeof def.kind === 'object' ? (
          <select className="select" value={value} onChange={(e) => props.onChange(e.target.value)}>
            {!def.kind.options.some(([v]) => v === value) && <option value={value}>{value || '—'}</option>}
            {def.kind.options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`input ${def.kind === 'number' ? 'mono' : ''}`}
            type={def.kind === 'password' ? 'password' : 'text'}
            inputMode={def.kind === 'number' ? 'numeric' : undefined}
            value={value}
            onChange={(e) => props.onChange(def.kind === 'number' ? e.target.value.replace(/[^\d-]/g, '') : e.target.value)}
          />
        )}
      </div>
    </div>
  )
}
