import { prefs } from '../input/prefs'
import { getLang, LangPref, onLangChange, resolveLang, setLang } from './index'

/**
 * Wire the language to the stored preference. Call once, BEFORE building any UI (main.ts).
 * - pref 'auto' follows the OS language (navigator.language); 'en' / 'ru' are explicit.
 * - `window.brushwork.bootLang` (set by main for self-tests / `BW_LANG=ru`) overrides the stored preference at start-up only.
 * - the main process is told the active language so native dialogs match (IPC `i18n:set`).
 */
export function bootI18n(): void {
  const forced = window.brushwork?.bootLang
  const wanted = (): LangPref | string => prefs.v.language
  setLang(resolveLang(forced || wanted())) // the forced language is only the start-up default: choosing one in Preferences wins
  document.documentElement.lang = getLang()
  const push = (): void => void window.brushwork?.setLanguage?.(getLang())
  push()
  onLangChange(push)
  prefs.events.on('change', (k) => {
    if (k === 'language' || k === '*') setLang(resolveLang(k === '*' ? forced || wanted() : wanted()))
  })
}
