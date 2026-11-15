// Переводы интерфейса. Ключ — исходный русский текст, словари en/uk переводят его.
// Подстановки: tr('Удалить «{0}»?', name) → {0}, {1}… заменяются аргументами.
import en from './locales/en.json'
import uk from './locales/uk.json'

export type Lang = 'ru' | 'en' | 'uk'

export const LANGS: { id: Lang; name: string; short: string }[] = [
  { id: 'en', name: 'English', short: 'EN' },
  { id: 'uk', name: 'Українська', short: 'UK' },
  { id: 'ru', name: 'Русский', short: 'RU' }
]

const DICTS: Record<Lang, Record<string, string> | null> = {
  ru: null,
  en: en as Record<string, string>,
  uk: uk as Record<string, string>
}

/** Язык по локали системы: украинский, русский (и белорусский), иначе английский */
export function detectLang(locale: string | undefined): Lang {
  const l = (locale ?? '').toLowerCase()
  if (l.startsWith('uk')) return 'uk'
  if (l.startsWith('ru') || l.startsWith('be')) return 'ru'
  return 'en'
}

let current: Lang = 'ru'

export function setLang(lang: Lang) {
  current = DICTS[lang] !== undefined ? lang : 'ru'
}

export function getLang(): Lang {
  return current
}

/** Локаль для дат и чисел */
export function dateLocale(): string {
  return current === 'en' ? 'en-GB' : current === 'uk' ? 'uk-UA' : 'ru-RU'
}

export function tr(text: string, ...args: unknown[]): string {
  const dict = DICTS[current]
  let s = (dict && dict[text]) || text
  if (args.length) s = s.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m))
  return s
}

/** «Не найдено» на любом из языков интерфейса и в ответах SFTP */
export const NOT_FOUND_RE = /no such file|not exist|not found|ENOENT|не найден|не знайден/i
