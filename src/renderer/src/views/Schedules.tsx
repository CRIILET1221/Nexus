import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { errText } from '../adapter'
import { Modal, Switch, useAction } from '../components/ui'
import { formatDate } from '../util'
import { tr } from '@shared/i18n'

interface Task {
  id?: number
  action: 'command' | 'power' | 'backup'
  payload: string
  offset: number
  continueOnFailure: boolean
}
interface Schedule {
  id?: number
  name: string
  cron: { minute: string; hour: string; day_of_month: string; month: string; day_of_week: string }
  active: boolean
  onlyWhenOnline: boolean
  processing?: boolean
  lastRun?: number | null
  nextRun?: number | null
  tasks: Task[]
}

const PRESETS: { name: string; s: Omit<Schedule, 'id'> }[] = [
  {
    name: tr('Рестарт каждый день в 05:00'),
    s: {
      name: tr('Ежедневный рестарт'),
      cron: { minute: '0', hour: '5', day_of_month: '*', month: '*', day_of_week: '*' },
      active: true,
      onlyWhenOnline: true,
      tasks: [
        { action: 'command', payload: tr('say Рестарт сервера через 1 минуту!'), offset: 0, continueOnFailure: true },
        { action: 'command', payload: 'save-all', offset: 50, continueOnFailure: true },
        { action: 'power', payload: 'restart', offset: 10, continueOnFailure: false }
      ]
    }
  },
  {
    name: tr('Бэкап каждые 6 часов'),
    s: {
      name: tr('Автобэкап'),
      cron: { minute: '0', hour: '*/6', day_of_month: '*', month: '*', day_of_week: '*' },
      active: true,
      onlyWhenOnline: false,
      tasks: [{ action: 'backup', payload: '', offset: 0, continueOnFailure: false }]
    }
  },
  {
    name: tr('Сохранение мира каждые 30 минут'),
    s: {
      name: tr('Автосохранение'),
      cron: { minute: '*/30', hour: '*', day_of_month: '*', month: '*', day_of_week: '*' },
      active: true,
      onlyWhenOnline: true,
      tasks: [{ action: 'command', payload: 'save-all', offset: 0, continueOnFailure: false }]
    }
  },
  {
    name: tr('Объявление каждый час'),
    s: {
      name: tr('Объявление'),
      cron: { minute: '0', hour: '*', day_of_month: '*', month: '*', day_of_week: '*' },
      active: true,
      onlyWhenOnline: true,
      tasks: [{ action: 'command', payload: tr('say Не забудьте вступить в наш Discord!'), offset: 0, continueOnFailure: false }]
    }
  }
]

const DAYS = [tr('вс'), tr('пн'), tr('вт'), tr('ср'), tr('чт'), tr('пт'), tr('сб')]

export function describeCron(c: Schedule['cron']): string {
  const { minute: m, hour: h, day_of_month: dom, month: mon, day_of_week: dow } = c
  const pad = (x: string) => x.padStart(2, '0')
  const simple = (x: string) => /^\d+$/.test(x)
  if (dom === '*' && mon === '*' && dow === '*') {
    if (simple(m) && simple(h)) return tr('Каждый день в {0}:{1}', pad(h), pad(m))
    if (simple(m) && /^\*\/\d+$/.test(h)) return tr('Каждые {0} ч (в :{1})', h.slice(2), pad(m))
    if (simple(m) && h === '*') return tr('Каждый час в :{0}', pad(m))
    if (/^\*\/\d+$/.test(m) && h === '*') return tr('Каждые {0} мин', m.slice(2))
    if (m === '*' && h === '*') return tr('Каждую минуту')
  }
  if (dom === '*' && mon === '*' && /^\d$/.test(dow) && simple(m) && simple(h)) return tr('Каждое {0} в {1}:{2}', DAYS[+dow] ?? dow, pad(h), pad(m))
  return `${m} ${h} ${dom} ${mon} ${dow}`
}

const ACTIONS: Record<Task['action'], string> = { command: tr('Команда'), power: tr('Питание'), backup: tr('Бэкап') }
const POWER: Record<string, string> = { start: tr('Запустить'), stop: tr('Остановить'), restart: tr('Перезапустить'), kill: tr('Убить') }

function fromApi(s: any): Schedule {
  const a = s.attributes
  return {
    id: a.id,
    name: a.name,
    cron: a.cron,
    active: a.is_active,
    onlyWhenOnline: a.only_when_online,
    processing: a.is_processing,
    lastRun: a.last_run_at ? Date.parse(a.last_run_at) : null,
    nextRun: a.next_run_at ? Date.parse(a.next_run_at) : null,
    tasks: (a.relationships?.tasks?.data ?? [])
      .map((t: any) => t.attributes)
      .sort((x: any, y: any) => x.sequence_id - y.sequence_id)
      .map((t: any) => ({ id: t.id, action: t.action, payload: t.payload, offset: t.time_offset, continueOnFailure: t.continue_on_failure }))
  }
}

const scheduleBody = (s: Schedule) => ({
  name: s.name,
  minute: s.cron.minute,
  hour: s.cron.hour,
  day_of_month: s.cron.day_of_month,
  month: s.cron.month,
  day_of_week: s.cron.day_of_week,
  is_active: s.active,
  only_when_online: s.onlyWhenOnline
})
const taskBody = (t: Task) => ({ action: t.action, payload: t.payload, time_offset: t.offset, continue_on_failure: t.continueOnFailure })

export function SchedulesView(props: { profileId: string; visible: boolean }) {
  const run = useAction()
  const pid = props.profileId
  const [list, setList] = useState<Schedule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Schedule | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.panel.request<any>(pid, 'GET', '/schedules?include=tasks')
      setList(res.data.map(fromApi))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [pid])

  useEffect(() => {
    if (props.visible) load()
  }, [props.visible, load])

  const toggle = async (s: Schedule) => {
    await run(() => api.panel.request(pid, 'POST', `/schedules/${s.id}`, scheduleBody({ ...s, active: !s.active })))
    load()
  }
  const execute = async (s: Schedule) => {
    await run(() => api.panel.request(pid, 'POST', `/schedules/${s.id}/execute`), tr('Расписание запущено'))
    setTimeout(load, 1500)
  }
  const remove = async (s: Schedule) => {
    if (!(await api.dialog.confirm({ title: tr('Удаление'), message: tr('Удалить расписание «{0}»?', s.name), ok: tr('Удалить'), danger: true }))) return
    await run(() => api.panel.request(pid, 'DELETE', `/schedules/${s.id}`), tr('Удалено'))
    load()
  }

  return (
    <div className="view">
      <div className="view-narrow">
        <div className="section-title">
          <CalendarClock size={16} />{' '}{tr('Расписания')}
          <div className="spacer" />
          <button className="btn sm ghost" onClick={load}>
            <RefreshCw size={13} />{' '}{tr('Обновить')}
          </button>
          <button
            className="btn primary sm"
            onClick={() =>
              setEditing({ name: '', cron: { minute: '0', hour: '5', day_of_month: '*', month: '*', day_of_week: '*' }, active: true, onlyWhenOnline: false, tasks: [] })
            }
          >
            <Plus size={14} />{' '}{tr('Новое расписание')}
          </button>
        </div>

        <div className="chip-row" style={{ marginBottom: 16 }}>
          <span className="muted" style={{ alignSelf: 'center', fontSize: 12.5 }}>
            {tr('Быстро:')}
          </span>
          {PRESETS.map((p) => (
            <button key={p.name} className="btn sm" onClick={() => setEditing(structuredClone(p.s))}>
              <Plus size={12} /> {p.name}
            </button>
          ))}
        </div>

        <div className="rows">
          {error ? (
            <div className="empty-row">{error}</div>
          ) : !list ? (
            <div className="empty-row">{tr('Загрузка…')}</div>
          ) : list.length === 0 ? (
            <div className="empty-row">{tr('Расписаний нет — создайте, например, ежедневный рестарт.')}</div>
          ) : (
            list.map((s) => (
              <div className="r" key={s.id}>
                <Switch checked={s.active} onChange={() => toggle(s)} />
                <div className="main">
                  <b>
                    {s.name} {s.processing && <span className="badge warn">{tr('выполняется')}</span>}
                  </b>
                  <span>
                    {describeCron(s.cron)} · {s.tasks.length ? s.tasks.map((t) => (t.action === 'power' ? POWER[t.payload] ?? t.payload : ACTIONS[t.action])).join(' → ') : tr('нет задач')}
                    {s.active && s.nextRun ? tr(' · следующий запуск {0}', formatDate(s.nextRun)) : ''}
                  </span>
                </div>
                <div className="acts">
                  <button className="btn sm" onClick={() => execute(s)} disabled={!s.tasks.length}>
                    <Play size={13} />{' '}{tr('Запустить сейчас')}
                  </button>
                  <button className="btn sm icon" title={tr('Изменить')} onClick={() => setEditing(structuredClone(s))}>
                    <Pencil size={14} />
                  </button>
                  <button className="btn sm icon danger" title={tr('Удалить')} onClick={() => remove(s)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {editing && (
        <ScheduleModal
          profileId={pid}
          schedule={editing}
          original={list?.find((x) => x.id === editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function ScheduleModal(props: { profileId: string; schedule: Schedule; original?: Schedule; onClose: () => void; onSaved: () => void }) {
  const run = useAction()
  const [s, setS] = useState<Schedule>(props.schedule)
  const [busy, setBusy] = useState(false)
  const setCron = (k: keyof Schedule['cron'], v: string) => setS((x) => ({ ...x, cron: { ...x.cron, [k]: v.trim() } }))
  const setTask = (i: number, patch: Partial<Task>) => setS((x) => ({ ...x, tasks: x.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) }))

  const save = async () => {
    setBusy(true)
    const pid = props.profileId
    const ok = await run(async () => {
      let id = s.id
      if (id) await api.panel.request(pid, 'POST', `/schedules/${id}`, scheduleBody(s))
      else id = (await api.panel.request<any>(pid, 'POST', '/schedules', scheduleBody(s))).attributes.id
      // задачи: удаляем убранные, обновляем изменённые, создаём новые
      const before = props.original?.tasks ?? []
      for (const t of before) if (!s.tasks.some((x) => x.id === t.id)) await api.panel.request(pid, 'DELETE', `/schedules/${id}/tasks/${t.id}`)
      for (const t of s.tasks) {
        if (t.id) await api.panel.request(pid, 'POST', `/schedules/${id}/tasks/${t.id}`, taskBody(t))
        else await api.panel.request(pid, 'POST', `/schedules/${id}/tasks`, taskBody(t))
      }
      return true
    }, tr('Расписание сохранено'))
    setBusy(false)
    if (ok) props.onSaved()
  }

  return (
    <Modal
      size="wide"
      title={s.id ? tr('Изменить расписание') : tr('Новое расписание')}
      onClose={props.onClose}
      closeOnBackdrop={false}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {tr('Отмена')}
          </button>
          <button className="btn primary" disabled={busy || !s.name.trim()} onClick={save}>
            {busy && <span className="spinner" />}{' '}{tr('Сохранить')}
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        <div className="field">
          <label>{tr('Название')}</label>
          <input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} autoFocus />
        </div>
        <div className="field">
          <label>
            {tr('Когда запускать (cron, время сервера) —')}{' '}<span style={{ color: 'var(--accent)' }}>{describeCron(s.cron)}</span>
          </label>
          <div className="cron">
            {(
              [
                ['minute', tr('Минута')],
                ['hour', tr('Час')],
                ['day_of_month', tr('День месяца')],
                ['month', tr('Месяц')],
                ['day_of_week', tr('День недели (0=вс)')]
              ] as const
            ).map(([k, l]) => (
              <div className="field" key={k}>
                <label>{l}</label>
                <input className="input mono" value={s.cron[k]} onChange={(e) => setCron(k, e.target.value)} />
              </div>
            ))}
          </div>
          <span className="hint">{tr('* — каждый, */15 — каждые 15, 1-5 — диапазон, 1,3,5 — список')}</span>
        </div>
        <div className="row">
          <label className="check" style={{ flex: 1 }}>
            <input type="checkbox" checked={s.active} onChange={(e) => setS({ ...s, active: e.target.checked })} />
            {tr('Включено')}
          </label>
          <label className="check" style={{ flex: 2 }}>
            <input type="checkbox" checked={s.onlyWhenOnline} onChange={(e) => setS({ ...s, onlyWhenOnline: e.target.checked })} />
            {tr('Только когда сервер запущен')}
          </label>
        </div>

        <div className="field">
          <label>{tr('Задачи (выполняются по очереди; задержка — секунды после предыдущей, до 900)')}</label>
          <div className="stack" style={{ gap: 8 }}>
            {s.tasks.map((t, i) => (
              <div className="task" key={i}>
                <span className="n">{i + 1}</span>
                <select className="select" value={t.action} onChange={(e) => setTask(i, { action: e.target.value as Task['action'], payload: e.target.value === 'power' ? 'restart' : '' })}>
                  <option value="command">{tr('Команда')}</option>
                  <option value="power">{tr('Питание')}</option>
                  <option value="backup">{tr('Бэкап')}</option>
                </select>
                {t.action === 'power' ? (
                  <select className="select" value={t.payload} onChange={(e) => setTask(i, { payload: e.target.value })}>
                    {Object.entries(POWER).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input mono"
                    placeholder={t.action === 'command' ? tr('say Привет!') : tr('Исключить файлы (необязательно)')}
                    value={t.payload}
                    onChange={(e) => setTask(i, { payload: e.target.value })}
                  />
                )}
                <input
                  className="input mono"
                  type="number"
                  min={0}
                  max={900}
                  title={tr('Задержка, сек')}
                  value={t.offset}
                  onChange={(e) => setTask(i, { offset: Math.max(0, Math.min(900, Number(e.target.value))) })}
                />
                <button className="btn sm icon ghost" onClick={() => setS({ ...s, tasks: s.tasks.filter((_, j) => j !== i) })}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              className="btn sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setS({ ...s, tasks: [...s.tasks, { action: 'command', payload: '', offset: s.tasks.length ? 5 : 0, continueOnFailure: false }] })}
            >
              <Plus size={13} />{' '}{tr('Добавить задачу')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
