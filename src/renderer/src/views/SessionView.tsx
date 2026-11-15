import { useMemo, useState } from 'react'
import { Puzzle, Archive, CalendarClock, FolderTree, LayoutDashboard, LogOut, MonitorPlay, SlidersHorizontal, SquareTerminal, Users } from 'lucide-react'
import type { ConnectionProfile, SessionInfo } from '@shared/types'
import { api } from '../api'
import { gameAddress, fetchPanelServer, orNull, type ServerAdapter } from '../adapter'
import { FileManager } from './FileManager'
import { ShellConsole } from './ShellConsole'
import { PanelConsole, PanelSetup } from './PanelConsole'
import { PlayersView } from './Players'
import { AddonsView } from './Addons'
import { PropertiesForm } from './PropertiesForm'
import { PanelBackups } from './Backups'
import { SchedulesView } from './Schedules'
import { PanelManage } from './PanelManage'
import { joinRemote } from '../util'
import { sftpBackend } from '../fsBackend'
import { ServerBar } from './ServerBar'
import { tr, NOT_FOUND_RE } from '@shared/i18n'

type Tab = 'files' | 'server' | 'addons' | 'players' | 'props' | 'backups' | 'schedules' | 'panel' | 'ssh'

const TABS: { id: Tab; label: string; icon: React.ReactNode; title?: string }[] = [
  { id: 'files', label: tr('Файлы'), icon: <FolderTree size={15} /> },
  { id: 'server', label: tr('Консоль'), icon: <MonitorPlay size={15} />, title: tr('Консоль Minecraft через панель хостинга') },
  { id: 'addons', label: tr('Плагины и моды'), icon: <Puzzle size={15} />, title: tr('Установка и обновление из каталога Modrinth') },
  { id: 'players', label: tr('Игроки'), icon: <Users size={15} /> },
  { id: 'props', label: tr('Настройки'), icon: <SlidersHorizontal size={15} />, title: 'server.properties' },
  { id: 'backups', label: tr('Бэкапы'), icon: <Archive size={15} /> },
  { id: 'schedules', label: tr('Расписания'), icon: <CalendarClock size={15} /> },
  { id: 'panel', label: tr('Панель'), icon: <LayoutDashboard size={15} />, title: tr('Запуск, сеть, базы данных, пользователи, журнал') },
  { id: 'ssh', label: 'SSH', icon: <SquareTerminal size={15} />, title: tr('SSH-терминал (для VPS)') }
]

export function SessionView(props: {
  session: SessionInfo
  profile?: ConnectionProfile
  active: boolean
  onDisconnect: () => void
  onProfileChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>('files')
  const [opened, setOpened] = useState<Set<Tab>>(new Set(['files']))
  const s = props.session
  const p = props.profile
  const panelReady = !!(p?.panelUrl && p.panelServerId && p.hasPanelKey)
  const panelPid = panelReady ? p!.id : null

  const fsb = useMemo(() => sftpBackend(s.id, s.homePath, panelPid), [s.id, s.homePath, panelPid])

  const go = (t: Tab) => {
    setOpened((o) => new Set(o).add(t))
    setTab(t)
  }

  // Адаптер «Игроки/Настройки»: файлы — по SFTP, команды — через API панели
  const adapter = useMemo<ServerAdapter>(() => {
    const root = s.homePath
    const sftpHost = s.host.split(':')[0]
    return {
      key: s.id,
      canCommand: panelReady,
      commandHint: tr('Чтобы управлять игроками, подключите API панели во вкладке «Консоль». Списки ниже доступны только для просмотра.'),
      command: (cmd) => api.panel.request(p!.id, 'POST', '/command', { command: cmd }).then(() => undefined),
      readFile: async (name) => {
        try {
          return await api.sftp.readText(s.id, joinRemote(root, name))
        } catch (e) {
          if (NOT_FOUND_RE.test(String(e))) return null
          throw e
        }
      },
      writeFile: (name, content) => api.sftp.writeText(s.id, joinRemote(root, name), content),
      readBinary: (name) => orNull(api.sftp.readBinary(s.id, joinRemote(root, name))),
      listDir: async (name) => {
        const list = await orNull(api.sftp.list(s.id, joinRemote(root, name)))
        return list ? list.map((e) => ({ name: e.name, isDir: e.isDir, size: e.size, mtime: e.mtime })) : null
      },
      ping: async () => {
        const info = panelReady ? await fetchPanelServer(p!.id).catch(() => null) : null
        const addr = gameAddress(info, sftpHost)
        return api.mc.ping(addr.host, addr.port)
      },
      restart: panelReady ? () => api.panel.request(p!.id, 'POST', '/power', { signal: 'restart' }).then(() => undefined) : undefined
    }
  }, [s.id, s.homePath, s.host, panelReady, p])

  const gate = (node: React.ReactNode) =>
    panelReady || !p ? (
      node
    ) : (
      <PanelSetup profile={p} canCancel={false} onCancel={() => undefined} onSaved={props.onProfileChanged} />
    )

  return (
    <div className="session">
      <div className="session-head">
        <span className="dot green" />
        <div className="who">
          <b>{s.name}</b>
          <span>{s.host}</span>
        </div>
        <div className="spacer" />
        {panelPid && <ServerBar profileId={panelPid} sftpHost={s.host.split(':')[0]} active={props.active} />}
        <button className="btn ghost sm" onClick={props.onDisconnect} title={tr('Закрыть соединение')}>
          <LogOut size={14} />{' '}{tr('Отключиться')}
        </button>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} title={t.title} onClick={() => go(t.id)}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div className="session-body">
        <Pane show={tab === 'files'}>
          <FileManager fs={fsb} active={props.active && tab === 'files'} onOpenConsole={() => go('server')} />
        </Pane>
        {opened.has('server') && p && (
          <Pane show={tab === 'server'}>
            <PanelConsole profile={p} visible={props.active && tab === 'server'} onProfileChanged={props.onProfileChanged} />
          </Pane>
        )}
        {opened.has('addons') && (
          <Pane show={tab === 'addons'}>
            <AddonsView fs={fsb} adapter={adapter} visible={props.active && tab === 'addons'} />
          </Pane>
        )}
        {opened.has('players') && (
          <Pane show={tab === 'players'}>
            <PlayersView adapter={adapter} visible={props.active && tab === 'players'} />
          </Pane>
        )}
        {opened.has('props') && (
          <Pane show={tab === 'props'}>
            <PropertiesForm adapter={adapter} visible={props.active && tab === 'props'} />
          </Pane>
        )}
        {opened.has('backups') && (
          <Pane show={tab === 'backups'}>{gate(panelPid && <PanelBackups profileId={panelPid} visible={props.active && tab === 'backups'} />)}</Pane>
        )}
        {opened.has('schedules') && (
          <Pane show={tab === 'schedules'}>{gate(panelPid && <SchedulesView profileId={panelPid} visible={props.active && tab === 'schedules'} />)}</Pane>
        )}
        {opened.has('panel') && (
          <Pane show={tab === 'panel'}>{gate(panelPid && <PanelManage profileId={panelPid} visible={props.active && tab === 'panel'} />)}</Pane>
        )}
        {opened.has('ssh') && (
          <Pane show={tab === 'ssh'}>
            <ShellConsole sessionId={s.id} visible={props.active && tab === 'ssh'} />
          </Pane>
        )}
      </div>
    </div>
  )
}

function Pane(props: { show: boolean; children: React.ReactNode }) {
  return <div className={`pane ${props.show ? '' : 'hidden'}`}>{props.children}</div>
}
