/**
 * Минимальный читатель NBT (формат данных Minecraft, big-endian).
 * Compound → объект, List → массив, числа → number, Long → bigint,
 * массивы байт/int/long → обычные массивы.
 */

export type Nbt = number | bigint | string | Nbt[] | { [k: string]: Nbt }
export type NbtCompound = { [k: string]: Nbt }

const utf8 = new TextDecoder('utf-8')

class Reader {
  private v: DataView
  private buf: Uint8Array
  pos = 0
  constructor(buf: Uint8Array) {
    this.buf = buf
    this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }
  need(n: number) {
    if (this.pos + n > this.buf.length) throw new Error('Повреждённый NBT: неожиданный конец данных')
  }
  u8() {
    this.need(1)
    return this.v.getUint8(this.pos++)
  }
  i8() {
    this.need(1)
    return this.v.getInt8(this.pos++)
  }
  i16() {
    this.need(2)
    const x = this.v.getInt16(this.pos)
    this.pos += 2
    return x
  }
  u16() {
    this.need(2)
    const x = this.v.getUint16(this.pos)
    this.pos += 2
    return x
  }
  i32() {
    this.need(4)
    const x = this.v.getInt32(this.pos)
    this.pos += 4
    return x
  }
  i64() {
    this.need(8)
    const x = this.v.getBigInt64(this.pos)
    this.pos += 8
    return x
  }
  f32() {
    this.need(4)
    const x = this.v.getFloat32(this.pos)
    this.pos += 4
    return x
  }
  f64() {
    this.need(8)
    const x = this.v.getFloat64(this.pos)
    this.pos += 8
    return x
  }
  str() {
    const len = this.u16()
    this.need(len)
    // Java использует «модифицированный UTF-8»; для обычного текста он совпадает с UTF-8
    const s = utf8.decode(this.buf.subarray(this.pos, this.pos + len))
    this.pos += len
    return s
  }
  len() {
    const n = this.i32()
    if (n < 0 || n > 16_000_000) throw new Error('Повреждённый NBT: неверная длина')
    return n
  }
}

function payload(r: Reader, type: number, depth: number): Nbt {
  if (depth > 512) throw new Error('Слишком глубокая вложенность NBT')
  switch (type) {
    case 1:
      return r.i8()
    case 2:
      return r.i16()
    case 3:
      return r.i32()
    case 4:
      return r.i64()
    case 5:
      return r.f32()
    case 6:
      return r.f64()
    case 7: {
      const n = r.len()
      const a: number[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i8()
      return a
    }
    case 8:
      return r.str()
    case 9: {
      const t = r.u8()
      const n = r.len()
      const a: Nbt[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = payload(r, t, depth + 1)
      return a
    }
    case 10: {
      const o: NbtCompound = {}
      for (;;) {
        const t = r.u8()
        if (t === 0) break
        const name = r.str()
        o[name] = payload(r, t, depth + 1)
      }
      return o
    }
    case 11: {
      const n = r.len()
      const a: number[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i32()
      return a
    }
    case 12: {
      const n = r.len()
      const a: bigint[] = new Array(n)
      for (let i = 0; i < n; i++) a[i] = r.i64()
      return a
    }
    default:
      throw new Error(`Неизвестный тип NBT: ${type}`)
  }
}

export function parseNbt(buf: Uint8Array): NbtCompound {
  const r = new Reader(buf)
  const type = r.u8()
  if (type !== 10) throw new Error('Файл не похож на NBT')
  r.str() // имя корня (обычно пустое)
  return payload(r, 10, 0) as NbtCompound
}

/** Распаковывает gzip, если нужно (playerdata хранится сжатым) */
export async function gunzipIfNeeded(buf: Uint8Array): Promise<Uint8Array> {
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function readNbtFile(buf: Uint8Array) {
  return parseNbt(await gunzipIfNeeded(buf))
}
