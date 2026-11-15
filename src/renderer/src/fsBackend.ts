import type { RemoteEntry } from '@shared/types'
import { api } from './api'
import { tr } from '@shared/i18n'

/**
 * Источник файлов для файлового менеджера: SFTP хостинга или папка локального сервера.
 * Пути всегда в стиле "/папка/файл".
 */
export interface FsBackend {
  /** ключ для событий transfer:update / sftp:changed */
  key: string
  home: string
  list(dir: string): Promise<RemoteEntry[]>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(paths: string[]): Promise<void>
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  upload(locals: string[], dir: string): Promise<void>
  download(paths: string[], localDir: string): Promise<void>
  /** sha1 файлов */
  hash(paths: string[]): Promise<string[]>
  /** удаление уходит в корзину (можно восстановить) */
  trash?: boolean
  /** архивы и скачивание по ссылке — если поддерживается */
  archive?: {
    decompress(dir: string, name: string): Promise<void>
    compress(dir: string, names: string[]): Promise<string | undefined>
    pull(url: string, dir: string): Promise<void>
    /** подсказка в строке состояния */
    hint: string
  }
  /** показать в проводнике (только локальные файлы) */
  reveal?(path: string): Promise<void>
}

export function sftpBackend(sessionId: string, home: string, panelProfileId: string | null): FsBackend {
  return {
    key: sessionId,
    home,
    list: (d) => api.sftp.list(sessionId, d),
    mkdir: (p) => api.sftp.mkdir(sessionId, p),
    rename: (a, b) => api.sftp.rename(sessionId, a, b),
    remove: (ps) => api.sftp.remove(sessionId, ps),
    readText: (p) => api.sftp.readText(sessionId, p),
    writeText: (p, c) => api.sftp.writeText(sessionId, p, c),
    upload: (l, d) => api.sftp.upload(sessionId, l, d, panelProfileId),
    download: (ps, d) => api.sftp.download(sessionId, ps, d, panelProfileId),
    hash: (ps) => api.sftp.hash(sessionId, ps),
    archive: panelProfileId
      ? {
          decompress: (root, file) => api.panel.request(panelProfileId, 'POST', '/files/decompress', { root, file }).then(() => undefined),
          compress: (root, files) =>
            api.panel.request<any>(panelProfileId, 'POST', '/files/compress', { root, files }).then((r) => r?.attributes?.name as string | undefined),
          pull: (url, directory) => api.panel.request(panelProfileId, 'POST', '/files/pull', { url, directory }).then(() => undefined),
          hint: tr('Архивы распаковываются прямо на сервере — ПКМ по файлу')
        }
      : undefined
  }
}

export function localBackend(serverId: string): FsBackend {
  return {
    key: `local:${serverId}`,
    home: '/',
    trash: true,
    list: (d) => api.lfs.list(serverId, d),
    mkdir: (p) => api.lfs.mkdir(serverId, p),
    rename: (a, b) => api.lfs.rename(serverId, a, b),
    remove: (ps) => api.lfs.remove(serverId, ps),
    readText: (p) => api.lfs.readText(serverId, p),
    writeText: (p, c) => api.lfs.writeText(serverId, p, c),
    upload: (l, d) => api.lfs.upload(serverId, l, d),
    download: (ps, d) => api.lfs.download(serverId, ps, d),
    hash: (ps) => api.lfs.hash(serverId, ps),
    archive: {
      decompress: (dir, name) => api.lfs.decompress(serverId, dir, name),
      compress: (dir, names) => api.lfs.compress(serverId, dir, names),
      pull: (url, dir) => api.lfs.pull(serverId, dir, url).then(() => undefined),
      hint: tr('Удалённые файлы попадают в корзину Windows')
    },
    reveal: (p) => api.lfs.reveal(serverId, p)
  }
}
