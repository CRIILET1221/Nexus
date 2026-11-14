import { useCallback, useEffect, useState } from 'react'
import {
  Ban, Box, Copy, Crown, Download, Eraser, Footprints, Heart, Info, LogOut, MapPin, Package, RefreshCw, ShieldCheck, ShieldOff,
  Skull, Sparkles, Swords, Timer, Trophy, User, Utensils
} from 'lucide-react'
import { api } from '../api'
import type { ServerAdapter } from '../adapter'
import { errText } from '../adapter'
import { Modal, useAction, useToast } from '../components/ui'
import { formatDate } from '../util'
import { ItemIcon, useTextures } from '../mc/icons'
import {
  GAMEMODE_IDS, GAMEMODES, dimName, modOf, effectName, enchantName, isCurse, prettyId, ticksToClock, ticksToDuration, textOf,
  type Item
} from '../mc/player'
import { loadProfile, type PlayerProfile as Profile } from '../mc/world'

export interface ProfileTarget {
  uuid: string
  name?: string
  online: boolean
  /** время изменения файла игрока */
  mtime?: number
}

interface Flags {
  op: boolean
  banned: boolean
  whitelisted: boolean
}

export function PlayerProfileModal(props: {
  adapter: ServerAdapter
  world: string
  target: ProfileTarget
  flags: Flags
  onClose: () => void
  /** после команды — обновить списки на странице */
  onChanged: () => void
}) {
  const ad = props.adapter
  const run = useAction()
  const toast = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'inv' | 'ender' | 'stats'>('inv')
  const [tip, setTip] = useState<{ item: Item; x: number; y: number } | null>(null)

  const name = profile?.name ?? props.target.name
  const can = ad.canCommand

  const load = useCallback(
    async (save: boolean) => {
      setLoading(true)
      try {
        if (save && props.target.online && ad.canCommand) {
          // игроки онлайн пишутся на диск только при сохранении мира
          await ad.command('save-all')
          await new Promise((r) => setTimeout(r, 2200))
        }
        setProfile(await loadProfile(ad, props.world, props.target.uuid, props.target.name))
        setError(null)
      } catch (e) {
        setError(errText(e))
      } finally {
        setLoading(false)
      }
    },
    [ad, props.world, props.target]
  )

  useEffect(() => {
    load(false)
  }, [load])

  const cmd = async (c: string, ok: string) => {
    const r = await run(() => ad.command(c).then(() => true), ok)
    if (r) setTimeout(props.onChanged, 1500)
    return r
  }

  const clearInventory = async () => {
    if (!name) return
    const yes = await api.dialog.confirm({
      title: 'Очистить инвентарь',
      message: `Удалить все предметы из инвентаря ${name}?`,
      detail: 'Это необратимо: предметы пропадут насовсем. Эндер-сундук не затрагивается.',
      ok: 'Очистить',
      danger: true
    })
    if (yes && (await cmd(`clear ${name}`, `Инвентарь ${name} очищен`))) setTimeout(() => load(true), 300)
  }

  const d = profile?.data
  const showTip = (item: Item | undefined) => (e: React.MouseEvent) => item && setTip({ item, x: e.clientX, y: e.clientY })
  const slot = (item: Item | undefined, extra?: { selected?: boolean; placeholder?: string }) => (
    <div
      className={`slot${extra?.selected ? ' sel' : ''}`}
      onMouseEnter={showTip(item)}
      onMouseMove={showTip(item)}
      onMouseLeave={() => setTip(null)}
    >
      {item ? (
        <>
          <ItemIcon id={item.id} />
          {item.count > 1 && <span className="cnt">{item.count}</span>}
          {item.enchants.length > 0 && <span className="glint" />}
          {item.damage !== undefined && item.maxDamage && item.damage > 0 && <Durability item={item} />}
        </>
      ) : (
        extra?.placeholder && <span className="ph">{extra.placeholder}</span>
      )}
    </div>
  )
  const at = (list: Item[], s: number) => list.find((i) => i.slot === s)

  return (
    <Modal
      size="wide"
      icon={<User size={18} />}
      title={name ?? 'Игрок'}
      onClose={props.onClose}
    >
      <div className="modal-body player-modal">
        {/* шапка */}
        <div className="pp-head">
          <PlayerBody name={name} />
          <div className="pp-info">
            <div className="pp-name">
              {name ?? <span className="muted">Имя неизвестно</span>}
              {props.target.online ? <span className="badge green">онлайн</span> : <span className="badge">офлайн</span>}
              {props.flags.op && <span className="badge warn">OP</span>}
              {props.flags.banned && <span className="badge red">забанен</span>}
              {props.flags.whitelisted && <span className="badge blue">в белом списке</span>}
            </div>
            <div className="pp-uuid mono">
              {props.target.uuid}
              <button
                className="btn ghost sm icon"
                title="Копировать UUID"
                onClick={() => navigator.clipboard.writeText(props.target.uuid).then(() => toast('UUID скопирован', 'success'))}
              >
                <Copy size={12} />
              </button>
            </div>
            {d && (
              <div className="pp-sub muted">
                {d.gameMode !== undefined && <>Режим: {GAMEMODES[d.gameMode] ?? d.gameMode} · </>}
                {d.lastPlayed ? <>Последний вход: {formatDate(d.lastPlayed)}</> : props.target.mtime ? <>Данные сохранены: {formatDate(props.target.mtime)}</> : null}
                {d.firstPlayed ? <> · Впервые: {formatDate(d.firstPlayed)}</> : null}
              </div>
            )}
            {name && (
              <div className="pp-actions">
                <select
                  className="select"
                  style={{ height: 30, width: 150, fontSize: 12.5 }}
                  disabled={!can}
                  value=""
                  onChange={(e) => e.target.value && cmd(`gamemode ${e.target.value} ${name}`, `Режим игры изменён: ${name}`).then(() => load(true))}
                >
                  <option value="">Режим игры…</option>
                  {GAMEMODE_IDS.map((g, i) => (
                    <option key={g} value={g}>
                      {GAMEMODES[i]}
                    </option>
                  ))}
                </select>
                {props.flags.op ? (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`deop ${name}`, `${name} больше не оператор`)}>
                    <ShieldOff size={13} /> Снять OP
                  </button>
                ) : (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`op ${name}`, `${name} теперь оператор`)}>
                    <Crown size={13} /> Назначить OP
                  </button>
                )}
                {props.target.online && (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`kick ${name}`, `${name} кикнут`)}>
                    <LogOut size={13} /> Кикнуть
                  </button>
                )}
                {props.flags.banned ? (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`pardon ${name}`, `${name} разбанен`)}>
                    <ShieldCheck size={13} /> Разбанить
                  </button>
                ) : (
                  <button className="btn sm danger" disabled={!can} onClick={() => cmd(`ban ${name}`, `${name} забанен`)}>
                    <Ban size={13} /> Забанить
                  </button>
                )}
                <button className="btn sm danger" disabled={!can} onClick={clearInventory} title="Команда clear">
                  <Eraser size={13} /> Очистить инвентарь
                </button>
              </div>
            )}
          </div>
        </div>

        {!can && (
          <div className="callout warn" style={{ margin: '4px 0 12px' }}>
            <Info size={16} />
            <span>{ad.commandHint ?? 'Сервер не запущен — действия недоступны, но данные игрока можно смотреть.'}</span>
          </div>
        )}

        {loading && !profile ? (
          <div className="empty-row" style={{ padding: 40, textAlign: 'center' }}>
            <span className="spinner" style={{ display: 'inline-block', verticalAlign: -3 }} /> Читаю данные игрока…
          </div>
        ) : error && !profile ? (
          <div className="callout danger">
            <Info size={16} />
            <span>{error}</span>
          </div>
        ) : d ? (
          <>
            {/* жизненные показатели */}
            <div className="pp-vitals">
              <Vital icon={<Heart size={14} />} cls="hp" label="Здоровье" value={d.health} max={d.maxHealth} text={`${round1(d.health)} / ${d.maxHealth}${d.absorption ? ` +${round1(d.absorption)}` : ''}`} />
              <Vital icon={<Utensils size={14} />} cls="food" label="Сытость" value={d.food} max={20} text={`${d.food} / 20`} />
              <Vital icon={<Sparkles size={14} />} cls="xp" label={`Уровень ${d.xpLevel}`} value={d.xpProgress} max={1} text={`${Math.round(d.xpProgress * 100)}%`} />
            </div>

            <div className="pp-bar">
              <div className="subtabs" style={{ margin: 0 }}>
                <button className={tab === 'inv' ? 'on' : ''} onClick={() => setTab('inv')}>
                  <Package size={14} /> Инвентарь
                </button>
                <button className={tab === 'ender' ? 'on' : ''} onClick={() => setTab('ender')}>
                  <Box size={14} /> Эндер-сундук <span className="badge">{d.ender.length}</span>
                </button>
                <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
                  <Trophy size={14} /> Статистика
                </button>
              </div>
              <div className="spacer" />
              <button
                className="btn sm ghost"
                disabled={loading}
                onClick={() => load(true)}
                title={props.target.online && can ? 'Сохранить мир (save-all) и перечитать' : 'Перечитать файл'}
              >
                {loading ? <span className="spinner" /> : <RefreshCw size={13} />} Обновить
              </button>
            </div>

            {tab === 'inv' && (
              <div className="pp-inv">
                <div className="inv-armor">
                  {slot(d.armor.head, { placeholder: 'Шлем' })}
                  {slot(d.armor.chest, { placeholder: 'Нагр.' })}
                  {slot(d.armor.legs, { placeholder: 'Пон.' })}
                  {slot(d.armor.feet, { placeholder: 'Бот.' })}
                  <div className="inv-gap" />
                  {slot(d.offhand, { placeholder: 'Л. рука' })}
                </div>
                <div className="inv-main">
                  <div className="inv-grid">{Array.from({ length: 27 }, (_, i) => <div key={i}>{slot(at(d.inventory, i + 9))}</div>)}</div>
                  <div className="inv-grid hotbar">
                    {Array.from({ length: 9 }, (_, i) => (
                      <div key={i}>{slot(at(d.inventory, i), { selected: i === d.selectedSlot })}</div>
                    ))}
                  </div>
                </div>
                <div className="pp-side">
                  <InfoLine icon={<MapPin size={14} />} title="Позиция">
                    {d.pos ? (
                      <>
                        <span className="mono">
                          {Math.floor(d.pos[0])} {Math.floor(d.pos[1])} {Math.floor(d.pos[2])}
                        </span>
                        <span className="muted">{dimName(d.dimension)}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </InfoLine>
                  <InfoLine icon={<Footprints size={14} />} title="Точка возрождения">
                    {d.spawn ? (
                      <>
                        <span className="mono">
                          {d.spawn.x} {d.spawn.y} {d.spawn.z}
                        </span>
                        <span className="muted">{dimName(d.spawn.dimension)}</span>
                      </>
                    ) : (
                      <span className="muted">спавн мира</span>
                    )}
                  </InfoLine>
                  {d.lastDeath && (
                    <InfoLine icon={<Skull size={14} />} title="Последняя смерть">
                      <span className="mono">
                        {d.lastDeath.x} {d.lastDeath.y} {d.lastDeath.z}
                      </span>
                      <span className="muted">{dimName(d.lastDeath.dimension)}</span>
                    </InfoLine>
                  )}
                  <InfoLine icon={<Sparkles size={14} />} title="Эффекты">
                    {d.effects.length === 0 ? (
                      <span className="muted">нет</span>
                    ) : (
                      d.effects.map((e) => (
                        <span key={e.id} className="pp-effect">
                          {effectName(e.id, e.amplifier)} <span className="muted mono">{ticksToClock(e.duration)}</span>
                        </span>
                      ))
                    )}
                  </InfoLine>
                </div>
              </div>
            )}

            {tab === 'ender' && (
              <div className="pp-inv">
                <div className="inv-main">
                  <div className="inv-grid ender">{Array.from({ length: 27 }, (_, i) => <div key={i}>{slot(at(d.ender, i))}</div>)}</div>
                </div>
              </div>
            )}

            {tab === 'stats' && <StatsView profile={profile!} />}

            <div className="pp-foot muted">
              Данные читаются из файлов мира «{props.world}».{' '}
              {props.target.online
                ? can
                  ? 'Для игроков онлайн «Обновить» сначала сохраняет мир, чтобы показать актуальный инвентарь.'
                  : 'У игроков онлайн файл обновляется при автосохранении (обычно раз в 5 минут).'
                : 'Показано состояние на момент выхода игрока.'}
            </div>
            <TextureBanner />
          </>
        ) : null}
      </div>
      {tip && <ItemTooltip item={tip.item} x={tip.x} y={tip.y} />}
    </Modal>
  )
}

const round1 = (n: number) => Math.round(n * 10) / 10

function PlayerBody({ name }: { name?: string }) {
  const [err, setErr] = useState(false)
  if (!name || err || !/^\w{2,16}$/.test(name)) {
    return (
      <div className="pp-body fallback">
        <User size={40} />
      </div>
    )
  }
  return <img className="pp-body" src={`https://mc-heads.net/body/${encodeURIComponent(name)}/110`} alt="" onError={() => setErr(true)} />
}

function Vital(props: { icon: React.ReactNode; cls: string; label: string; value: number; max: number; text: string }) {
  const pct = Math.max(0, Math.min(100, (props.value / (props.max || 1)) * 100))
  return (
    <div className={`vital ${props.cls}`}>
      <div className="vital-top">
        {props.icon}
        <span>{props.label}</span>
        <b>{props.text}</b>
      </div>
      <div className="vital-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function InfoLine(props: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="info-line">
      <div className="t">
        {props.icon} {props.title}
      </div>
      <div className="v">{props.children}</div>
    </div>
  )
}

function Durability({ item }: { item: Item }) {
  const left = 1 - (item.damage ?? 0) / (item.maxDamage ?? 1)
  return (
    <span className="dur">
      <span style={{ width: `${Math.max(0, left) * 100}%`, background: `hsl(${Math.max(0, left) * 120} 80% 50%)` }} />
    </span>
  )
}

function ItemTooltip({ item, x, y }: { item: Item; x: number; y: number }) {
  // держим подсказку в пределах окна
  const w = 300
  const left = x + 16 + w > window.innerWidth ? x - w - 12 : x + 16
  const top = Math.min(y + 12, window.innerHeight - 40)
  return (
    <div className="mc-tip" style={{ left, top, maxWidth: w }}>
      <div className={`n${item.name ? ' custom' : ''}${item.enchants.length ? ' ench' : ''}`}>{item.name ?? prettyId(item.id)}</div>
      {item.enchants.map((e) => (
        <div key={e.id} className={isCurse(e.id) ? 'curse' : 'gray'}>
          {enchantName(e.id, e.lvl)}
        </div>
      ))}
      {item.potion && <div className="blue">Зелье: {prettyId(item.potion)}</div>}
      {item.lore.map((l, i) => (
        <div key={i} className="lore">
          {textOf(l)}
        </div>
      ))}
      {item.contents && item.contents.length > 0 && (
        <div className="tip-contents">
          {item.contents.slice(0, 27).map((c, i) => (
            <span key={i} className="tc">
              <ItemIcon id={c.id} size={22} />
              {c.count > 1 && <i>{c.count}</i>}
            </span>
          ))}
        </div>
      )}
      {item.unbreakable && <div className="blue">Неразрушимый</div>}
      {item.maxDamage && item.damage !== undefined && (
        <div className="white">
          Прочность: {item.maxDamage - item.damage} / {item.maxDamage}
        </div>
      )}
      {modOf(item.id) && <div className="mod">{prettyId(modOf(item.id)!)}</div>}
      <div className="id">
        {item.id}
        {item.count > 1 ? ` × ${item.count}` : ''}
      </div>
    </div>
  )
}

function StatsView({ profile }: { profile: Profile }) {
  const s = profile.stats
  const d = profile.data
  const km = s.distanceCm !== undefined ? (s.distanceCm / 100_000).toFixed(1) + ' км' : '—'
  const v = (n?: number) => (n === undefined ? '—' : n.toLocaleString('ru-RU'))
  const cards: [React.ReactNode, string, string][] = [
    [<Timer size={15} />, 'Время в игре', s.playTicks !== undefined ? ticksToDuration(s.playTicks) : '—'],
    [<Skull size={15} />, 'Смертей', v(s.deaths)],
    [<Swords size={15} />, 'Убито мобов', v(s.mobKills)],
    [<Swords size={15} />, 'Убито игроков', v(s.playerKills)],
    [<Footprints size={15} />, 'Пройдено', km],
    [<Package size={15} />, 'Добыто блоков', v(s.blocksMined)],
    [<Package size={15} />, 'Создано предметов', v(s.itemsCrafted)],
    [<Trophy size={15} />, 'Достижений', v(profile.advancements)],
    [<Sparkles size={15} />, 'Опыт всего', v(d.xpTotal)],
    [<Heart size={15} />, 'Счёт', v(d.score)]
  ]
  return (
    <div className="pp-stats">
      {cards.map(([icon, k, val]) => (
        <div className="card stat" key={k}>
          <div className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {icon} {k}
          </div>
          <div className="v">{val}</div>
        </div>
      ))}
    </div>
  )
}

/** Предложение скачать текстуры для иконок предметов */
function TextureBanner() {
  const { status, refresh } = useTextures()
  const run = useAction()
  const [prog, setProg] = useState<{ stage: string; done: number; total: number } | null>(null)
  if (!status || status.installed) return null
  const install = async () => {
    const id = Math.random().toString(36).slice(2)
    const off = api.on('textures:progress', (p: any) => p.id === id && setProg(p))
    try {
      await run(() => api.textures.install(id), 'Иконки предметов установлены')
      await refresh()
    } finally {
      off()
      setProg(null)
    }
  }
  return (
    <div className="callout" style={{ marginTop: 12, alignItems: 'center' }}>
      <Download size={16} />
      <span style={{ flex: 1 }}>
        {prog ? (
          <>
            {prog.stage}
            {prog.total > 0 && ` ${Math.round((prog.done / prog.total) * 100)}%`}
          </>
        ) : (
          <>Сейчас предметы показаны буквами. Можно один раз скачать официальный клиент Minecraft (~30 МБ с серверов Mojang) — из него возьмутся настоящие иконки.</>
        )}
      </span>
      <button className="btn sm primary" disabled={!!prog} onClick={install}>
        {prog ? <span className="spinner" /> : <Download size={13} />} Скачать иконки
      </button>
    </div>
  )
}
