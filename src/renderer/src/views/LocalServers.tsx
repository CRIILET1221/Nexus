import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, Coffee, Copy, Cpu, FileCog, FolderOpen, Info, Network, Play, Plus, Power, RotateCcw,
  Settings2, Skull, SlidersHorizontal, Square, SquareTerminal, Timer, Trash2, Boxes, Eraser, Users, FolderTree, Puzzle
} from 'lucide-react'
import type { CreateServerInput, JavaInfo, LocalServerConfig, ProgressEvent, ServerCore, ServerRuntime, ServerStatus } from '@shared/types'
import { api } from '../api'
import { orNull, type ServerAdapter } from '../adapter'
import { PlayersView } from './Players'
import { FileManager } from './FileManager'
import { AddonsView, type AddonTarget } from './Addons'
import { localBackend } from '../fsBackend'
import { PropertiesForm } from './PropertiesForm'
import { LocalBackups } from './Backups'
import { Modal, Switch, useAction, useToast } from '../components/ui'
import { ConsoleTerminal } from '../components/ConsoleTerminal'
import { EditorModal } from '../components/Editor'
import { formatBytes, formatUptime, uid } from '../util'
import { tr } from '@shared/i18n'

const CORES: { id: ServerCore; name: string; letter: string; desc: string }[] = [
  { id: 'paper', name: 'Paper', letter: 'P', desc: tr('Быстрое ядро с поддержкой плагинов Bukkit/Spigot. Лучший выбор для большинства.') },
  { id: 'purpur', name: 'Purpur', letter: 'Pu', desc: tr('Форк Paper с сотнями дополнительных настроек геймплея.') },
  { id: 'fabric', name: 'Fabric', letter: 'F', desc: tr('Лёгкий загрузчик модов. Моды кладутся в папку mods.') },
  { id: 'forge', name: 'Forge', letter: 'Fo', desc: tr('Классический загрузчик модов — для большинства крупных модпаков. Установка займёт пару минут.') },
  { id: 'vanilla', name: 'Vanilla', letter: 'V', desc: tr('Официальный сервер Mojang без изменений.') }
]
const coreInfo = (c: ServerCore) => CORES.find((x) => x.id === c)!

const STATUS_TEXT: Record<ServerStatus, string> = {
  stopped: tr('Остановлен'),
  starting: tr('Запускается…'),
  running: tr('Работает'),
  stopping: tr('Останавливается…')
}

function StatusDot({ status }: { status: ServerStatus }) {
  return <span className={`dot ${status === 'running' ? 'green' : status === 'stopped' ? '' : 'warn'}`} />
}

export function LocalServers(props: { visible: boolean }) {
  const [servers, setServers] = useState<LocalServerConfig[]>([])
  const [runtimes, setRuntimes] = useState<Record<string, ServerRuntime>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [java, setJava] = useState<JavaInfo | null>(null)
  const run = useAction()

  const reload = useCallback(async () => {
    const list = await api.mc.list()
    setServers(list)
    setSelected((s) => (s && list.some((x) => x.id === s) ? s : list[0]?.id ?? null))
  }, [])

  useEffect(() => {
    reload()
    api.mc.detectJava().then(setJava)
    api.mc.runtimes().then((r) => setRuntimes(Object.fromEntries(r.map((x) => [x.id, x]))))
    return api.on('server:status', (r: ServerRuntime) => setRuntimes((m) => ({ ...m, [r.id]: r })))
  }, [reload])

  const changeJava = async () => {
    const [file] = await api.dialog.open({ title: tr('Выберите java.exe'), filters: [{ name: 'Java', extensions: ['exe'] }] })
    if (file) {
      const info = await run(() => api.mc.setJavaPath(file), tr('Java изменена'))
      if (info) setJava(info)
    }
  }

  const current = servers.find((s) => s.id === selected)

  return (
    <div className="servers-layout">
      <div className="servers-list">
        <h2>{tr('Локальные серверы')}</h2>
        <button className="btn primary" onClick={() => setCreating(true)} style={{ marginBottom: 8 }}>
          <Plus size={16} />{' '}{tr('Создать сервер')}
        </button>
        {servers.map((s) => {
          const st = runtimes[s.id]?.status ?? 'stopped'
          return (
            <button key={s.id} className={`srv-item ${s.id === selected ? 'on' : ''}`} onClick={() => setSelected(s.id)}>
              <div className={`core-icon core-${s.core}`}>{coreInfo(s.core).letter}</div>
              <div className="grow">
                <b>{s.name}</b>
                <span>
                  {coreInfo(s.core).name} {s.version}
                </span>
              </div>
              <StatusDot status={st} />
            </button>
          )
        })}
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <div className="card" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <Coffee size={18} color={java?.version ? 'var(--accent)' : 'var(--danger)'} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{java?.version ? `Java ${java.major}` : java ? tr('Java не найдена') : tr('Поиск Java…')}</div>
              <div className="muted mono" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={java?.path}>
                {java?.version ?? tr('установите JDK 21+')}
              </div>
            </div>
            <button className="btn sm" onClick={changeJava}>
              {tr('Изменить')}
            </button>
          </div>
        </div>
      </div>

      {current ? (
        <ServerDetail
          key={current.id}
          cfg={current}
          runtime={runtimes[current.id]}
          visible={props.visible}
          onChanged={reload}
        />
      ) : (
        <div className="empty-state" style={{ alignSelf: 'center' }}>
          <div className="icon">
            <Boxes size={30} />
          </div>
          <h3>{tr('Свой сервер Minecraft за минуту')}</h3>
          <div style={{ maxWidth: 420 }}>
            {tr('Выберите ядро и версию — Nexus скачает сервер, настроит его и запустит. Играть можно с этого ПК или с друзьями по локальной сети.')}
          </div>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} />{' '}{tr('Создать сервер')}
          </button>
        </div>
      )}

      {creating && (
        <CreateWizard
          java={java}
          onClose={() => setCreating(false)}
          onCreated={async (cfg) => {
            setCreating(false)
            await reload()
            setSelected(cfg.id)
          }}
        />
      )}
    </div>
  )
}

function addonPreset(cfg: LocalServerConfig): AddonTarget {
  const v = cfg.version
  switch (cfg.core) {
    case 'paper':
      return { type: 'plugin', loader: 'paper', gameVersion: v }
    case 'purpur':
      return { type: 'plugin', loader: 'purpur', gameVersion: v }
    case 'fabric':
      return { type: 'mod', loader: 'fabric', gameVersion: v }
    case 'forge':
      return { type: 'mod', loader: 'forge', gameVersion: v }
    default:
      return { type: 'datapack', loader: 'datapack', gameVersion: v }
  }
}

// ---------- Карточка сервера ----------

function ServerDetail(props: { cfg: LocalServerConfig; runtime?: ServerRuntime; visible: boolean; onChanged: () => void }) {
  const { cfg } = props
  const toast = useToast()
  const run = useAction()
  const status: ServerStatus = props.runtime?.status ?? 'stopped'
  const [now, setNow] = useState(Date.now())
  const [lan, setLan] = useState<string[]>([])
  const [editProps, setEditProps] = useState(false)
  const [settings, setSettings] = useState(false)
  const [termGen, setTermGen] = useState(0)
  const [tab, setTab] = useState<'console' | 'files' | 'addons' | 'players' | 'props' | 'backups'>('console')
  const restartPending = useRef(false)

  const fsb = useMemo(() => localBackend(cfg.id), [cfg.id])

  const adapter = useMemo<ServerAdapter>(() => {
    const file = (name: string) => `${cfg.dir}\\${name}`
    return {
      key: cfg.id,
      canCommand: status === 'running',
      commandHint: status === 'stopped' ? tr('Сервер остановлен — запустите его, чтобы управлять игроками.') : tr('Сервер ещё запускается…'),
      command: (c) => api.mc.command(cfg.id, c),
      readFile: async (name) => ((await api.fs.exists(file(name))) ? api.fs.readText(file(name)) : null),
      writeFile: (name, content) => api.fs.writeText(file(name), content),
      readBinary: (name) => orNull(api.fs.readBinary(file(name))),
      listDir: (name) => orNull(api.fs.list(file(name))),
      ping: () => api.mc.ping('127.0.0.1', cfg.port),
      restart: async () => {
        restartPending.current = true
        await api.mc.stop(cfg.id)
      }
    }
  }, [cfg.id, cfg.dir, cfg.port, status])

  useEffect(() => {
    api.mc.lan().then(setLan)
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (status === 'stopped' && restartPending.current) {
      restartPending.current = false
      run(() => api.mc.start(cfg.id))
    }
  }, [status, cfg.id, run])

  const subscribe = useCallback(
    (write: (data: string) => void) => {
      let ready = false
      const queue: string[] = []
      const off = api.on('server:log', (m: { id: string; data: string }) => {
        if (m.id !== cfg.id) return
        if (ready) write(m.data)
        else queue.push(m.data)
      })
      api.mc.log(cfg.id).then((log) => {
        if (log) write(log)
        else write(tr('\x1b[90mКонсоль сервера. Нажмите «Запустить», чтобы стартовать.\x1b[0m\n'))
        queue.forEach((d) => write(d))
        ready = true
      })
      return off
    },
    [cfg.id]
  )

  const remove = async () => {
    const ok = await api.dialog.confirm({
      title: tr('Удаление сервера'),
      message: tr('Убрать сервер «{0}» из списка?', cfg.name),
      detail: tr('Файлы сервера останутся на диске.'),
      ok: tr('Убрать из списка'),
      danger: true
    })
    if (!ok) return
    const del = await api.dialog.confirm({
      title: tr('Файлы сервера'),
      message: tr('Переместить папку сервера в корзину?'),
      detail: tr('{0}\n\nМир, плагины и настройки окажутся в корзине Windows — их можно будет восстановить.', cfg.dir),
      ok: tr('В корзину'),
      danger: true
    })
    if (await run(() => api.mc.remove(cfg.id, del).then(() => true), tr('Сервер удалён'))) props.onChanged()
  }

  const address = `localhost:${cfg.port}`
  const copy = (text: string) => {
    navigator.clipboard.writeText(text)
    toast(tr('Скопировано: {0}', text), 'success')
  }
  const busy = status === 'starting' || status === 'stopping'

  return (
    <div className="srv-detail">
      <div className="srv-head">
        <div className={`core-icon core-${cfg.core}`} style={{ width: 46, height: 46, fontSize: 17 }}>
          {coreInfo(cfg.core).letter}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{cfg.name}</h1>
          <div className="meta">
            <span className="badge">
              {coreInfo(cfg.core).name} {cfg.version}
            </span>
            <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cfg.dir}
            </span>
          </div>
        </div>
        {status === 'stopped' ? (
          <button className="btn primary" onClick={() => run(() => api.mc.start(cfg.id))}>
            <Play size={15} fill="currentColor" />{' '}{tr('Запустить')}
          </button>
        ) : (
          <>
            <button className="btn" disabled={busy} title={tr('Перезапустить')} onClick={() => {
              restartPending.current = true
              run(() => api.mc.stop(cfg.id))
            }}>
              <RotateCcw size={15} />{' '}{tr('Перезапуск')}
            </button>
            <button className="btn danger" disabled={status === 'stopping'} onClick={() => run(() => api.mc.stop(cfg.id))}>
              <Square size={14} fill="currentColor" />{' '}{tr('Остановить')}
            </button>
            {status === 'stopping' && (
              <button className="btn solid-danger" title={tr('Принудительно завершить процесс')} onClick={() => run(() => api.mc.kill(cfg.id))}>
                <Skull size={15} />{' '}{tr('Убить')}
              </button>
            )}
          </>
        )}
        <button className="btn icon" title={tr('Открыть папку')} onClick={() => api.fs.openPath(cfg.dir)}>
          <FolderOpen size={16} />
        </button>
        <button className="btn icon" title="server.properties" onClick={() => setEditProps(true)}>
          <FileCog size={16} />
        </button>
        <button className="btn icon" title={tr('Параметры запуска')} onClick={() => setSettings(true)}>
          <Settings2 size={16} />
        </button>
        <button className="btn icon danger" title={tr('Удалить')} disabled={status !== 'stopped'} onClick={remove}>
          <Trash2 size={16} />
        </button>
      </div>

      <div className="srv-stats">
        <div className="card stat">
          <div className="k">{tr('Статус')}</div>
          <div className="v">
            <StatusDot status={status} /> {STATUS_TEXT[status]}
          </div>
        </div>
        <div className="card stat">
          <div className="k">
            <Network size={11} />{' '}{tr('Адрес')}
          </div>
          <div className="v mono" style={{ fontSize: 13.5 }}>
            {address}
            <button className="btn ghost sm icon" title={tr('Копировать')} onClick={() => copy(address)}>
              <Copy size={13} />
            </button>
          </div>
          {lan[0] && (
            <div className="muted mono" style={{ fontSize: 11.5, marginTop: 2, cursor: 'pointer' }} title={tr('Адрес для друзей в локальной сети')} onClick={() => copy(`${lan[0]}:${cfg.port}`)}>
              LAN: {lan[0]}:{cfg.port}
            </div>
          )}
        </div>
        <div className="card stat">
          <div className="k">
            <Cpu size={11} />{' '}{tr('Память')}
          </div>
          <div className="v">{formatBytes(cfg.memoryMb * 1024 * 1024)}</div>
        </div>
        <div className="card stat">
          <div className="k">
            <Timer size={11} />{' '}{tr('Аптайм')}
          </div>
          <div className="v">{props.runtime?.startedAt && status !== 'stopped' ? formatUptime(now - props.runtime.startedAt) : '—'}</div>
        </div>
      </div>

      <div className="tabs">
        {(
          [
            ['console', tr('Консоль'), <SquareTerminal size={15} key="i" />],
            ['files', tr('Файлы'), <FolderTree size={15} key="i" />],
            ['addons', cfg.core === 'vanilla' ? tr('Датапаки') : cfg.core === 'fabric' || cfg.core === 'forge' ? tr('Моды') : tr('Плагины'), <Puzzle size={15} key="i" />],
            ['players', tr('Игроки'), <Users size={15} key="i" />],
            ['props', tr('Настройки'), <SlidersHorizontal size={15} key="i" />],
            ['backups', tr('Бэкапы'), <Archive size={15} key="i" />]
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {icon} {label}
          </button>
        ))}
        <div className="spacer" />
        {tab === 'console' && (
          <button
            className="btn ghost sm"
            style={{ alignSelf: 'center' }}
            onClick={async () => {
              await api.mc.clearLog(cfg.id)
              setTermGen((g) => g + 1)
            }}
          >
            <Eraser size={13} />{' '}{tr('Очистить')}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            visibility: tab === 'console' ? 'visible' : 'hidden'
          }}
        >
          <ConsoleTerminal
            key={termGen}
            visible={props.visible && tab === 'console'}
            enabled={status !== 'stopped'}
            subscribe={subscribe}
            onCommand={(c) => api.mc.command(cfg.id, c)}
          />
        </div>
        {tab === 'files' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <FileManager fs={fsb} active={props.visible} />
          </div>
        )}
        {tab === 'addons' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <AddonsView fs={fsb} adapter={adapter} visible={props.visible} preset={addonPreset(cfg)} />
          </div>
        )}
        {tab === 'players' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <PlayersView adapter={adapter} visible={props.visible} />
          </div>
        )}
        {tab === 'props' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <PropertiesForm adapter={adapter} visible={props.visible} />
          </div>
        )}
        {tab === 'backups' && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <LocalBackups serverId={cfg.id} running={status !== 'stopped'} visible={props.visible} />
          </div>
        )}
      </div>

      {editProps && (
        <EditorModal
          title="server.properties"
          path={`${cfg.dir}\\server.properties`}
          load={() => api.fs.readText(`${cfg.dir}\\server.properties`)}
          save={(c) => api.fs.writeText(`${cfg.dir}\\server.properties`, c)}
          onClose={() => setEditProps(false)}
        />
      )}
      {settings && (
        <SettingsModal
          cfg={cfg}
          running={status !== 'stopped'}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false)
            props.onChanged()
          }}
        />
      )}
    </div>
  )
}

function SettingsModal(props: { cfg: LocalServerConfig; running: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(props.cfg.name)
  const [memory, setMemory] = useState(props.cfg.memoryMb)
  const [port, setPort] = useState(props.cfg.port)
  const [jvmArgs, setJvmArgs] = useState(props.cfg.jvmArgs)
  const run = useAction()
  return (
    <Modal
      title={tr('Параметры сервера')}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            {tr('Отмена')}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              if (await run(() => api.mc.update(props.cfg.id, { name: name.trim() || props.cfg.name, memoryMb: memory, port, jvmArgs }), tr('Сохранено')))
                props.onSaved()
            }}
          >
            {tr('Сохранить')}
          </button>
        </>
      }
    >
      <div className="modal-body stack">
        {props.running && (
          <div className="callout warn">
            <Info size={16} />
            {tr('Изменения применятся после перезапуска сервера.')}
          </div>
        )}
        <div className="field">
          <label>{tr('Название')}</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <RamField value={memory} onChange={setMemory} />
        <div className="field">
          <label>{tr('Порт')}</label>
          <input className="input mono" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          <span className="hint">{tr('Также обновится в server.properties')}</span>
        </div>
        <div className="field">
          <label>{tr('Дополнительные аргументы JVM')}</label>
          <input className="input mono" placeholder="-XX:+UseG1GC" value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

function RamField(props: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="field">
      <label style={{ display: 'flex', justifyContent: 'space-between' }}>
        {tr('Оперативная память')}{' '}<span className="ram-value">{(props.value / 1024).toFixed(1)}{' '}{tr('ГБ')}</span>
      </label>
      <input type="range" min={1024} max={16384} step={512} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      <span className="hint">{tr('Рекомендуется 2–4 ГБ для ванили и плагинов, 6+ ГБ для больших модпаков')}</span>
    </div>
  )
}

// ---------- Мастер создания ----------

function CreateWizard(props: { java: JavaInfo | null; onClose: () => void; onCreated: (cfg: LocalServerConfig) => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [core, setCore] = useState<ServerCore>('paper')
  const [versions, setVersions] = useState<string[] | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [baseDir, setBaseDir] = useState('')
  const [dirTouched, setDirTouched] = useState(false)
  const [required, setRequired] = useState<number | null>(null)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<CreateServerInput>({
    name: tr('Мой сервер'),
    core: 'paper',
    version: '',
    dir: '',
    memoryMb: 4096,
    port: 25565,
    maxPlayers: 20,
    onlineMode: true,
    motd: 'A Minecraft Server',
    gamemode: 'survival',
    difficulty: 'normal',
    acceptEula: false
  })
  const set = <K extends keyof CreateServerInput>(k: K, v: CreateServerInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    api.mc.defaultDir().then(setBaseDir)
  }, [])

  // Папка по умолчанию — от названия
  useEffect(() => {
    if (!dirTouched && baseDir) {
      const safe = form.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'server'
      set('dir', `${baseDir}\\${safe}`)
    }
  }, [form.name, baseDir, dirTouched])

  const loadVersions = useCallback((c: ServerCore) => {
    setVersions(null)
    setVersionsError(null)
    api.mc.versions(c).then(
      (list) => {
        setVersions(list)
        setForm((f) => ({ ...f, version: list[0] ?? '' }))
      },
      (e: Error) => setVersionsError(e.message)
    )
  }, [])

  useEffect(() => {
    if (form.version) api.mc.requiredJava(form.version).then(setRequired)
  }, [form.version])

  const next = () => {
    set('core', core)
    loadVersions(core)
    setStep(2)
  }

  const create = async () => {
    setStep(3)
    setError(null)
    const pid = uid()
    const off = api.on('server:createProgress', (p: ProgressEvent) => p.id === pid && setProgress(p))
    try {
      const cfg = await api.mc.create({ ...form, core }, pid)
      props.onCreated(cfg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      off()
    }
  }

  const pickDir = async () => {
    const [dir] = await api.dialog.open({ directories: true, title: tr('Папка сервера') })
    if (dir) {
      setDirTouched(true)
      set('dir', dir)
    }
  }

  const java = props.java
  const javaWarn = useMemo(() => {
    if (!required) return null
    if (!java?.major) return { level: 'danger', text: tr('Java не найдена. Для этой версии нужна Java {0}+.', required) }
    if (java.major < required) return { level: 'danger', text: tr('Установлена Java {0}, а для Minecraft {1} нужна Java {2} или новее.', java.major, form.version, required) }
    if (required <= 8 && java.major > 11) return { level: 'warn', text: tr('Старые версии Minecraft могут не запуститься на Java {0}. Рекомендуется Java 8.', java.major) }
    if (core === 'forge' && required < 21 && java.major > required + 4)
      return { level: 'warn', text: tr('Forge для {0} может не установиться или не запуститься на Java {1}. Надёжнее Java {2}.', form.version, java.major, required) }
    return null
  }, [required, java, form.version, core])

  const valid = form.name.trim() && form.version && form.dir && form.port > 0 && form.port < 65536 && form.acceptEula

  const pct = progress?.total ? (progress.transferred / progress.total) * 100 : 0

  return (
    <Modal
      title={tr('Новый сервер')}
      size="wide"
      closeOnBackdrop={false}
      onClose={() => step !== 3 || error ? props.onClose() : undefined}
      footer={
        step === 1 ? (
          <>
            <button className="btn" onClick={props.onClose}>
              {tr('Отмена')}
            </button>
            <button className="btn primary" onClick={next}>
              {tr('Далее')}
            </button>
          </>
        ) : step === 2 ? (
          <>
            <button className="btn" onClick={() => setStep(1)}>
              {tr('Назад')}
            </button>
            <button className="btn primary" disabled={!valid} onClick={create}>
              <Power size={15} />{' '}{tr('Создать сервер')}
            </button>
          </>
        ) : error ? (
          <>
            <button className="btn" onClick={props.onClose}>
              {tr('Закрыть')}
            </button>
            <button className="btn primary" onClick={() => setStep(2)}>
              {tr('Назад к настройкам')}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="modal-body stack">
        <div className="steps">
          <div className={`s ${step >= 1 ? 'on' : ''}`}>
            <i>1</i>{' '}{tr('Ядро')}
          </div>
          <div className="line" />
          <div className={`s ${step >= 2 ? 'on' : ''}`}>
            <i>2</i>{' '}{tr('Настройки')}
          </div>
          <div className="line" />
          <div className={`s ${step >= 3 ? 'on' : ''}`}>
            <i>3</i>{' '}{tr('Установка')}
          </div>
        </div>

        {step === 1 && (
          <div className="cores">
            {CORES.map((c) => (
              <button key={c.id} className={`core-card ${core === c.id ? 'on' : ''}`} onClick={() => setCore(c.id)} onDoubleClick={next}>
                <div className={`core-icon core-${c.id}`}>{c.letter}</div>
                <div>
                  <b>{c.name}</b>
                  <span>{c.desc}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <>
            <div className="grid-2">
              <div className="field">
                <label>{tr('Название')}</label>
                <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label>{tr('Версия')}{' '}{coreInfo(core).name}</label>
                {versionsError ? (
                  <div className="row">
                    <span style={{ color: 'var(--danger)', fontSize: 12.5, flex: 1 }}>{versionsError}</span>
                    <button className="btn sm" onClick={() => loadVersions(core)}>
                      {tr('Повторить')}
                    </button>
                  </div>
                ) : versions === null ? (
                  <div className="row muted" style={{ height: 36 }}>
                    <span className="spinner" />{' '}{tr('Загрузка списка версий…')}
                  </div>
                ) : (
                  <select className="select" value={form.version} onChange={(e) => set('version', e.target.value)}>
                    {versions.map((v, i) => (
                      <option key={v} value={v}>
                        {v}
                        {i === 0 ? tr(' (последняя)') : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="field">
              <label>{tr('Папка сервера')}</label>
              <div className="row">
                <input
                  className="input mono"
                  value={form.dir}
                  onChange={(e) => {
                    setDirTouched(true)
                    set('dir', e.target.value)
                  }}
                />
                <button className="btn" onClick={pickDir}>
                  <FolderOpen size={15} />{' '}{tr('Обзор')}
                </button>
              </div>
            </div>

            <RamField value={form.memoryMb} onChange={(v) => set('memoryMb', v)} />

            <div className="grid-3">
              <div className="field">
                <label>{tr('Описание (MOTD)')}</label>
                <input className="input" value={form.motd} onChange={(e) => set('motd', e.target.value)} />
              </div>
              <div className="field">
                <label>{tr('Порт')}</label>
                <input className="input mono" type="number" value={form.port} onChange={(e) => set('port', Number(e.target.value))} />
              </div>
              <div className="field">
                <label>{tr('Макс. игроков')}</label>
                <input className="input" type="number" min={1} value={form.maxPlayers} onChange={(e) => set('maxPlayers', Number(e.target.value))} />
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>{tr('Режим игры')}</label>
                <select className="select" value={form.gamemode} onChange={(e) => set('gamemode', e.target.value as CreateServerInput['gamemode'])}>
                  <option value="survival">{tr('Выживание')}</option>
                  <option value="creative">{tr('Творческий')}</option>
                  <option value="adventure">{tr('Приключение')}</option>
                  <option value="spectator">{tr('Наблюдатель')}</option>
                </select>
              </div>
              <div className="field">
                <label>{tr('Сложность')}</label>
                <select className="select" value={form.difficulty} onChange={(e) => set('difficulty', e.target.value as CreateServerInput['difficulty'])}>
                  <option value="peaceful">{tr('Мирная')}</option>
                  <option value="easy">{tr('Лёгкая')}</option>
                  <option value="normal">{tr('Нормальная')}</option>
                  <option value="hard">{tr('Сложная')}</option>
                </select>
              </div>
            </div>

            <div className="row card" style={{ padding: '12px 14px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{tr('Лицензионный режим (online-mode)')}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {tr('Проверять аккаунты через серверы Mojang. Выключите, если игроки заходят с пиратских лаунчеров.')}
                </div>
              </div>
              <Switch checked={form.onlineMode} onChange={(v) => set('onlineMode', v)} />
            </div>

            {javaWarn && (
              <div className={`callout ${javaWarn.level === 'danger' ? 'danger' : 'warn'}`}>
                <AlertTriangle size={16} />
                <span>
                  {javaWarn.text}{' '}{tr('Скачать можно на')}{' '}
                  <a className="link" onClick={() => api.fs.openExternal('https://adoptium.net/')}>
                    adoptium.net
                  </a>
                  {tr(', затем укажите путь к java.exe внизу списка серверов.')}
                </span>
              </div>
            )}

            <label className="check">
              <input type="checkbox" checked={form.acceptEula} onChange={(e) => set('acceptEula', e.target.checked)} />
              <span>
                {tr('Я принимаю')}{' '}
                <a className="link" onClick={(e) => { e.preventDefault(); api.fs.openExternal('https://aka.ms/MinecraftEULA') }}>
                  {tr('лицензионное соглашение Minecraft (EULA)')}
                </a>
                <div className="muted" style={{ fontSize: 12 }}>
                  {tr('Без этого сервер не запустится — Mojang требует согласия владельца сервера.')}
                </div>
              </span>
            </label>
          </>
        )}

        {step === 3 && (
          <div className="stack" style={{ padding: '20px 0' }}>
            {error ? (
              <div className="callout danger">
                <AlertTriangle size={16} />
                <span>
                  <b>{tr('Не удалось создать сервер.')}</b> {error}
                </span>
              </div>
            ) : (
              <>
                <div className="row">
                  <span className="spinner" />
                  <b>{progress?.stage ?? tr('Подготовка…')}</b>
                  <div className="spacer" />
                  {progress?.total ? (
                    <span className="muted">
                      {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
                    </span>
                  ) : null}
                </div>
                <div className={`progress ${progress?.total ? '' : 'indeterminate'}`}>
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {coreInfo(core).name} {form.version} → {form.dir}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
