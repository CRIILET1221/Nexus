export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / 1024 ** i
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function formatDate(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatMode(mode: number): string {
  const s = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return s[(mode >> 6) & 7] + s[(mode >> 3) & 7] + s[mode & 7]
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} ч ${m} мин` : m ? `${m} мин ${s % 60} с` : `${s} с`
}

const LANGS: Record<string, string> = {
  json: 'json', yml: 'yaml', yaml: 'yaml', js: 'javascript', mjs: 'javascript', ts: 'typescript',
  sh: 'shell', bash: 'shell', py: 'python', java: 'java', xml: 'xml', html: 'html', css: 'css',
  md: 'markdown', toml: 'ini', properties: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', bat: 'bat',
  cmd: 'bat', sql: 'sql', lua: 'lua', php: 'php', kt: 'kotlin', mcfunction: 'shell'
}

export function languageFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return LANGS[ext] ?? 'plaintext'
}

const BINARY_EXT = new Set([
  'jar', 'zip', 'gz', 'tar', 'rar', '7z', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'mca', 'dat', 'nbt',
  'dat_old', 'exe', 'dll', 'so', 'class', 'db', 'sqlite', 'mp3', 'ogg', 'wav', 'mp4', 'pdf', 'bin'
])

export function isProbablyBinary(name: string) {
  return BINARY_EXT.has(name.toLowerCase().split('.').pop() ?? '')
}

export const joinRemote = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`)

export function parentDir(path: string) {
  if (path === '/' || !path) return '/'
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx)
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36)
