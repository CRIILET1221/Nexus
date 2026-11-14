import type { Nbt, NbtCompound } from './nbt'

/**
 * Разбор данных игрока (world/playerdata/<uuid>.dat).
 * Поддерживаются старый формат предметов (tag/Count, до 1.20.5),
 * компоненты (1.20.5+) и экипировка отдельным полем (1.21.5+).
 */

export interface Item {
  slot: number
  id: string
  count: number
  name?: string
  enchants: { id: string; lvl: number }[]
  stored: boolean // зачарованная книга: чары «хранятся», а не действуют
  damage?: number
  maxDamage?: number
  unbreakable?: boolean
  lore: string[]
  potion?: string
  contents?: Item[]
}

export interface PlayerData {
  dataVersion?: number
  health: number
  maxHealth: number
  absorption: number
  food: number
  saturation: number
  xpLevel: number
  xpProgress: number
  xpTotal: number
  score: number
  gameMode?: number
  pos?: [number, number, number]
  dimension: string
  flying: boolean
  selectedSlot: number
  inventory: Item[]
  armor: { head?: Item; chest?: Item; legs?: Item; feet?: Item }
  offhand?: Item
  ender: Item[]
  effects: { id: string; amplifier: number; duration: number }[]
  spawn?: { x: number; y: number; z: number; dimension: string }
  lastDeath?: { x: number; y: number; z: number; dimension: string }
  lastPlayed?: number
  firstPlayed?: number
  lastKnownName?: string
}

export interface PlayerStats {
  playTicks?: number
  deaths?: number
  mobKills?: number
  playerKills?: number
  jumps?: number
  distanceCm?: number
  blocksMined?: number
  itemsCrafted?: number
  damageDealt?: number
}

// ---------- помощники ----------

const isObj = (v: unknown): v is NbtCompound => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : d)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const arr = (v: unknown): Nbt[] => (Array.isArray(v) ? v : [])
const ns = (id: string) => (id.includes(':') ? id : `minecraft:${id}`)
export const shortId = (id: string) => id.replace(/^minecraft:/, '')

/** Текстовый компонент (JSON-строка, NBT-компаунд или обычная строка) → текст */
export function textOf(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"')) {
      try {
        return textOf(JSON.parse(t))
      } catch {
        return v
      }
    }
    return v
  }
  if (Array.isArray(v)) return v.map(textOf).join('')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    let s = typeof o.text === 'string' ? o.text : typeof o[''] === 'string' ? (o[''] as string) : ''
    if (!s && typeof o.translate === 'string') s = (o.fallback as string) ?? prettyId(o.translate.split('.').pop() ?? '')
    if (Array.isArray(o.extra)) s += o.extra.map(textOf).join('')
    return s
  }
  return String(v)
}

/** Пространство имён предмета, если это не ванильный Minecraft (create, mekanism, …) */
export function modOf(id: string): string | null {
  const i = id.indexOf(':')
  const ns = i > 0 ? id.slice(0, i) : 'minecraft'
  return ns === 'minecraft' ? null : ns
}

/** minecraft:diamond_sword → Diamond Sword, create:mechanical_press → Mechanical Press */
export function prettyId(id: string) {
  return id
    .replace(/^[a-z0-9_.-]+:/, '')
    .split(/[_/]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

// ---------- прочность ----------

const TOOL_DUR: Record<string, number> = { wooden: 59, stone: 131, iron: 250, golden: 32, diamond: 1561, netherite: 2031, copper: 190 }
const ARMOR_BASE: Record<string, number> = { helmet: 11, chestplate: 16, leggings: 15, boots: 13 }
const ARMOR_MUL: Record<string, number> = { leather: 5, chainmail: 15, iron: 15, golden: 7, diamond: 33, netherite: 37, copper: 11 }
const MISC_DUR: Record<string, number> = {
  bow: 384, crossbow: 465, trident: 250, shield: 336, elytra: 432, fishing_rod: 64, shears: 238, flint_and_steel: 64,
  carrot_on_a_stick: 25, warped_fungus_on_a_stick: 100, mace: 500, brush: 64, turtle_helmet: 275, wolf_armor: 64
}

function maxDurability(id: string): number | undefined {
  const s = shortId(id)
  if (MISC_DUR[s]) return MISC_DUR[s]
  const m = /^(\w+?)_(sword|pickaxe|axe|shovel|hoe|spear)$/.exec(s)
  if (m && TOOL_DUR[m[1]]) return TOOL_DUR[m[1]]
  const a = /^(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(s)
  if (a && ARMOR_MUL[a[1]]) return ARMOR_BASE[a[2]] * ARMOR_MUL[a[1]]
  return undefined
}

// ---------- предметы ----------

function enchantList(v: unknown): { id: string; lvl: number }[] {
  if (Array.isArray(v)) {
    // старый формат: [{id, lvl}]
    return v.filter(isObj).map((e) => ({ id: typeof e.id === 'string' ? ns(e.id) : `#${num(e.id)}`, lvl: num(e.lvl, 1) }))
  }
  if (isObj(v)) {
    // 1.20.5–1.21.4: {levels:{id:lvl}}; 1.21.5+: {id:lvl}
    const map = isObj(v.levels) ? v.levels : v
    return Object.entries(map)
      .filter(([k, lvl]) => k !== 'show_in_tooltip' && typeof lvl === 'number')
      .map(([k, lvl]) => ({ id: ns(k), lvl: num(lvl, 1) }))
  }
  return []
}

export function parseItem(raw: unknown, slot?: number, depth = 0): Item | null {
  if (!isObj(raw)) return null
  const id = str(raw.id)
  if (!id || id === 'minecraft:air') return null
  const c = isObj(raw.components) ? raw.components : null
  const tag = isObj(raw.tag) ? raw.tag : null
  const item: Item = {
    slot: slot ?? num(raw.Slot ?? raw.slot, 0),
    id: ns(id),
    count: num(raw.count ?? raw.Count, 1),
    enchants: [],
    stored: false,
    lore: []
  }
  if (c) {
    item.name = textOf(c['minecraft:custom_name'] ?? c['minecraft:item_name']) || undefined
    item.enchants = enchantList(c['minecraft:enchantments'])
    const stored = enchantList(c['minecraft:stored_enchantments'])
    if (stored.length) (item.enchants = stored), (item.stored = true)
    if (c['minecraft:damage'] !== undefined) item.damage = num(c['minecraft:damage'])
    if (c['minecraft:max_damage'] !== undefined) item.maxDamage = num(c['minecraft:max_damage'])
    item.unbreakable = c['minecraft:unbreakable'] !== undefined
    item.lore = arr(c['minecraft:lore']).map(textOf).filter(Boolean)
    const pc = c['minecraft:potion_contents']
    item.potion = typeof pc === 'string' ? pc : isObj(pc) ? str(pc.potion) : undefined
    const cont = c['minecraft:container']
    if (Array.isArray(cont) && depth < 2) {
      item.contents = cont.filter(isObj).map((e) => parseItem(e.item, num(e.slot), depth + 1)).filter((x): x is Item => !!x)
    }
    const bundle = c['minecraft:bundle_contents']
    if (Array.isArray(bundle) && depth < 2) {
      item.contents = bundle.map((e, i) => parseItem(e, i, depth + 1)).filter((x): x is Item => !!x)
    }
  } else if (tag) {
    const display = isObj(tag.display) ? tag.display : null
    item.name = display ? textOf(display.Name) || undefined : undefined
    item.lore = display ? arr(display.Lore).map(textOf).filter(Boolean) : []
    item.enchants = enchantList(tag.Enchantments ?? tag.ench)
    const stored = enchantList(tag.StoredEnchantments)
    if (stored.length) (item.enchants = stored), (item.stored = true)
    if (tag.Damage !== undefined) item.damage = num(tag.Damage)
    item.unbreakable = num(tag.Unbreakable) === 1
    item.potion = str(tag.Potion)
    const bet = isObj(tag.BlockEntityTag) ? tag.BlockEntityTag : null
    const items = bet ? bet.Items : tag.Items
    if (Array.isArray(items) && depth < 2) {
      item.contents = items.map((e, i) => parseItem(e, isObj(e) && e.Slot !== undefined ? num(e.Slot) : i, depth + 1)).filter((x): x is Item => !!x)
    }
  } else if (raw.Damage !== undefined) {
    // до 1.13 прочность хранилась прямо в предмете
    item.damage = num(raw.Damage)
  }
  item.maxDamage ??= maxDurability(item.id)
  return item
}

function itemList(v: unknown): Item[] {
  return arr(v)
    .map((x) => parseItem(x))
    .filter((x): x is Item => !!x)
}

// ---------- игрок ----------

const OLD_DIMS: Record<number, string> = { 0: 'minecraft:overworld', [-1]: 'minecraft:the_nether', 1: 'minecraft:the_end' }

function dimOf(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return OLD_DIMS[v] ?? `#${v}`
  return 'minecraft:overworld'
}

function posOf(v: unknown): { x: number; y: number; z: number } | undefined {
  const a = arr(v)
  if (a.length < 3) return undefined
  return { x: num(a[0]), y: num(a[1]), z: num(a[2]) }
}

const OLD_EFFECTS = [
  '', 'speed', 'slowness', 'haste', 'mining_fatigue', 'strength', 'instant_health', 'instant_damage', 'jump_boost', 'nausea',
  'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'invisibility', 'blindness', 'night_vision', 'hunger',
  'weakness', 'poison', 'wither', 'health_boost', 'absorption', 'saturation', 'glowing', 'levitation', 'luck', 'unluck',
  'slow_falling', 'conduit_power', 'dolphins_grace', 'bad_omen', 'hero_of_the_village', 'darkness'
]

export function parsePlayer(root: NbtCompound): PlayerData {
  const inv = itemList(root.Inventory)
  const armor: PlayerData['armor'] = {}
  let offhand: Item | undefined
  const main: Item[] = []
  for (const it of inv) {
    if (it.slot >= 0 && it.slot <= 35) main.push(it)
    else if (it.slot === 100) armor.feet = it
    else if (it.slot === 101) armor.legs = it
    else if (it.slot === 102) armor.chest = it
    else if (it.slot === 103) armor.head = it
    else if (it.slot === -106) offhand = it
  }
  // 1.21.5+: броня и вторая рука в отдельном поле
  if (isObj(root.equipment)) {
    const e = root.equipment
    armor.head ??= parseItem(e.head, 103) ?? undefined
    armor.chest ??= parseItem(e.chest, 102) ?? undefined
    armor.legs ??= parseItem(e.legs, 101) ?? undefined
    armor.feet ??= parseItem(e.feet, 100) ?? undefined
    offhand ??= parseItem(e.offhand, -106) ?? undefined
  }

  let maxHealth = 20
  for (const a of arr(root.attributes ?? root.Attributes)) {
    if (!isObj(a)) continue
    const name = str(a.id ?? a.Name) ?? ''
    if (/max_?health/i.test(name)) maxHealth = num(a.base ?? a.Base, 20)
  }

  const effects = arr(root.active_effects ?? root.ActiveEffects)
    .filter(isObj)
    .map((e) => ({
      id: typeof e.id === 'string' ? ns(e.id) : `minecraft:${OLD_EFFECTS[num(e.Id ?? e.id)] ?? 'unknown'}`,
      amplifier: num(e.amplifier ?? e.Amplifier),
      duration: num(e.duration ?? e.Duration)
    }))

  let spawn: PlayerData['spawn']
  if (isObj(root.respawn)) {
    const p = posOf(root.respawn.pos)
    if (p) spawn = { ...p, dimension: dimOf(root.respawn.dimension) }
  } else if (root.SpawnX !== undefined) {
    spawn = { x: num(root.SpawnX), y: num(root.SpawnY), z: num(root.SpawnZ), dimension: dimOf(root.SpawnDimension ?? 'minecraft:overworld') }
  }

  let lastDeath: PlayerData['lastDeath']
  if (isObj(root.LastDeathLocation)) {
    const p = posOf(root.LastDeathLocation.pos)
    if (p) lastDeath = { ...p, dimension: dimOf(root.LastDeathLocation.dimension) }
  }

  const bukkit = isObj(root.bukkit) ? root.bukkit : null
  const paper = isObj(root.Paper) ? root.Paper : null
  const pos = posOf(root.Pos)

  return {
    dataVersion: root.DataVersion !== undefined ? num(root.DataVersion) : undefined,
    health: num(root.Health, 20),
    maxHealth,
    absorption: num(root.AbsorptionAmount),
    food: num(root.foodLevel, 20),
    saturation: num(root.foodSaturationLevel),
    xpLevel: num(root.XpLevel),
    xpProgress: num(root.XpP),
    xpTotal: num(root.XpTotal),
    score: num(root.Score),
    gameMode: root.playerGameType !== undefined ? num(root.playerGameType) : undefined,
    pos: pos ? [pos.x, pos.y, pos.z] : undefined,
    dimension: dimOf(root.Dimension),
    flying: isObj(root.abilities) ? num(root.abilities.flying) === 1 : false,
    selectedSlot: num(root.SelectedItemSlot),
    inventory: main,
    armor,
    offhand,
    ender: itemList(root.EnderItems),
    effects,
    spawn,
    lastDeath,
    lastPlayed: num(paper?.LastSeen ?? bukkit?.lastPlayed, 0) || undefined,
    firstPlayed: num(bukkit?.firstPlayed, 0) || undefined,
    lastKnownName: str(bukkit?.lastKnownName)
  }
}

export function parseStats(json: string | null): PlayerStats {
  if (!json) return {}
  try {
    const s = JSON.parse(json).stats ?? {}
    const custom: Record<string, number> = s['minecraft:custom'] ?? {}
    const sum = (o: Record<string, number> | undefined) => (o ? Object.values(o).reduce((a, b) => a + b, 0) : undefined)
    const distance = Object.entries(custom)
      .filter(([k]) => k.endsWith('_one_cm'))
      .reduce((a, [, v]) => a + v, 0)
    return {
      playTicks: custom['minecraft:play_time'] ?? custom['minecraft:play_one_minute'],
      deaths: custom['minecraft:deaths'],
      mobKills: custom['minecraft:mob_kills'],
      playerKills: custom['minecraft:player_kills'],
      jumps: custom['minecraft:jump'],
      distanceCm: distance || undefined,
      blocksMined: sum(s['minecraft:mined']),
      itemsCrafted: sum(s['minecraft:crafted']),
      damageDealt: custom['minecraft:damage_dealt']
    }
  } catch {
    return {}
  }
}

/** Количество полученных достижений (без рецептов) */
export function parseAdvancements(json: string | null): number | undefined {
  if (!json) return undefined
  try {
    const o = JSON.parse(json) as Record<string, any>
    return Object.entries(o).filter(([k, v]) => !k.includes(':recipes/') && v && v.done === true).length
  } catch {
    return undefined
  }
}

// ---------- переводы ----------

export const DIM_NAMES: Record<string, string> = {
  'minecraft:overworld': 'Верхний мир',
  'minecraft:the_nether': 'Незер',
  'minecraft:the_end': 'Энд'
}
export const dimName = (d: string) => DIM_NAMES[d] ?? prettyId(d)

export const GAMEMODES = ['Выживание', 'Творческий', 'Приключение', 'Наблюдатель']
export const GAMEMODE_IDS = ['survival', 'creative', 'adventure', 'spectator']

const ENCHANTS: Record<string, string> = {
  protection: 'Защита', fire_protection: 'Огнеупорность', feather_falling: 'Невесомость', blast_protection: 'Взрывоустойчивость',
  projectile_protection: 'Защита от снарядов', respiration: 'Подводное дыхание', aqua_affinity: 'Подводник', thorns: 'Шипы',
  depth_strider: 'Подводная ходьба', frost_walker: 'Ледоход', binding_curse: 'Проклятие несъёмности', soul_speed: 'Скорость души',
  swift_sneak: 'Проворство', sharpness: 'Острота', smite: 'Небесная кара', bane_of_arthropods: 'Бич членистоногих',
  knockback: 'Отдача', fire_aspect: 'Заговор огня', looting: 'Добыча', sweeping: 'Разящий клинок', sweeping_edge: 'Разящий клинок',
  efficiency: 'Эффективность', silk_touch: 'Шёлковое касание', unbreaking: 'Прочность', fortune: 'Удача', power: 'Сила',
  punch: 'Откидывание', flame: 'Горящая стрела', infinity: 'Бесконечность', luck_of_the_sea: 'Морская удача', lure: 'Приманка',
  loyalty: 'Верность', impaling: 'Пронзатель', riptide: 'Тягун', channeling: 'Громовержец', multishot: 'Тройной выстрел',
  quick_charge: 'Быстрая перезарядка', piercing: 'Пронзающая стрела', mending: 'Починка', vanishing_curse: 'Проклятие утраты',
  density: 'Плотность', breach: 'Пробитие', wind_burst: 'Порыв ветра'
}
const SINGLE_LEVEL = new Set(['silk_touch', 'mending', 'infinity', 'flame', 'aqua_affinity', 'channeling', 'multishot', 'binding_curse', 'vanishing_curse'])
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

export function enchantName(id: string, lvl: number) {
  const s = shortId(id)
  const name = ENCHANTS[s] ?? prettyId(s)
  if (SINGLE_LEVEL.has(s) && lvl === 1) return name
  return `${name} ${ROMAN[lvl] ?? lvl}`
}
export const isCurse = (id: string) => id.endsWith('_curse')

const EFFECTS: Record<string, string> = {
  speed: 'Скорость', slowness: 'Замедление', haste: 'Спешка', mining_fatigue: 'Усталость', strength: 'Сила',
  instant_health: 'Исцеление', instant_damage: 'Моментальный урон', jump_boost: 'Прыгучесть', nausea: 'Тошнота',
  regeneration: 'Регенерация', resistance: 'Сопротивление', fire_resistance: 'Огнестойкость', water_breathing: 'Подводное дыхание',
  invisibility: 'Невидимость', blindness: 'Слепота', night_vision: 'Ночное зрение', hunger: 'Голод', weakness: 'Слабость',
  poison: 'Отравление', wither: 'Иссушение', health_boost: 'Прилив здоровья', absorption: 'Поглощение', saturation: 'Насыщение',
  glowing: 'Свечение', levitation: 'Левитация', luck: 'Удача', unluck: 'Невезение', slow_falling: 'Плавное падение',
  conduit_power: 'Сила источника', dolphins_grace: 'Грация дельфина', bad_omen: 'Дурное знамение',
  hero_of_the_village: 'Герой деревни', darkness: 'Тьма', trial_omen: 'Знамение испытания', raid_omen: 'Знамение рейда',
  wind_charged: 'Заряд ветра', weaving: 'Плетение', oozing: 'Слизистость', infested: 'Заражение'
}
export const effectName = (id: string, amp: number) => `${EFFECTS[shortId(id)] ?? prettyId(id)}${amp > 0 ? ' ' + (ROMAN[amp + 1] ?? amp + 1) : ''}`

/** Тики → «1:23» или «∞» */
export function ticksToClock(t: number) {
  if (t < 0 || t > 20 * 60 * 60 * 24) return '∞'
  const s = Math.floor(t / 20)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Тики игрового времени → «12 ч 5 мин» */
export function ticksToDuration(t: number) {
  const m = Math.floor(t / 20 / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d} д ${h % 24} ч`
  if (h > 0) return `${h} ч ${m % 60} мин`
  return `${m} мин`
}
