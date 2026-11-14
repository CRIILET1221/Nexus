import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type TextureStatus } from '../api'
import { modOf, prettyId, shortId } from './player'

/**
 * Иконки предметов. Текстуры берутся из клиента Minecraft, который пользователь
 * один раз скачивает с серверов Mojang (кнопка в профиле игрока).
 * Без них показываются аккуратные «плашки» с буквами.
 */

interface Ctx {
  status: TextureStatus | null
  refresh: () => Promise<void>
}
const TexCtx = createContext<Ctx>({ status: null, refresh: async () => undefined })

export function TextureProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TextureStatus | null>(null)
  const refresh = useCallback(async () => {
    setStatus(await api.textures.status().catch(() => null))
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  const value = useMemo(() => ({ status, refresh }), [status, refresh])
  return <TexCtx.Provider value={value}>{children}</TexCtx.Provider>
}

export const useTextures = () => useContext(TexCtx)

// ---------- поиск текстуры по id предмета ----------

const cache = new Map<string, string | null>()

function resolve(id: string, items: Set<string>, blocks: Set<string>): string | null {
  // у модовых предметов своих текстур в клиенте нет — не подбираем похожие ванильные
  if (modOf(id)) return null
  const s = shortId(id)
  const item = (n: string) => (items.has(n) ? `nexus-tex://item/${n}.png` : null)
  const block = (n: string) => {
    for (const v of [n, `${n}_front`, `${n}_side`, `${n}_top`]) if (blocks.has(v)) return `nexus-tex://block/${v}.png`
    return null
  }
  const direct = item(s) ?? item(`${s}_00`) ?? item(`${s}_standby`) ?? block(s)
  if (direct) return direct

  // производные блоки: ступеньки, плиты, заборы, ковры и т.п. → текстура основного блока
  const bases: string[] = []
  const m = /^(.*?)_(slab|stairs|wall|fence_gate|fence|pressure_plate|button|carpet|pane|wood|hyphae)$/.exec(s.replace(/^waxed_/, ''))
  if (m) {
    const b = m[1]
    if (m[2] === 'carpet') bases.push(`${b}_wool`, `${b}_block`)
    if (m[2] === 'wood') bases.push(`${b}_log`)
    if (m[2] === 'hyphae') bases.push(`${b}_stem`)
    bases.push(b, `${b}s`, `${b}_planks`, `${b}_block`, b.replace(/brick$/, 'bricks'), b.replace(/tile$/, 'tiles'))
  }
  bases.push(s.replace(/^waxed_/, ''), `${s}_block`)
  for (const b of bases) {
    const r = item(b) ?? block(b)
    if (r) return r
  }
  return null
}

export function useItemTexture(id: string): string | null {
  const { status } = useTextures()
  return useMemo(() => {
    if (!status?.installed) return null
    const key = `${status.version}:${id}`
    if (cache.has(key)) return cache.get(key)!
    const r = resolve(id, new Set(status.items), new Set(status.blocks))
    cache.set(key, r)
    return r
  }, [status, id])
}

// ---------- компонент ----------

function hue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export function ItemIcon({ id, size = 32 }: { id: string; size?: number }) {
  const url = useItemTexture(id)
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  if (url && !broken) {
    return (
      <span className="item-icon" style={{ width: size, height: size }}>
        {/* фон вместо <img>: анимированные текстуры — вертикальная лента кадров, показываем первый */}
        <span style={{ backgroundImage: `url("${url}")` }} />
        <img src={url} alt="" onError={() => setBroken(true)} hidden />
      </span>
    )
  }
  const words = prettyId(id).split(' ')
  const label = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase()
  const h = hue(id)
  return (
    <span
      className="item-icon fallback"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${h} 35% 22%)`, color: `hsl(${h} 70% 75%)`, borderColor: `hsl(${h} 40% 32%)` }}
    >
      {label}
    </span>
  )
}
