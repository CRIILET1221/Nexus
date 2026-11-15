// Типы, общие для main-процесса, preload и интерфейса.

export type AuthType = 'password' | 'key'

export interface ConnectionProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  /** Путь к приватному ключу (для authType = 'key') */
  keyPath?: string
  /** Папка, которая открывается после подключения */
  remotePath?: string
  /** Есть ли сохранённый (зашифрованный) пароль/passphrase */
  hasSecret: boolean
  color?: string
  /** Адрес панели хостинга (Pterodactyl), например https://panel.host.com */
  panelUrl?: string
  /** Короткий ID сервера в панели (8 символов) */
  panelServerId?: string
  /** Сохранён ли API-ключ панели */
  hasPanelKey: boolean
}

/** Данные формы профиля: секреты передаются отдельно и не возвращаются в интерфейс */
export interface ProfileInput extends Omit<ConnectionProfile, 'id' | 'hasSecret' | 'hasPanelKey'> {
  id?: string
  /** undefined — не менять, '' — удалить, строка — сохранить */
  secret?: string
  /** API-ключ панели: undefined — не менять, '' — удалить */
  panelKey?: string
}

export type PanelState = 'offline' | 'starting' | 'running' | 'stopping'
export type PanelLink = 'connecting' | 'connected' | 'reconnecting' | 'closed'

export interface PanelStats {
  memory: number
  memoryLimit: number
  cpu: number
  disk: number
  uptime: number
}

export interface RemoteEntry {
  name: string
  path: string
  isDir: boolean
  isLink: boolean
  size: number
  mtime: number
  mode: number
}

export type TransferKind = 'upload' | 'download'
export type TransferState = 'active' | 'done' | 'error'

export interface TransferInfo {
  id: string
  sessionId: string
  kind: TransferKind
  name: string
  transferred: number
  total: number
  state: TransferState
  error?: string
  /** текущий этап: «Упаковываю на ПК…», «Файлов: 300» и т.п. */
  stage?: string
  /** скорость, байт/с */
  speed?: number
}

export interface SessionInfo {
  id: string
  profileId: string
  name: string
  host: string
  homePath: string
}

// ---------- Локальные серверы ----------

export type ServerCore = 'paper' | 'purpur' | 'fabric' | 'forge' | 'vanilla'

export interface PingResult {
  online: number
  max: number
  players: { name: string; id: string }[]
  version: string
  motd: string
  latency: number
}

export interface LocalBackup {
  name: string
  size: number
  mtime: number
}

export interface LocalServerConfig {
  id: string
  name: string
  core: ServerCore
  version: string
  dir: string
  jar: string
  memoryMb: number
  port: number
  javaPath: string
  jvmArgs: string
  createdAt: number
  /** Аргументы запуска вместо «-jar <jar>» (например, Forge: @libraries/.../win_args.txt) */
  launchArgs?: string[]
}

export interface CreateServerInput {
  name: string
  core: ServerCore
  version: string
  dir: string
  memoryMb: number
  port: number
  maxPlayers: number
  onlineMode: boolean
  motd: string
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator'
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard'
  acceptEula: boolean
}

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'stopping'

export interface ServerRuntime {
  id: string
  status: ServerStatus
  startedAt?: number
}

export interface JavaInfo {
  path: string
  version: string | null
  major: number | null
}

export interface ProgressEvent {
  id: string
  stage: string
  transferred: number
  total: number
}
