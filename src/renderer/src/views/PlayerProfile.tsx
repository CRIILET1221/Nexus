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
import { tr, dateLocale } from '@shared/i18n'

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
      title: tr('Очистить инвентарь'),
      message: tr('Удалить все предметы из инвентаря {0}?', name),
      detail: tr('Это необратимо: предметы пропадут насовсем. Эндер-сундук не затрагивается.'),
      ok: tr('Очистить'),
      danger: true
    })
    if (yes && (await cmd(`clear ${name}`, tr('Инвентарь {0} очищен', name)))) setTimeout(() => load(true), 300)
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
      title={name ?? tr('Игрок')}
      onClose={props.onClose}
    >
      <div className="modal-body player-modal">
        {/* шапка */}
        <div className="pp-head">
          <PlayerBody name={name} />
          <div className="pp-info">
            <div className="pp-name">
              {name ?? <span className="muted">{tr('Имя неизвестно')}</span>}
              {props.target.online ? <span className="badge green">{tr('онлайн')}</span> : <span className="badge">{tr('офлайн')}</span>}
              {props.flags.op && <span className="badge warn">OP</span>}
              {props.flags.banned && <span className="badge red">{tr('забанен')}</span>}
              {props.flags.whitelisted && <span className="badge blue">{tr('в белом списке')}</span>}
            </div>
            <div className="pp-uuid mono">
              {props.target.uuid}
              <button
                className="btn ghost sm icon"
                title={tr('Копировать UUID')}
                onClick={() => navigator.clipboard.writeText(props.target.uuid).then(() => toast(tr('UUID скопирован'), 'success'))}
              >
                <Copy size={12} />
              </button>
            </div>
            {d && (
              <div className="pp-sub muted">
                {d.gameMode !== undefined && <>{tr('Режим:')}{' '}{GAMEMODES[d.gameMode] ?? d.gameMode} · </>}
                {d.lastPlayed ? <>{tr('Последний вход:')}{' '}{formatDate(d.lastPlayed)}</> : props.target.mtime ? <>{tr('Данные сохранены:')}{' '}{formatDate(props.target.mtime)}</> : null}
                {d.firstPlayed ? <>{' '}{tr('· Впервые:')}{' '}{formatDate(d.firstPlayed)}</> : null}
              </div>
            )}
            {name && (
              <div className="pp-actions">
                <select
                  className="select"
                  style={{ height: 30, width: 150, fontSize: 12.5 }}
                  disabled={!can}
                  value=""
                  onChange={(e) => e.target.value && cmd(`gamemode ${e.target.value} ${name}`, tr('Режим игры изменён: {0}', name)).then(() => load(true))}
                >
                  <option value="">{tr('Режим игры…')}</option>
                  {GAMEMODE_IDS.map((g, i) => (
                    <option key={g} value={g}>
                      {GAMEMODES[i]}
                    </option>
                  ))}
                </select>
                {props.flags.op ? (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`deop ${name}`, tr('{0} больше не оператор', name))}>
                    <ShieldOff size={13} />{' '}{tr('Снять OP')}
                  </button>
                ) : (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`op ${name}`, tr('{0} теперь оператор', name))}>
                    <Crown size={13} />{' '}{tr('Назначить OP')}
                  </button>
                )}
                {props.target.online && (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`kick ${name}`, tr('{0} кикнут', name))}>
                    <LogOut size={13} />{' '}{tr('Кикнуть')}
                  </button>
                )}
                {props.flags.banned ? (
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`pardon ${name}`, tr('{0} разбанен', name))}>
                    <ShieldCheck size={13} />{' '}{tr('Разбанить')}
                  </button>
                ) : (
                  <button className="btn sm danger" disabled={!can} onClick={() => cmd(`ban ${name}`, tr('{0} забанен', name))}>
                    <Ban size={13} />{' '}{tr('Забанить')}
                  </button>
                )}
                <button className="btn sm danger" disabled={!can} onClick={clearInventory} title={tr('Команда clear')}>
                  <Eraser size={13} />{' '}{tr('Очистить инвентарь')}
                </button>
              </div>
            )}
          </div>
        </div>

        {!can && (
          <div className="callout warn" style={{ margin: '4px 0 12px' }}>
            <Info size={16} />
            <span>{ad.commandHint ?? tr('Сервер не запущен — действия недоступны, но данные игрока можно смотреть.')}</span>
          </div>
        )}

        {loading && !profile ? (
          <div className="empty-row" style={{ padding: 40, textAlign: 'center' }}>
            <span className="spinner" style={{ display: 'inline-block', verticalAlign: -3 }} />{' '}{tr('Читаю данные игрока…')}
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
              <Vital icon={<Heart size={14} />} cls="hp" label={tr('Здоровье')} value={d.health} max={d.maxHealth} text={`${round1(d.health)} / ${d.maxHealth}${d.absorption ? ` +${round1(d.absorption)}` : ''}`} />
              <Vital icon={<Utensils size={14} />} cls="food" label={tr('Сытость')} value={d.food} max={20} text={`${d.food} / 20`} />
              <Vital icon={<Sparkles size={14} />} cls="xp" label={tr('Уровень {0}', d.xpLevel)} value={d.xpProgress} max={1} text={`${Math.round(d.xpProgress * 100)}%`} />
            </div>

            <div className="pp-bar">
              <div className="subtabs" style={{ margin: 0 }}>
                <button className={tab === 'inv' ? 'on' : ''} onClick={() => setTab('inv')}>
                  <Package size={14} />{' '}{tr('Инвентарь')}
                </button>
                <button className={tab === 'ender' ? 'on' : ''} onClick={() => setTab('ender')}>
                  <Box size={14} />{' '}{tr('Эндер-сундук')}{' '}<span className="badge">{d.ender.length}</span>
                </button>
                <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>
                  <Trophy size={14} />{' '}{tr('Статистика')}
                </button>
              </div>
              <div className="spacer" />
              <button
                className="btn sm ghost"
                disabled={loading}
                onClick={() => load(true)}
                title={props.target.online && can ? tr('Сохранить мир (save-all) и перечитать') : tr('Перечитать файл')}
              >
                {loading ? <span className="spinner" /> : <RefreshCw size={13} />}{' '}{tr('Обновить')}
              </button>
            </div>

            {tab === 'inv' && (
              <div className="pp-inv">
                <div className="inv-armor">
                  {slot(d.armor.head, { placeholder: tr('Шлем') })}
                  {slot(d.armor.chest, { placeholder: tr('Нагр.') })}
                  {slot(d.armor.legs, { placeholder: tr('Пон.') })}
                  {slot(d.armor.feet, { placeholder: tr('Бот.') })}
                  <div className="inv-gap" />
                  {slot(d.offhand, { placeholder: tr('Л. рука') })}
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
                  <InfoLine icon={<MapPin size={14} />} title={tr('Позиция')}>
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
                  <InfoLine icon={<Footprints size={14} />} title={tr('Точка возрождения')}>
                    {d.spawn ? (
                      <>
                        <span className="mono">
                          {d.spawn.x} {d.spawn.y} {d.spawn.z}
                        </span>
                        <span className="muted">{dimName(d.spawn.dimension)}</span>
                      </>
                    ) : (
                      <span className="muted">{tr('спавн мира')}</span>
                    )}
                  </InfoLine>
                  {d.lastDeath && (
                    <InfoLine icon={<Skull size={14} />} title={tr('Последняя смерть')}>
                      <span className="mono">
                        {d.lastDeath.x} {d.lastDeath.y} {d.lastDeath.z}
                      </span>
                      <span className="muted">{dimName(d.lastDeath.dimension)}</span>
                    </InfoLine>
                  )}
                  <InfoLine icon={<Sparkles size={14} />} title={tr('Эффекты')}>
                    {d.effects.length === 0 ? (
                      <span className="muted">{tr('нет')}</span>
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
              {tr('Данные читаются из файлов мира «')}{props.world}».{' '}
              {props.target.online
                ? can
                  ? tr('Для игроков онлайн «Обновить» сначала сохраняет мир, чтобы показать актуальный инвентарь.')
                  : tr('У игроков онлайн файл обновляется при автосохранении (обычно раз в 5 минут).')
                : tr('Показано состояние на момент выхода игрока.')}
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
      {item.potion && <div className="blue">{tr('Зелье:')}{' '}{prettyId(item.potion)}</div>}
      {item.lore.map((l, i) => (
        <div key={i} className="lore">
          {textOf(l)}
        </div>
      ))}
      {item.contents && item.contents.length > 0 && (
        <div className="tip-contents">
          {Array.from({ length: Math.max(9, Math.ceil((Math.max(...item.contents.map((c) => c.slot), 0) + 1) / 9) * 9) }, (_, i) => {
            const c = item.contents!.find((x) => x.slot === i)
            return (
              <span key={i} className="tc">
                {c && <ItemIcon id={c.id} size={22} />}
                {c && c.count > 1 && <i>{c.count}</i>}
              </span>
            )
          }).slice(0, 27)}
        </div>
      )}
      {item.unbreakable && <div className="blue">{tr('Неразрушимый')}</div>}
      {item.maxDamage && item.damage !== undefined && (
        <div className="white">
          {tr('Прочность:')}{' '}{item.maxDamage - item.damage} / {item.maxDamage}
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
  const km = s.distanceCm !== undefined ? (s.distanceCm / 100_000).toFixed(1) + tr(' км') : '—'
  const v = (n?: number) => (n === undefined ? '—' : n.toLocaleString(dateLocale()))
  const cards: [React.ReactNode, string, string][] = [
    [<Timer size={15} />, tr('Время в игре'), s.playTicks !== undefined ? ticksToDuration(s.playTicks) : '—'],
    [<Skull size={15} />, tr('Смертей'), v(s.deaths)],
    [<Swords size={15} />, tr('Убито мобов'), v(s.mobKills)],
    [<Swords size={15} />, tr('Убито игроков'), v(s.playerKills)],
    [<Footprints size={15} />, tr('Пройдено'), km],
    [<Package size={15} />, tr('Добыто блоков'), v(s.blocksMined)],
    [<Package size={15} />, tr('Создано предметов'), v(s.itemsCrafted)],
    [<Trophy size={15} />, tr('Достижений'), v(profile.advancements)],
    [<Sparkles size={15} />, tr('Опыт всего'), v(d.xpTotal)],
    [<Heart size={15} />, tr('Счёт'), v(d.score)]
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
      await run(() => api.textures.install(id), tr('Иконки предметов установлены'))
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
          <>{tr('Сейчас предметы показаны буквами. Можно один раз скачать официальный клиент Minecraft (~30 МБ с серверов Mojang) — из него возьмутся настоящие иконки.')}</>
        )}
      </span>
      <button className="btn sm primary" disabled={!!prog} onClick={install}>
        {prog ? <span className="spinner" /> : <Download size={13} />}{' '}{tr('Скачать иконки')}
      </button>
    </div>
  )
}
