import { app, ipcMain } from 'electron'

/**
 * Main-process localisation: a tiny dictionary for strings only the main process shows (window titles, native
 * dialog titles). Dialog *filters* are translated by the renderer. The renderer reports its language through
 * `window.brushwork.setLanguage()` (IPC `i18n:set`); before that / when unknown we use the OS locale.
 * `BW_LANG=ru|en` forces a language (self-tests run in English).
 */
export type Lang = 'en' | 'ru'

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    'window.title': 'WinCreative',
    'window.projector': 'WinCreative - projected canvas',
    'dialog.save': 'Save',
    'dialog.open': 'Open',
    'dialog.pickFolder': 'Choose a folder',
    'dialog.allFiles': 'All files'
  },
  ru: {
    'window.title': 'WinCreative',
    'window.projector': 'WinCreative - проекция холста',
    'dialog.save': 'Сохранить',
    'dialog.open': 'Открыть',
    'dialog.pickFolder': 'Выберите папку',
    'dialog.allFiles': 'Все файлы'
  }
}

const norm = (s: string | undefined | null): Lang | null => (!s ? null : s.toLowerCase().startsWith('ru') ? 'ru' : s.toLowerCase().startsWith('en') ? 'en' : null)

/** Language forced by the environment (BW_LANG) or, for self-tests, English. */
export function forcedLang(): Lang | null {
  const f = norm(process.env.BW_LANG)
  if (f) return f
  return Object.keys(process.env).some((k) => /^BW_.*(TEST|MULTI)/.test(k)) ? 'en' : null
}

let current: Lang | null = null

export const getLang = (): Lang => forcedLang() ?? current ?? norm(app.getLocale()) ?? 'en'
/** Translate a main-process key. */
export const mt = (key: string): string => DICT[getLang()][key] ?? DICT.en[key] ?? key

export function registerI18nIpc(): void {
  ipcMain.handle('i18n:set', (_e, lang: string) => {
    current = norm(lang)
  })
}
