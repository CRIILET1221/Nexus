import type {
  ConnectionProfile,
  CreateServerInput,
  JavaInfo,
  LocalBackup,
  LocalServerConfig,
  PingResult,
  ProfileInput,
  RemoteEntry,
  ServerCore,
  ServerRuntime,
  SessionInfo
} from '@shared/types'

export type AddonType = 'plugin' | 'mod' | 'datapack'

export interface SearchHit {
  id: string
  slug: string
  title: string
  description: string
  author: string
  icon?: string
  downloads: number
  follows: number
  updated: string
  categories: string[]
  clientSide?: string
  serverSide?: string
}

export interface ModVersion {
  id: string
  projectId: string
  name: string
  number: string
  type: string
  published: string
  gameVersions: string[]
  loaders: string[]
  file: { url: string; filename: string; sha1: string; size: number }
  dependencies: { projectId?: string; versionId?: string; type: string }[]
}

export interface ProjectInfo {
  id: string
  slug: string
  title: string
  icon?: string
  description: string
}

export interface TextureStatus {
  installed: boolean
  version?: string
  items: string[]
  blocks: string[]
}

interface Bridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  send(channel: string, ...args: unknown[]): void
  on(channel: string, cb: (payload: any) => void): () => void
  pathForFile(file: File): string
}

const b = (window as unknown as { nexus: Bridge }).nexus
const i = b.invoke

export const api = {
  app: {
    version: () => i<string>('app:version')
  },

  on: b.on,
  pathForFile: b.pathForFile,

  profiles: {
    list: () => i<ConnectionProfile[]>('profiles:list'),
    save: (p: ProfileInput) => i<ConnectionProfile>('profiles:save', p),
    remove: (id: string) => i<void>('profiles:remove', id)
  },

  dialog: {
    open: (opts: { directories?: boolean; multi?: boolean; title?: string; filters?: { name: string; extensions: string[] }[] }) =>
      i<string[]>('dialog:openFiles', opts),
    confirm: (opts: { title: string; message: string; detail?: string; ok?: string; danger?: boolean }) =>
      i<boolean>('dialog:confirm', opts)
  },

  ssh: {
    connect: (profileId: string, secret?: string) => i<SessionInfo>('ssh:connect', profileId, secret),
    disconnect: (id: string) => i<void>('ssh:disconnect', id)
  },

  sftp: {
    list: (id: string, dir: string) => i<RemoteEntry[]>('sftp:list', id, dir),
    mkdir: (id: string, path: string) => i<void>('sftp:mkdir', id, path),
    rename: (id: string, from: string, to: string) => i<void>('sftp:rename', id, from, to),
    remove: (id: string, paths: string[]) => i<void>('sftp:remove', id, paths),
    readText: (id: string, path: string) => i<string>('sftp:readText', id, path),
    writeText: (id: string, path: string, content: string) => i<void>('sftp:writeText', id, path, content),
    readBinary: (id: string, path: string) => i<Uint8Array>('sftp:readBinary', id, path),
    hash: (id: string, paths: string[]) => i<string[]>('sftp:hash', id, paths),
    upload: (id: string, locals: string[], dir: string) => i<void>('sftp:upload', id, locals, dir),
    download: (id: string, remotes: string[], localDir: string) => i<void>('sftp:download', id, remotes, localDir)
  },

  shell: {
    open: (sessionId: string, cols: number, rows: number) => i<string>('shell:open', sessionId, cols, rows),
    write: (id: string, data: string) => b.send('shell:write', id, data),
    resize: (id: string, cols: number, rows: number) => b.send('shell:resize', id, cols, rows),
    close: (id: string) => i<void>('shell:close', id)
  },

  panel: {
    servers: (url: string, key: string) => i<{ id: string; name: string; node?: string }[]>('panel:servers', url, key),
    normalize: (url: string) => i<string>('panel:normalize', url),
    discover: (url: string, key: string) =>
      i<{
        panelUrl: string
        username: string
        servers: { id: string; name: string; node?: string; sftpHost: string; sftpPort: number; sftpUser: string; isOwner: boolean }[]
      }>('panel:discover', url, key),
    open: (profileId: string) => i<string>('panel:open', profileId),
    command: (id: string, cmd: string) => i<void>('panel:command', id, cmd),
    power: (id: string, signal: 'start' | 'stop' | 'restart' | 'kill') => i<void>('panel:power', id, signal),
    reconnect: (id: string) => i<void>('panel:reconnect', id),
    close: (id: string) => i<void>('panel:close', id),
    /** Client API сервера: path относительно /api/client/servers/{id} */
    request: <T = any>(profileId: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
      i<T>('panel:request', profileId, method, path, body),
    download: (url: string, name: string, progressId: string) => i<string | null>('panel:download', url, name, progressId)
  },

  mc: {
    list: () => i<LocalServerConfig[]>('mc:list'),
    runtimes: () => i<ServerRuntime[]>('mc:runtimes'),
    versions: (core: ServerCore) => i<string[]>('mc:versions', core),
    requiredJava: (version: string) => i<number>('mc:requiredJava', version),
    detectJava: () => i<JavaInfo>('mc:detectJava'),
    setJavaPath: (path?: string) => i<JavaInfo>('mc:setJavaPath', path),
    defaultDir: () => i<string>('mc:defaultDir'),
    create: (input: CreateServerInput, progressId: string) => i<LocalServerConfig>('mc:create', input, progressId),
    update: (id: string, patch: Partial<LocalServerConfig>) => i<LocalServerConfig>('mc:update', id, patch),
    remove: (id: string, deleteFiles: boolean) => i<void>('mc:delete', id, deleteFiles),
    start: (id: string) => i<void>('mc:start', id),
    stop: (id: string) => i<void>('mc:stop', id),
    kill: (id: string) => i<void>('mc:kill', id),
    command: (id: string, cmd: string) => i<void>('mc:command', id, cmd),
    log: (id: string) => i<string>('mc:log', id),
    clearLog: (id: string) => i<void>('mc:clearLog', id),
    lan: () => i<string[]>('mc:lan'),
    ping: (host: string, port: number) => i<PingResult>('mc:ping', host, port),
    backups: (id: string) => i<LocalBackup[]>('mc:backups', id),
    backupCreate: (id: string, label?: string) => i<LocalBackup>('mc:backupCreate', id, label),
    backupRestore: (id: string, name: string) => i<void>('mc:backupRestore', id, name),
    backupDelete: (id: string, name: string) => i<void>('mc:backupDelete', id, name),
    backupsDir: (id: string) => i<string>('mc:backupsDir', id)
  },

  /** файлы локального сервера (пути в стиле "/plugins") */
  lfs: {
    list: (id: string, dir: string) => i<RemoteEntry[]>('lfs:list', id, dir),
    mkdir: (id: string, p: string) => i<void>('lfs:mkdir', id, p),
    rename: (id: string, a: string, b: string) => i<void>('lfs:rename', id, a, b),
    remove: (id: string, paths: string[]) => i<void>('lfs:remove', id, paths),
    readText: (id: string, p: string) => i<string>('lfs:readText', id, p),
    writeText: (id: string, p: string, c: string) => i<void>('lfs:writeText', id, p, c),
    upload: (id: string, locals: string[], dir: string) => i<void>('lfs:upload', id, locals, dir),
    download: (id: string, paths: string[], dest: string) => i<void>('lfs:download', id, paths, dest),
    decompress: (id: string, dir: string, name: string) => i<void>('lfs:decompress', id, dir, name),
    compress: (id: string, dir: string, names: string[]) => i<string>('lfs:compress', id, dir, names),
    pull: (id: string, dir: string, url: string, name?: string) => i<string>('lfs:pull', id, dir, url, name),
    reveal: (id: string, p: string) => i<void>('lfs:reveal', id, p),
    hash: (id: string, paths: string[]) => i<string[]>('lfs:hash', id, paths)
  },

  modrinth: {
    search: (opts: {
      query: string
      type: AddonType
      loaders: string[]
      gameVersion?: string
      index?: 'relevance' | 'downloads' | 'updated' | 'follows'
      offset?: number
    }) => i<{ hits: SearchHit[]; total: number }>('modrinth:search', opts),
    versions: (projectId: string, loaders: string[], gameVersion?: string) => i<ModVersion[]>('modrinth:versions', projectId, loaders, gameVersion),
    version: (id: string) => i<ModVersion | null>('modrinth:version', id),
    projects: (ids: string[]) => i<ProjectInfo[]>('modrinth:projects', ids),
    identify: (hashes: string[]) => i<Record<string, ModVersion>>('modrinth:identify', hashes),
    updates: (hashes: string[], loaders: string[], gameVersion?: string) => i<Record<string, ModVersion>>('modrinth:updates', hashes, loaders, gameVersion),
    downloadTemp: (file: ModVersion['file']) => i<string>('modrinth:downloadTemp', file),
    cleanupTemp: (path: string) => i<void>('modrinth:cleanupTemp', path)
  },

  textures: {
    status: () => i<TextureStatus>('textures:status'),
    install: (progressId: string) => i<TextureStatus>('textures:install', progressId),
    remove: () => i<void>('textures:remove')
  },

  fs: {
    readText: (path: string) => i<string>('fs:readText', path),
    writeText: (path: string, content: string) => i<void>('fs:writeText', path, content),
    exists: (path: string) => i<boolean>('fs:exists', path),
    readBinary: (path: string) => i<Uint8Array>('fs:readBinary', path),
    list: (dir: string) => i<{ name: string; isDir: boolean; size: number; mtime: number }[]>('fs:list', dir),
    openPath: (path: string) => i<string>('shell:openPath', path),
    openExternal: (url: string) => i<void>('shell:openExternal', url),
    showItem: (path: string) => i<void>('shell:showItem', path)
  }
}
