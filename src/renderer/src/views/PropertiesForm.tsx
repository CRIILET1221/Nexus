import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileCog, RotateCcw, Save, Search } from 'lucide-react'
import type { ServerAdapter } from '../adapter'
import { errText } from '../adapter'
import { Switch, useAction } from '../components/ui'
import { EditorModal } from '../components/Editor'
import { tr } from '@shared/i18n'

type Kind = 'bool' | 'number' | 'text' | 'password' | { options: [string, string][] }
interface Def {
  key: string
  label: string
  kind: Kind
}

const GROUPS: { title: string; defs: Def[] }[] = [
  {
    title: tr('Основное'),
    defs: [
      { key: 'motd', label: tr('Описание сервера (MOTD)'), kind: 'text' },
      { key: 'max-players', label: tr('Максимум игроков'), kind: 'number' },
      { key: 'gamemode', label: tr('Режим игры'), kind: { options: [['survival', tr('Выживание')], ['creative', tr('Творческий')], ['adventure', tr('Приключение')], ['spectator', tr('Наблюдатель')]] } },
      { key: 'force-gamemode', label: tr('Принудительный режим при входе'), kind: 'bool' },
      { key: 'difficulty', label: tr('Сложность'), kind: { options: [['peaceful', tr('Мирная')], ['easy', tr('Лёгкая')], ['normal', tr('Нормальная')], ['hard', tr('Сложная')]] } },
      { key: 'hardcore', label: tr('Хардкор'), kind: 'bool' },
      { key: 'pvp', label: 'PvP', kind: 'bool' },
      { key: 'online-mode', label: tr('Лицензионный режим'), kind: 'bool' },
      { key: 'white-list', label: tr('Белый список'), kind: 'bool' },
      { key: 'enforce-whitelist', label: tr('Кикать не из белого списка'), kind: 'bool' },
      { key: 'allow-flight', label: tr('Разрешить полёт (без кика)'), kind: 'bool' },
      { key: 'spawn-protection', label: tr('Защита спавна (блоков)'), kind: 'number' },
      { key: 'player-idle-timeout', label: tr('Кик за AFK (минут, 0 — нет)'), kind: 'number' }
    ]
  },
  {
    title: tr('Мир'),
    defs: [
      { key: 'level-name', label: tr('Папка мира'), kind: 'text' },
      { key: 'level-seed', label: tr('Сид'), kind: 'text' },
      {
        key: 'level-type',
        label: tr('Тип мира'),
        kind: { options: [['minecraft:normal', tr('Обычный')], ['minecraft:flat', tr('Плоский')], ['minecraft:large_biomes', tr('Большие биомы')], ['minecraft:amplified', tr('Расширенный')]] }
      },
      { key: 'generate-structures', label: tr('Генерировать постройки'), kind: 'bool' },
      { key: 'allow-nether', label: tr('Разрешить Незер'), kind: 'bool' },
      { key: 'spawn-monsters', label: tr('Монстры'), kind: 'bool' },
      { key: 'spawn-animals', label: tr('Животные'), kind: 'bool' },
      { key: 'spawn-npcs', label: tr('Жители'), kind: 'bool' },
      { key: 'view-distance', label: tr('Дальность прорисовки'), kind: 'number' },
      { key: 'simulation-distance', label: tr('Дальность симуляции'), kind: 'number' },
      { key: 'max-world-size', label: tr('Радиус мира'), kind: 'number' }
    ]
  },
  {
    title: tr('Сеть и доступ'),
    defs: [
      { key: 'server-port', label: tr('Порт'), kind: 'number' },
      { key: 'server-ip', label: tr('IP (обычно пусто)'), kind: 'text' },
      { key: 'enable-status', label: tr('Показывать в списке серверов'), kind: 'bool' },
      { key: 'hide-online-players', label: tr('Скрывать список игроков'), kind: 'bool' },
      { key: 'enforce-secure-profile', label: tr('Требовать подпись чата'), kind: 'bool' },
      { key: 'prevent-proxy-connections', label: tr('Блокировать VPN/прокси'), kind: 'bool' },
      { key: 'enable-rcon', label: 'RCON', kind: 'bool' },
      { key: 'rcon.port', label: tr('Порт RCON'), kind: 'number' },
      { key: 'rcon.password', label: tr('Пароль RCON'), kind: 'password' },
      { key: 'enable-query', label: 'Query (GameSpy)', kind: 'bool' },
      { key: 'query.port', label: tr('Порт Query'), kind: 'number' },
      { key: 'network-compression-threshold', label: tr('Порог сжатия'), kind: 'number' }
    ]
  },
  {
    title: tr('Прочее'),
    defs: [
      { key: 'enable-command-block', label: tr('Командные блоки'), kind: 'bool' },
      { key: 'op-permission-level', label: tr('Уровень прав OP'), kind: { options: [['1', tr('1 — обход защиты спавна')], ['2', tr('2 — команды читов')], ['3', tr('3 — модерация')], ['4', tr('4 — все команды')]] } },
      { key: 'function-permission-level', label: tr('Уровень прав функций'), kind: 'number' },
      { key: 'resource-pack', label: tr('Ресурс-пак (URL)'), kind: 'text' },
      { key: 'require-resource-pack', label: tr('Обязательный ресурс-пак'), kind: 'bool' },
      { key: 'sync-chunk-writes', label: tr('Синхронная запись чанков'), kind: 'bool' },
      { key: 'max-tick-time', label: tr('Watchdog (мс, -1 — выкл.)'), kind: 'number' },
      { key: 'entity-broadcast-range-percentage', label: tr('Дальность сущностей, %'), kind: 'number' }
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
        setError(tr('Файл server.properties ещё не создан — он появится после первого запуска сервера.'))
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
    }, restart ? tr('Сохранено, сервер перезапускается') : tr('Сохранено — применится после перезапуска'))
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
            {tr('Повторить')}
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
          <input placeholder={tr('Поиск настройки…')} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="spacer" />
        {changed.length > 0 && <span className="badge warn">{tr('Изменено:')}{' '}{changed.length}</span>}
        <button className="btn" onClick={() => setRaw(true)}>
          <FileCog size={15} />{' '}{tr('Как текст')}
        </button>
        <button className="btn" disabled={!changed.length} onClick={() => setValues(new Map(initial))}>
          <RotateCcw size={15} />{' '}{tr('Отменить')}
        </button>
        <button className="btn" disabled={!changed.length || saving} onClick={() => save(false)}>
          <Save size={15} />{' '}{tr('Сохранить')}
        </button>
        {ad.restart && (
          <button className="btn primary" disabled={!changed.length || saving || !ad.canCommand} onClick={() => save(true)}>
            {saving ? <span className="spinner" /> : <RotateCcw size={15} />}{' '}{tr('Сохранить и перезапустить')}
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
              <div className="section-title">{tr('Дополнительно')}</div>
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
