// Расшифровка секретов, сохранённых старой версией (Nexus).
// Electron (как и Chromium) шифрует safeStorage ключом AES-256, который лежит в файле
// «Local State» папки данных, а сам ключ защищён Windows DPAPI для текущего пользователя.
// После переименования в NexAtom папка данных новая — значит, и ключ новый.
// Здесь мы достаём старый ключ из %APPDATA%\Nexus\Local State и расшифровываем им старые записи.
import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { createDecipheriv } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let cached: Buffer | null | undefined

/** DPAPI CurrentUser через встроенный PowerShell (в Node нет доступа к DPAPI) */
function dpapiUnprotect(data: Buffer): Buffer {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '$in = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); ' +
    '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($in, $null, "CurrentUser"))'
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: data.toString('base64'),
    windowsHide: true,
    timeout: 20_000
  })
  return Buffer.from(out.toString().trim(), 'base64')
}

function legacyKey(): Buffer | null {
  if (cached !== undefined) return cached
  cached = null
  try {
    if (process.platform !== 'win32') return null
    const file = join(app.getPath('appData'), 'Nexus', 'Local State')
    if (!existsSync(file)) return null
    const b64 = JSON.parse(readFileSync(file, 'utf8'))?.os_crypt?.encrypted_key
    if (!b64) return null
    const raw = Buffer.from(b64, 'base64')
    if (raw.subarray(0, 5).toString() !== 'DPAPI') return null
    const key = dpapiUnprotect(raw.subarray(5))
    cached = key.length === 32 ? key : null
  } catch (e) {
    console.error('[legacy-key]', e instanceof Error ? e.message : e)
  }
  return cached
}

/** Расшифровывает блок safeStorage старым ключом; null — не получилось */
export function decryptLegacy(blob: Buffer): string | null {
  try {
    if (blob.subarray(0, 3).toString() === 'v10') {
      const key = legacyKey()
      if (!key) return null
      const nonce = blob.subarray(3, 15)
      const tag = blob.subarray(blob.length - 16)
      const data = blob.subarray(15, blob.length - 16)
      const d = createDecipheriv('aes-256-gcm', key, nonce)
      d.setAuthTag(tag)
      return Buffer.concat([d.update(data), d.final()]).toString('utf8')
    }
    // очень старый формат — чистый DPAPI без общего ключа
    return dpapiUnprotect(blob).toString('utf8')
  } catch {
    return null
  }
}
