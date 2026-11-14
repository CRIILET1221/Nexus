import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConnectionProfile, ProfileInput, LocalServerConfig } from '../shared/types'

interface StoredProfile extends Omit<ConnectionProfile, 'hasSecret' | 'hasPanelKey'> {
  /** base64 зашифрованного через safeStorage секрета */
  secret?: string
  /** зашифрованный API-ключ панели хостинга */
  panelKey?: string
}

interface StoreData {
  profiles: StoredProfile[]
  servers: LocalServerConfig[]
  javaPath?: string
  /** host:port -> SHA256 отпечаток ключа сервера */
  knownHosts?: Record<string, string>
}

const file = () => join(app.getPath('userData'), 'nexus-data.json')

let cache: StoreData | null = null

function load(): StoreData {
  if (cache) return cache
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), 'utf8'))
      cache = {
        profiles: raw.profiles ?? [],
        servers: raw.servers ?? [],
        javaPath: raw.javaPath,
        knownHosts: raw.knownHosts ?? {}
      }
      return cache
    }
  } catch (e) {
    console.error('Не удалось прочитать данные, создаю заново', e)
  }
  cache = { profiles: [], servers: [] }
  return cache
}

function save() {
  const f = file()
  mkdirSync(dirname(f), { recursive: true })
  const tmp = f + '.tmp'
  writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
  renameSync(tmp, f) // атомарная запись
}

function encrypt(text: string): string {
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(text).toString('base64')
  return 'b64:' + Buffer.from(text, 'utf8').toString('base64')
}

function decrypt(value: string): string {
  if (value.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
  if (value.startsWith('b64:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
  return ''
}

const toPublic = ({ secret, panelKey, ...p }: StoredProfile): ConnectionProfile => ({
  ...p,
  hasSecret: !!secret,
  hasPanelKey: !!panelKey
})

export const profiles = {
  list(): ConnectionProfile[] {
    return load().profiles.map(toPublic)
  },
  get(id: string): StoredProfile | undefined {
    return load().profiles.find((p) => p.id === id)
  },
  secret(id: string): string | undefined {
    const p = this.get(id)
    return p?.secret ? decrypt(p.secret) : undefined
  },
  panelKey(id: string): string | undefined {
    const p = this.get(id)
    return p?.panelKey ? decrypt(p.panelKey) : undefined
  },
  save(input: ProfileInput): ConnectionProfile {
    const data = load()
    const { secret, panelKey, ...rest } = input as ProfileInput & { hasSecret?: boolean; hasPanelKey?: boolean }
    delete rest.hasSecret
    delete rest.hasPanelKey
    let existing = input.id ? data.profiles.find((p) => p.id === input.id) : undefined
    if (!existing) {
      existing = { ...rest, id: randomUUID() } as StoredProfile
      data.profiles.push(existing)
    } else {
      Object.assign(existing, rest)
    }
    if (secret !== undefined) existing.secret = secret === '' ? undefined : encrypt(secret)
    if (panelKey !== undefined) existing.panelKey = panelKey === '' ? undefined : encrypt(panelKey.trim())
    save()
    return toPublic(existing)
  },
  remove(id: string) {
    const data = load()
    data.profiles = data.profiles.filter((p) => p.id !== id)
    save()
  }
}

export const servers = {
  list(): LocalServerConfig[] {
    return load().servers
  },
  get(id: string) {
    return load().servers.find((s) => s.id === id)
  },
  add(cfg: LocalServerConfig) {
    load().servers.push(cfg)
    save()
  },
  update(id: string, patch: Partial<LocalServerConfig>) {
    const s = this.get(id)
    if (s) Object.assign(s, patch, { id })
    save()
    return s
  },
  remove(id: string) {
    const data = load()
    data.servers = data.servers.filter((s) => s.id !== id)
    save()
  }
}

export const knownHosts = {
  get(hostPort: string): string | undefined {
    return load().knownHosts?.[hostPort]
  },
  set(hostPort: string, fingerprint: string) {
    const data = load()
    data.knownHosts = { ...(data.knownHosts ?? {}), [hostPort]: fingerprint }
    save()
  }
}

export const settings = {
  get javaPath() {
    return load().javaPath
  },
  set javaPath(v: string | undefined) {
    load().javaPath = v
    save()
  }
}
