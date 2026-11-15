// Выбор языка — до загрузки остальных модулей (часть подписей создаётся при импорте).
import { detectLang, setLang, type Lang } from '@shared/i18n'
import { api } from './api'

const KEY = 'nexus.lang'

function saved(): Lang | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'ru' || v === 'en' || v === 'uk' ? v : null
  } catch {
    return null
  }
}

export const initialLang: Lang = saved() ?? detectLang(navigator.language)
setLang(initialLang)
api.app.setLang(initialLang).catch(() => undefined)

/** Смена языка: сохраняем и перезагружаем интерфейс (подключения в main-процессе сохраняются) */
export function changeLang(lang: Lang, view?: unknown) {
  try {
    localStorage.setItem(KEY, lang)
    if (view) sessionStorage.setItem('nexus.view', JSON.stringify(view))
  } catch {
    /* без сохранения */
  }
  api.app
    .setLang(lang)
    .catch(() => undefined)
    .finally(() => location.reload())
}
