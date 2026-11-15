// Server List Ping — тот же запрос, что делает список серверов в Minecraft.
// Даёт онлайн, максимум, часть списка игроков, версию и MOTD без команд в консоли.
import { Socket } from 'node:net'
import type { PingResult } from '../shared/types'
import { tr } from '../shared/i18n'

function varint(n: number): Buffer {
  const bytes: number[] = []
  do {
    let b = n & 0x7f
    n >>>= 7
    if (n !== 0) b |= 0x80
    bytes.push(b)
  } while (n !== 0)
  return Buffer.from(bytes)
}

function packet(id: number, payload: Buffer) {
  const body = Buffer.concat([varint(id), payload])
  return Buffer.concat([varint(body.length), body])
}

function readVarint(buf: Buffer, offset: number): [number, number] | null {
  let num = 0
  let shift = 0
  let i = offset
  while (i < buf.length) {
    const b = buf[i++]
    num |= (b & 0x7f) << shift
    if (!(b & 0x80)) return [num, i]
    shift += 7
    if (shift > 35) throw new Error('bad varint')
  }
  return null
}

function motdText(d: any): string {
  if (!d) return ''
  if (typeof d === 'string') return d.replace(/§./g, '')
  return ((d.text ?? '') + (d.extra ?? []).map(motdText).join('')).replace(/§./g, '')
}

export function ping(host: string, port: number, timeoutMs = 5000): Promise<PingResult> {
  return new Promise((resolve, reject) => {
    const sock = new Socket()
    let data = Buffer.alloc(0)
    const started = Date.now()
    const fail = (msg: string) => {
      sock.destroy()
      reject(new Error(msg))
    }
    sock.setTimeout(timeoutMs, () => fail(tr('Сервер не ответил (возможно, выключен или порт закрыт)')))
    sock.once('error', (e: NodeJS.ErrnoException) =>
      fail(e.code === 'ECONNREFUSED' ? tr('Сервер выключен или порт закрыт') : e.code === 'ENOTFOUND' ? tr('Адрес не найден') : e.message)
    )
    sock.connect(port, host, () => {
      const hostBuf = Buffer.from(host, 'utf8')
      const portBuf = Buffer.alloc(2)
      portBuf.writeUInt16BE(port)
      const handshake = packet(0, Buffer.concat([varint(767), varint(hostBuf.length), hostBuf, portBuf, varint(1)]))
      sock.write(Buffer.concat([handshake, packet(0, Buffer.alloc(0))]))
    })
    sock.on('data', (chunk: Buffer) => {
      data = Buffer.concat([data, chunk])
      try {
        const len = readVarint(data, 0)
        if (!len || data.length < len[1] + len[0]) return
        const id = readVarint(data, len[1])!
        const strLen = readVarint(data, id[1])!
        const json = JSON.parse(data.subarray(strLen[1], strLen[1] + strLen[0]).toString('utf8'))
        sock.destroy()
        resolve({
          online: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          players: (json.players?.sample ?? []).filter((p: any) => p.name && !p.name.includes('§')),
          version: json.version?.name ?? '',
          motd: motdText(json.description),
          latency: Date.now() - started
        })
      } catch (e) {
        fail(tr('Некорректный ответ сервера'))
      }
    })
  })
}
