import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Contact, Crown, Gamepad2, Info, ListChecks, LogOut, RefreshCw, Search, ShieldCheck, ShieldOff, UserPlus, Users, Wifi } from 'lucide-react'
import { dashedUuid, listPlayers, worldName, type KnownPlayer } from '../mc/world'
import { PlayerProfileModal, type ProfileTarget } from './PlayerProfile'
import type { PingResult } from '@shared/types'
import type { ServerAdapter } from '../adapter'
import { errText } from '../adapter'
import { useAction } from '../components/ui'
import { formatDate } from '../util'

interface Entry {
  name: string
  uuid?: string
  extra?: string
  created?: string
}

function parseList(text: string | null, kind: 'ops' | 'whitelist' | 'bans' | 'ipbans'): Entry[] {
  if (!text) return []
  try {
    const arr = JSON.parse(text) as any[]
    return arr.map((x) => ({
      name: kind === 'ipbans' ? x.ip : x.name,
      uuid: x.uuid,
      extra: kind === 'ops' ? `уровень ${x.level ?? 4}` : kind === 'bans' || kind === 'ipbans' ? x.reason : undefined,
      created: x.created
    }))
  } catch {
    return []
  }
}

function Head({ name }: { name: string }) {
  const [err, setErr] = useState(false)
  if (err || !/^\w{2,16}$/.test(name)) return <div className="head-img">{name.slice(0, 1).toUpperCase()}</div>
  return <img className="head-img" src={`https://mc-heads.net/avatar/${encodeURIComponent(name)}/30`} alt="" onError={() => setErr(true)} />
}

export function PlayersView(props: { adapter: ServerAdapter; visible: boolean }) {
  const ad = props.adapter
  const run = useAction()
  const [ping, setPing] = useState<PingResult | null>(null)
  const [pingError, setPingError] = useState<string | null>(null)
  const [lists, setLists] = useState<{ ops: Entry[]; whitelist: Entry[]; bans: Entry[]; ipbans: Entry[]; whitelistOn: boolean | null }>({
    ops: [], whitelist: [], bans: [], ipbans: [], whitelistOn: null
  })
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [world, setWorld] = useState('world')
  const [known, setKnown] = useState<KnownPlayer[] | null | undefined>(undefined)
  const [knownError, setKnownError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [profile, setProfile] = useState<ProfileTarget | null>(null)

  const loadKnown = useCallback(async () => {
    try {
      const w = await worldName(ad)
      setWorld(w)
      setKnown(await listPlayers(ad, w))
      setKnownError(null)
    } catch (e) {
      setKnownError(errText(e))
    }
  }, [ad])

  const loadPing = useCallback(async () => {
    try {
      setPing(await ad.ping())
      setPingError(null)
    } catch (e) {
      setPing(null)
      setPingError(errText(e))
    }
  }, [ad])

  const loadLists = useCallback(async () => {
    setLoading(true)
    const [ops, wl, bans, ipb, props] = await Promise.all(
      ['ops.json', 'whitelist.json', 'banned-players.json', 'banned-ips.json', 'server.properties'].map((f) => ad.readFile(f).catch(() => null))
    )
    const wlOn = props ? /^white-list\s*=\s*true/m.test(props) : null
    setLists({
      ops: parseList(ops, 'ops'),
      whitelist: parseList(wl, 'whitelist'),
      bans: parseList(bans, 'bans'),
      ipbans: parseList(ipb, 'ipbans'),
      whitelistOn: wlOn
    })
    setLoading(false)
  }, [ad])

  useEffect(() => {
    if (!props.visible) return
    loadPing()
    loadLists()
    loadKnown()
    const t = setInterval(loadPing, 15000)
    return () => clearInterval(t)
  }, [props.visible, loadPing, loadLists, loadKnown])

  const cmd = async (c: string, ok?: string) => {
    await run(() => ad.command(c), ok)
    // сервер обновляет json-файлы с небольшой задержкой
    setTimeout(() => {
      loadLists()
      loadPing()
    }, 1500)
  }

  const nick = name.trim()
  const validNick = /^[A-Za-z0-9_]{2,16}$/.test(nick)
  const can = ad.canCommand
  const opNames = new Set(lists.ops.map((o) => o.name.toLowerCase()))
  const banNames = new Set(lists.bans.map((o) => o.name.toLowerCase()))
  const wlNames = new Set(lists.whitelist.map((o) => o.name.toLowerCase()))
  const onlineIds = new Set((ping?.players ?? []).map((p) => dashedUuid(p.id)))

  const flagsOf = (n?: string) => {
    const l = (n ?? '').toLowerCase()
    return { op: opNames.has(l), banned: banNames.has(l), whitelisted: wlNames.has(l) }
  }

  const visibleKnown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!known) return []
    return q ? known.filter((k) => (k.name ?? '').toLowerCase().includes(q) || k.uuid.includes(q)) : known
  }, [known, filter])

  /** профиль по нику: ищем UUID среди известных игроков */
  const profileByNick = () => {
    const k = known?.find((x) => x.name?.toLowerCase() === nick.toLowerCase())
    if (k) setProfile({ uuid: k.uuid, name: k.name, online: onlineIds.has(k.uuid), mtime: k.mtime })
  }
  const nickKnown = !!known?.some((x) => x.name?.toLowerCase() === nick.toLowerCase())

  return (
    <div className="view">
      <div className="view-narrow">
        {!can && (
          <div className="callout warn" style={{ marginBottom: 16 }}>
            <Info size={16} />
            <span>{ad.commandHint ?? 'Сервер не запущен — действия с игроками станут доступны после запуска.'}</span>
          </div>
        )}

        <div className="cards-4">
          <div className="card stat">
            <div className="k">Онлайн</div>
            <div className="big-num">
              {ping ? ping.online : '—'}
              <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>
                {ping ? ` / ${ping.max}` : ''}
              </span>
            </div>
          </div>
          <div className="card stat">
            <div className="k">Версия</div>
            <div className="v" style={{ fontSize: 13.5 }}>{ping?.version || '—'}</div>
          </div>
          <div className="card stat">
            <div className="k">Пинг</div>
            <div className="v">{ping ? `${ping.latency} мс` : '—'}</div>
          </div>
          <div className="card stat">
            <div className="k">Белый список</div>
            <div className="v">
              {lists.whitelistOn === null ? '—' : lists.whitelistOn ? <span className="badge green">включён</span> : <span className="badge">выключен</span>}
              <button
                className="btn ghost sm"
                disabled={!can || lists.whitelistOn === null}
                onClick={() => cmd(lists.whitelistOn ? 'whitelist off' : 'whitelist on', lists.whitelistOn ? 'Белый список выключен' : 'Белый список включён')}
              >
                {lists.whitelistOn ? 'Выкл.' : 'Вкл.'}
              </button>
            </div>
          </div>
        </div>

        {/* Онлайн */}
        <div className="section-title">
          <Wifi size={16} /> Сейчас на сервере
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => (loadPing(), loadLists())}>
            <RefreshCw size={13} /> Обновить
          </button>
        </div>
        <div className="rows" style={{ marginBottom: 22 }}>
          {pingError ? (
            <div className="empty-row">{pingError}</div>
          ) : !ping ? (
            <div className="empty-row">
              <span className="spinner" style={{ display: 'inline-block', verticalAlign: -3 }} /> Опрос сервера…
            </div>
          ) : ping.online === 0 ? (
            <div className="empty-row">Никого нет</div>
          ) : ping.players.length === 0 ? (
            <div className="empty-row">Сервер скрывает список игроков ({ping.online} онлайн). Полный список — команда «list» в консоли.</div>
          ) : (
            ping.players.map((p) => (
              <div className="r" key={p.id || p.name}>
                <Head name={p.name} />
                <div className="main">
                  <b>
                    {p.name} {opNames.has(p.name.toLowerCase()) && <span className="badge warn" style={{ marginLeft: 6 }}>OP</span>}
                  </b>
                  <span className="mono" title={p.id}>
                    {p.id.slice(0, 8)}…
                  </span>
                </div>
                <div className="acts">
                  <button
                    className="btn sm"
                    onClick={() => {
                      const uuid = dashedUuid(p.id)
                      setProfile({ uuid, name: p.name, online: true, mtime: known?.find((k) => k.uuid === uuid)?.mtime })
                    }}
                  >
                    <Contact size={13} /> Профиль
                  </button>
                  <select
                    className="select"
                    style={{ height: 28, width: 140, fontSize: 12.5 }}
                    disabled={!can}
                    value=""
                    onChange={(e) => e.target.value && cmd(`gamemode ${e.target.value} ${p.name}`, `Режим игры изменён: ${p.name}`)}
                  >
                    <option value="">Режим игры…</option>
                    <option value="survival">Выживание</option>
                    <option value="creative">Творческий</option>
                    <option value="adventure">Приключение</option>
                    <option value="spectator">Наблюдатель</option>
                  </select>
                  {opNames.has(p.name.toLowerCase()) ? (
                    <button className="btn sm" disabled={!can} onClick={() => cmd(`deop ${p.name}`, `${p.name} больше не оператор`)}>
                      <ShieldOff size={13} /> De-OP
                    </button>
                  ) : (
                    <button className="btn sm" disabled={!can} onClick={() => cmd(`op ${p.name}`, `${p.name} теперь оператор`)}>
                      <Crown size={13} /> OP
                    </button>
                  )}
                  <button className="btn sm" disabled={!can} onClick={() => cmd(`kick ${p.name}`, `${p.name} кикнут`)}>
                    <LogOut size={13} /> Кик
                  </button>
                  <button className="btn sm danger" disabled={!can} onClick={() => cmd(`ban ${p.name}`, `${p.name} забанен`)}>
                    <Ban size={13} /> Бан
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Все, кто заходил */}
        <div className="section-title">
          <Users size={16} /> Все игроки
          {known && <span className="badge">{known.length}</span>}
          <div className="spacer" />
          <div className="input-icon" style={{ width: 250 }}>
            <Search size={14} />
            <input className="input" style={{ height: 30 }} placeholder="Поиск по нику или UUID" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
        <div className="rows" style={{ marginBottom: 22, maxHeight: 420, overflow: 'auto' }}>
          {knownError ? (
            <div className="empty-row">{knownError}</div>
          ) : known === undefined ? (
            <div className="empty-row">Загрузка…</div>
          ) : known === null ? (
            <div className="empty-row">Папка «{world}/playerdata» не найдена — на сервер ещё никто не заходил.</div>
          ) : visibleKnown.length === 0 ? (
            <div className="empty-row">{filter ? 'Никого не найдено' : 'Пока никто не заходил'}</div>
          ) : (
            visibleKnown.slice(0, 300).map((k) => {
              const f = flagsOf(k.name)
              const online = onlineIds.has(k.uuid)
              return (
                <div className="r click" key={k.uuid} onClick={() => setProfile({ uuid: k.uuid, name: k.name, online, mtime: k.mtime })}>
                  <Head name={k.name ?? '?'} />
                  <div className="main">
                    <b>
                      {k.name ?? <span className="muted">имя неизвестно</span>}
                      {online && <span className="badge green" style={{ marginLeft: 6 }}>онлайн</span>}
                      {f.op && <span className="badge warn" style={{ marginLeft: 6 }}>OP</span>}
                      {f.banned && <span className="badge red" style={{ marginLeft: 6 }}>бан</span>}
                    </b>
                    <span>{k.mtime ? `данные от ${formatDate(k.mtime)}` : k.uuid}</span>
                  </div>
                  <div className="acts">
                    <button className="btn sm ghost">
                      <Contact size={13} /> Профиль
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Действие по нику */}
        <div className="section-title">
          <UserPlus size={16} /> Игрок по нику
        </div>
        <div className="card" style={{ padding: 14, marginBottom: 22 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="input" style={{ width: 240 }} placeholder="Ник игрока" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={!nickKnown} onClick={profileByNick} title={nickKnown ? '' : 'Игрок с таким ником ещё не заходил'}>
              <Contact size={14} /> Профиль
            </button>
            <button className="btn" disabled={!can || !validNick} onClick={() => cmd(`whitelist add ${nick}`, `${nick} добавлен в белый список`)}>
              <ListChecks size={14} /> В белый список
            </button>
            <button className="btn" disabled={!can || !validNick} onClick={() => cmd(`op ${nick}`, `${nick} теперь оператор`)}>
              <Crown size={14} /> Сделать OP
            </button>
            <button className="btn" disabled={!can || !validNick} onClick={() => cmd(`pardon ${nick}`, `${nick} разбанен`)}>
              <ShieldCheck size={14} /> Разбанить
            </button>
            <button className="btn danger" disabled={!can || !validNick} onClick={() => cmd(`ban ${nick}`, `${nick} забанен`)}>
              <Ban size={14} /> Забанить
            </button>
          </div>
          {nick && !validNick && <div className="hint muted" style={{ marginTop: 8, fontSize: 12 }}>Ник: 2–16 символов, латиница, цифры и «_»</div>}
        </div>

        <div className="grid-2" style={{ alignItems: 'start' }}>
          <ListBlock
            title="Операторы"
            icon={<Crown size={15} />}
            items={lists.ops}
            loading={loading}
            empty="Нет операторов"
            action={(e) => (
              <button className="btn sm" disabled={!can} onClick={() => cmd(`deop ${e.name}`, `${e.name} больше не оператор`)}>
                Снять
              </button>
            )}
          />
          <ListBlock
            title="Белый список"
            icon={<ListChecks size={15} />}
            items={lists.whitelist}
            loading={loading}
            empty="Список пуст"
            action={(e) => (
              <button className="btn sm" disabled={!can} onClick={() => cmd(`whitelist remove ${e.name}`, `${e.name} убран из белого списка`)}>
                Убрать
              </button>
            )}
          />
          <ListBlock
            title="Забаненные игроки"
            icon={<Ban size={15} />}
            items={lists.bans}
            loading={loading}
            empty="Банов нет"
            action={(e) => (
              <button className="btn sm" disabled={!can} onClick={() => cmd(`pardon ${e.name}`, `${e.name} разбанен`)}>
                Разбанить
              </button>
            )}
          />
          <ListBlock
            title="Баны по IP"
            icon={<Gamepad2 size={15} />}
            items={lists.ipbans}
            loading={loading}
            empty="Банов по IP нет"
            mono
            action={(e) => (
              <button className="btn sm" disabled={!can} onClick={() => cmd(`pardon-ip ${e.name}`, `IP ${e.name} разбанен`)}>
                Разбанить
              </button>
            )}
          />
        </div>
      </div>
      {profile && (
        <PlayerProfileModal
          adapter={ad}
          world={world}
          target={profile}
          flags={flagsOf(profile.name)}
          onClose={() => setProfile(null)}
          onChanged={() => (loadLists(), loadPing())}
        />
      )}
    </div>
  )
}

function ListBlock(props: {
  title: string
  icon: React.ReactNode
  items: Entry[]
  loading: boolean
  empty: string
  mono?: boolean
  action: (e: Entry) => React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="section-title" style={{ fontSize: 14 }}>
        {props.icon} {props.title}
        <span className="badge">{props.items.length}</span>
      </div>
      <div className="rows">
        {props.items.length === 0 ? (
          <div className="empty-row">{props.loading ? 'Загрузка…' : props.empty}</div>
        ) : (
          props.items.map((e) => (
            <div className="r" key={e.uuid ?? e.name}>
              {!props.mono && <Head name={e.name} />}
              <div className="main">
                <b className={props.mono ? 'mono' : ''}>{e.name}</b>
                <span>{[e.extra, e.created ? formatDate(Date.parse(e.created)) : ''].filter(Boolean).join(' · ') || ' '}</span>
              </div>
              <div className="acts">{props.action(e)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export const PlayersIcon = Users
