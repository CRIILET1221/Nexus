import { NOT_FOUND_RE } from '@shared/i18n'
import { useCallback, useEffect, useState } from 'react'
import type { PingResult } from '@shared/types'
import { api } from './api'

/**
 * Общий интерфейс сервера для вкладок «Игроки» и «Настройки»:
 * одинаково работает для хостинга (SFTP + API панели) и локального сервера.
 */
export interface ServerAdapter {
  key: string
  /** можно ли отправлять команды (сервер запущен / панель настроена) */
  canCommand: boolean
  /** почему нельзя отправлять команды */
  commandHint?: string
  command(cmd: string): Promise<void>
  /** читает файл из корня сервера; null — файла нет */
  readFile(name: string): Promise<string | null>
  writeFile(name: string, content: string): Promise<void>
  /** байты файла (путь относительно корня сервера); null — файла нет */
  readBinary(name: string): Promise<Uint8Array | null>
  /** содержимое папки; null — папки нет */
  listDir(name: string): Promise<DirEntry[] | null>
  ping(): Promise<PingResult>
  restart?: () => Promise<void>
}

export interface DirEntry {
  name: string
  isDir: boolean
  size: number
  mtime: number
}

const NOT_FOUND = NOT_FOUND_RE
/** null вместо ошибки «нет такого файла» */
export async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p
  } catch (e) {
    if (NOT_FOUND.test(String(e))) return null
    throw e
  }
}

// ---------- Данные сервера из панели ----------

export interface PanelServerInfo {
  name: string
  description: string
  dockerImage: string
  limits: { memory: number; disk: number; cpu: number }
  featureLimits: { databases: number; allocations: number; backups: number }
  allocations: { id: number; ip: string; alias: string | null; port: number; isDefault: boolean; notes: string | null }[]
  sftp: { ip: string; port: number }
}

const infoCache = new Map<string, PanelServerInfo>()

export async function fetchPanelServer(profileId: string, force = false): Promise<PanelServerInfo> {
  const cached = infoCache.get(profileId)
  if (cached && !force) return cached
  const res = await api.panel.request<any>(profileId, 'GET', '')
  const a = res.attributes
  const info: PanelServerInfo = {
    name: a.name,
    description: a.description ?? '',
    dockerImage: a.docker_image ?? '',
    limits: a.limits ?? { memory: 0, disk: 0, cpu: 0 },
    featureLimits: a.feature_limits ?? { databases: 0, allocations: 0, backups: 0 },
    allocations: (a.relationships?.allocations?.data ?? []).map((x: any) => ({
      id: x.attributes.id,
      ip: x.attributes.ip,
      alias: x.attributes.ip_alias,
      port: x.attributes.port,
      isDefault: x.attributes.is_default,
      notes: x.attributes.notes
    })),
    sftp: a.sftp_details ?? { ip: '', port: 0 }
  }
  infoCache.set(profileId, info)
  return info
}

export function usePanelServer(profileId: string | null) {
  const [info, setInfo] = useState<PanelServerInfo | null>(profileId ? infoCache.get(profileId) ?? null : null)
  const reload = useCallback(
    (force = true) => {
      if (!profileId) return Promise.resolve(null)
      return fetchPanelServer(profileId, force).then((i) => (setInfo(i), i)).catch(() => null)
    },
    [profileId]
  )
  useEffect(() => {
    if (profileId) reload(false)
  }, [profileId, reload])
  return { info, reload }
}

/** Адрес игры: алиас/IP основной аллокации; 0.0.0.0 заменяем на хост SFTP */
export function gameAddress(info: PanelServerInfo | null, fallbackHost: string) {
  const a = info?.allocations.find((x) => x.isDefault) ?? info?.allocations[0]
  if (!a) return { host: fallbackHost, port: 25565 }
  const host = a.alias || (a.ip === '0.0.0.0' || a.ip.startsWith('172.') ? fallbackHost : a.ip)
  return { host, port: a.port }
}

/** Человекочитаемая ошибка */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
