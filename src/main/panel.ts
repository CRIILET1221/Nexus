// Консоль сервера через API панели хостинга (Pterodactyl / Pelican и совместимые).
// Документация протокола: https://pterodactyl.io  (Client API + websocket Wings)
import WebSocket from 'ws'
import { randomUUID } from 'node:crypto'
import type { PanelLink, PanelState, PanelStats } from '../shared/types'
import { profiles } from './store'
import { emit } from './events'
import { tr } from '../shared/i18n'

export function normalizePanelUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '')
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u
  // если вставили ссылку на страницу сервера — оставляем только адрес панели
  try {
    return new URL(u).origin
  } catch {
    throw new Error(tr('Некорректный адрес панели'))
  }
}

/** Ошибка, которую бессмысленно повторять (неверный ключ, адрес, ID сервера) */
function fatal(message: string) {
  const e = new Error(message) as Error & { fatal?: boolean }
  e.fatal = true
  return e
}

async function panelApi<T = any>(base: string, key: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${base}/api/client${path}`, {
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      }
    })
  } catch (e) {
    if ((e as Error)?.name === 'TimeoutError') throw new Error(tr('Панель {0} не отвечает (больше 20 секунд)', new URL(base).host))
    throw new Error(tr('Панель {0} недоступна — проверьте адрес', new URL(base).host))
  }
  if (res.status === 401 || res.status === 403) throw fatal(tr('API-ключ не подходит или у него нет доступа к этому серверу'))
  if (res.status === 404) throw fatal(tr('Сервер не найден в панели — проверьте ID сервера'))
  if (res.status === 409) throw new Error(tr('Сервер сейчас устанавливается или перемещается — попробуйте позже'))
  if (!res.ok) throw new Error(tr('Панель ответила ошибкой {0}', res.status))
  if (res.status === 204) return undefined as T
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw fatal(tr('Это не похоже на панель Pterodactyl — ответ не JSON. Проверьте адрес панели.'))
  }
}

export interface PanelServer {
  id: string
  name: string
  node?: string
}

/** Список серверов, доступных по ключу (для формы настройки) */
export async function listServers(url: string, key: string): Promise<PanelServer[]> {
  const base = normalizePanelUrl(url)
  const out: PanelServer[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await panelApi<any>(base, key.trim(), `?page=${page}&per_page=100`)
    for (const s of res.data ?? []) out.push({ id: s.attributes.identifier, name: s.attributes.name, node: s.attributes.node })
    const pg = res.meta?.pagination
    if (!pg || pg.current_page >= pg.total_pages) break
  }
  return out
}

export interface DiscoveredServer {
  id: string
  name: string
  node?: string
  sftpHost: string
  sftpPort: number
  sftpUser: string
  isOwner: boolean
}

/** Всё, что нужно для подключения: аккаунт + серверы с данными SFTP */
export async function discover(url: string, key: string): Promise<{ panelUrl: string; username: string; servers: DiscoveredServer[] }> {
  const base = normalizePanelUrl(url)
  const k = key.trim()
  const account = await panelApi<any>(base, k, '/account')
  const username: string = account?.attributes?.username
  if (!username) throw new Error(tr('Панель не вернула имя пользователя'))
  const panelHost = new URL(base).hostname
  const servers: DiscoveredServer[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await panelApi<any>(base, k, `?page=${page}&per_page=100`)
    for (const s of res.data ?? []) {
      const a = s.attributes
      const ip: string = a.sftp_details?.ip ?? ''
      // 0.0.0.0 / внутренние адреса — SFTP обычно доступен по адресу ноды/панели
      const host = !ip || ip === '0.0.0.0' || /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip) ? panelHost : ip
      servers.push({
        id: a.identifier,
        name: a.name,
        node: a.node,
        sftpHost: host,
        sftpPort: a.sftp_details?.port ?? 2022,
        sftpUser: `${username}.${a.identifier}`,
        isOwner: !!a.server_owner
      })
    }
    const pg = res.meta?.pagination
    if (!pg || pg.current_page >= pg.total_pages) break
  }
  return { panelUrl: base, username, servers }
}

function creds(profileId: string) {
  const p = profiles.get(profileId)
  const key = profiles.panelKey(profileId)
  if (!p?.panelUrl || !p.panelServerId || !key) throw fatal(tr('Консоль панели не настроена для этого подключения'))
  return { base: normalizePanelUrl(p.panelUrl), key, sid: p.panelServerId }
}

// ---------- Универсальный запрос к API сервера ----------

/**
 * Запрос к Client API для сервера из профиля.
 * path — относительно /api/client/servers/{id}, например "/backups" или "" (сам сервер).
 */
export async function serverRequest(profileId: string, method: string, path: string, body?: unknown) {
  const { base, key, sid } = creds(profileId)
  return panelApi(base, key, `/servers/${sid}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

/** Скачивает файл по ссылке (бэкап) с прогрессом в событиях download:progress */
export async function downloadUrl(url: string, dest: string, progressId: string) {
  const { createWriteStream } = await import('node:fs')
  const { rename, rm } = await import('node:fs/promises')
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(tr('Не удалось скачать (HTTP {0})', res.status))
  const total = Number(res.headers.get('content-length') ?? 0)
  const tmp = dest + '.part'
  const out = createWriteStream(tmp)
  let done = 0
  let last = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const r = await reader.read()
      if (r.done) break
      done += r.value.length
      if (!out.write(r.value)) await new Promise((ok) => out.once('drain', ok))
      if (Date.now() - last > 150) {
        last = Date.now()
        emit('download:progress', { id: progressId, transferred: done, total })
      }
    }
    await new Promise<void>((ok, fail) => out.end((e?: Error | null) => (e ? fail(e) : ok())))
    await rename(tmp, dest)
    emit('download:progress', { id: progressId, transferred: done, total: total || done, done: true })
  } catch (e) {
    out.destroy()
    await rm(tmp, { force: true })
    emit('download:progress', { id: progressId, transferred: done, total, error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

// ---------- Консоль через websocket ----------

interface Console {
  id: string
  profileId: string
  ws?: WebSocket
  closed: boolean
  retry: number
  timer?: NodeJS.Timeout
  /** ошибок токена подряд (сбрасывается после успешного входа) */
  jwtFails: number
  /** когда последний раз обновляли токен по «token expiring» */
  lastRefresh: number
  /** тихое переподключение (после устаревшего токена) — без служебных строк в консоли */
  quiet?: boolean
  /** консоль уже хотя бы раз подключалась */
  everConnected?: boolean
}

const consoles = new Map<string, Console>()

// одинаковые строки подряд (например, одна и та же ошибка панели) не заваливают консоль
const lastLine = new Map<string, { text: string; at: number; count: number }>()
const out = (id: string, data: string) => {
  const prev = lastLine.get(id)
  const now = Date.now()
  if (prev && prev.text === data && now - prev.at < 10_000) {
    prev.count++
    prev.at = now
    return
  }
  if (prev && prev.count > 0) {
    emit('panel:output', { id, data: tr('\x1b[90m[NexAtom] (предыдущее сообщение повторилось ещё {0} раз)\x1b[0m\r\n', prev.count) })
  }
  lastLine.set(id, { text: data, at: now, count: 0 })
  emit('panel:output', { id, data })
}
const link = (id: string, state: PanelLink, error?: string, quiet?: boolean) => emit('panel:link', { id, state, error, quiet })

export function openConsole(profileId: string): string {
  creds(profileId) // проверка, что всё настроено
  const c: Console = { id: randomUUID(), profileId, closed: false, retry: 0, jwtFails: 0, lastRefresh: 0 }
  consoles.set(c.id, c)
  // запуск после возврата id, чтобы интерфейс успел подписаться на события
  setTimeout(() => connect(c), 50)
  return c.id
}

async function fetchToken(c: Console) {
  const { base, key, sid } = creds(c.profileId)
  const res = await panelApi<{ data: { token: string; socket: string } }>(base, key, `/servers/${sid}/websocket`)
  return { ...res.data, origin: base }
}

async function connect(c: Console) {
  if (c.closed) return
  link(c.id, c.retry ? 'reconnecting' : 'connecting')
  if (!c.quiet) out(c.id, tr('\x1b[90m[NexAtom] Получаю доступ к консоли у панели…\x1b[0m\r\n'))
  let token: string, socket: string, origin: string
  try {
    ;({ token, socket, origin } = await fetchToken(c))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out(c.id, `\x1b[31m[NexAtom] ${msg}\x1b[0m\r\n`)
    // ошибки ключа/ID повторять бессмысленно
    if ((e as { fatal?: boolean })?.fatal) {
      link(c.id, 'closed', msg)
      return
    }
    return scheduleReconnect(c)
  }

  if (!c.quiet) out(c.id, tr('\x1b[90m[NexAtom] Подключаюсь к серверу консоли {0}…\x1b[0m\r\n', new URL(socket).host))
  // handshakeTimeout — иначе при недоступном порте подключение может висеть бесконечно
  const ws = new WebSocket(socket, { origin, handshakeTimeout: 15_000 })
  c.ws = ws
  let authTimer: ReturnType<typeof setTimeout> | undefined
  let jwtRejected = false
  const send = (event: string, args: unknown[] = []) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, args }))
  }

  ws.on('open', () => {
    send('auth', [token])
    authTimer = setTimeout(() => {
      out(c.id, tr('\x1b[31m[NexAtom] Сервер консоли не подтвердил вход за 15 секунд\x1b[0m\r\n'))
      ws.terminate()
    }, 15_000)
  })
  ws.on('message', async (raw) => {
    let msg: { event: string; args?: any[] }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const a = msg.args ?? []
    switch (msg.event) {
      case 'auth success':
        clearTimeout(authTimer)
        c.retry = 0
        c.jwtFails = 0
        // «Подключено» молчим только при обновлении токена в уже работавшей консоли
        link(c.id, 'connected', undefined, c.quiet && c.everConnected)
        c.quiet = false
        c.everConnected = true
        send('send logs', [null])
        send('send stats', [null])
        break
      case 'console output':
      case 'install output':
        // вывод самого сервера — как есть, без склейки повторов (повторы в чате — нормально)
        emit('panel:output', { id: c.id, data: String(a[0] ?? '') + '\r\n' })
        break
      case 'daemon message':
        out(c.id, tr('\x1b[33m[Панель] {0}\x1b[0m\r\n', a[0] ?? ''))
        break
      case 'daemon error':
        out(c.id, tr('\x1b[31m[Панель] {0}\x1b[0m\r\n', a[0] ?? 'ошибка'))
        break
      case 'jwt error':
        // токен отвергнут — не повторяем в этом же соединении, а переподключаемся с новым токеном.
        // Считаем не больше одного отказа на соединение: Wings может прислать пачку одинаковых ошибок.
        if (jwtRejected) break
        jwtRejected = true
        c.jwtFails++
        if (c.jwtFails >= 3) {
          out(c.id, tr('\x1b[31m[NexAtom] Сервер консоли трижды отверг новый токен ({0}). Обычно это значит, что на сервере хостинга сбиты часы — сообщите об этом в поддержку хостинга.\x1b[0m\r\n', a[0] ?? 'jwt'))
          c.closed = true
          link(c.id, 'closed', String(a[0] ?? 'jwt'))
          ws.close()
          return
        }
        // переподключаемся молча — это рутинное обновление токена
        c.quiet = true
        ws.close()
        break
      case 'status':
        emit('panel:state', { id: c.id, state: a[0] as PanelState })
        break
      case 'stats':
        try {
          const s = JSON.parse(a[0])
          const stats: PanelStats = {
            memory: s.memory_bytes ?? 0,
            memoryLimit: s.memory_limit_bytes ?? 0,
            cpu: s.cpu_absolute ?? 0,
            disk: s.disk_bytes ?? 0,
            uptime: s.uptime ?? 0
          }
          emit('panel:stats', { id: c.id, stats })
          if (s.state) emit('panel:state', { id: c.id, state: s.state })
        } catch {
          /* ignore */
        }
        break
      case 'token expiring':
        // Wings напоминает каждые несколько секунд — обновляем не чаще раза в минуту
        if (Date.now() - c.lastRefresh < 60_000) break
        c.lastRefresh = Date.now()
        try {
          const t = await fetchToken(c)
          send('auth', [t.token])
        } catch {
          /* при истечении переподключимся */
        }
        break
      case 'token expired':
        ws.close()
        break
    }
  })
  ws.on('unexpected-response', (_req, res) => {
    out(c.id, tr('\x1b[31m[NexAtom] Сервер консоли отклонил подключение (HTTP {0})\x1b[0m\r\n', res.statusCode))
  })
  ws.on('error', (e: Error & { code?: string }) => {
    const host = new URL(socket).host
    const m = e.message || ''
    const text = /handshake has timed out/i.test(m) || e.code === 'ETIMEDOUT'
      ? tr('Сервер консоли {0} не отвечает — порт закрыт или заблокирован сетью', host)
      : e.code === 'ECONNREFUSED'
        ? tr('Сервер консоли {0} отклонил соединение — возможно, хостинг сейчас недоступен', host)
        : e.code === 'ENOTFOUND'
          ? tr('Адрес сервера консоли {0} не найден', host)
          : /certificate|self.signed|CERT_/i.test(m + (e.code ?? ''))
            ? tr('Ошибка сертификата сервера консоли {0}: {1}', host, m)
            : m
    out(c.id, `\x1b[31m[NexAtom] ${text}\x1b[0m\r\n`)
  })
  ws.on('close', () => {
    clearTimeout(authTimer)
    if (c.ws === ws) c.ws = undefined
    if (!c.closed) scheduleReconnect(c)
  })
}

function scheduleReconnect(c: Console) {
  if (c.closed) return
  c.retry++
  const delay = Math.min(30_000, 1500 * 2 ** Math.min(c.retry, 5))
  link(c.id, 'reconnecting')
  if (!c.quiet) out(c.id, tr('\x1b[90m[NexAtom] Повторная попытка через {0} с…\x1b[0m\r\n', Math.round(delay / 1000)))
  c.timer = setTimeout(() => connect(c), delay)
}

function wsSend(id: string, event: string, args: unknown[]) {
  const c = consoles.get(id)
  if (!c?.ws || c.ws.readyState !== WebSocket.OPEN) throw new Error(tr('Нет связи с консолью сервера'))
  c.ws.send(JSON.stringify({ event, args }))
}

export function sendCommand(id: string, command: string) {
  wsSend(id, 'send command', [command])
}

export function setPower(id: string, signal: 'start' | 'stop' | 'restart' | 'kill') {
  wsSend(id, 'set state', [signal])
}

export function reconnect(id: string) {
  const c = consoles.get(id)
  if (!c) return
  if (c.timer) clearTimeout(c.timer)
  c.retry = 0
  c.jwtFails = 0
  c.closed = false
  c.ws?.removeAllListeners('close')
  c.ws?.close()
  c.ws = undefined
  connect(c)
}

export function closeConsole(id: string) {
  const c = consoles.get(id)
  if (!c) return
  c.closed = true
  if (c.timer) clearTimeout(c.timer)
  c.ws?.close()
  consoles.delete(id)
}

export function closeAll() {
  for (const id of [...consoles.keys()]) closeConsole(id)
}
