import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import fr from './locales/fr.json';
import es from './locales/es.json';
import de from './locales/de.json';
import ptBR from './locales/pt-BR.json';

/**
 * i18n setup. English is the pivot locale: its dictionary is the source of
 * truth for the key set (see `I18nKeys` below - a missing or unknown key is a
 * TypeScript error, not a runtime "topbar.export" leaking into the UI).
 *
 * The five dictionaries are bundled statically (~3 kB gzip each): lazy-loading
 * them would cost a flash of untranslated UI on first paint for no real gain.
 *
 * Outside React (exporter, presets, probe, ...) import the default export and
 * call `i18n.t(...)` directly - see `t()` re-exported below.
 */

export const LOCALES = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  'pt-BR': 'Português (BR)',
} as const;

export type Locale = keyof typeof LOCALES;

export const STORAGE_KEY = 'selfcut.lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      fr: { translation: fr },
      es: { translation: es },
      de: { translation: de },
      'pt-BR': { translation: ptBR },
    },
    supportedLngs: Object.keys(LOCALES),
    fallbackLng: {
      // A browser reporting plain "pt" gets the Brazilian dictionary rather
      // than falling straight through to English.
      pt: ['pt-BR', 'en'],
      default: ['en'],
    },
    // "fr-CA" / "de-AT" resolve to "fr" / "de" instead of the fallback.
    nonExplicitSupportedLngs: true,
    // Keys are flat, dots and colons included: "inspector.bold" (Bold) and
    // "inspector.bold.short" (B) must coexist, which nesting cannot express.
    keySeparator: false,
    nsSeparator: false,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      caches: ['localStorage'],
    },
    interpolation: {
      // React already escapes everything it renders.
      escapeValue: false,
    },
  });

/** Keep the document in sync so screen readers and hyphenation follow the UI. */
function syncDocumentLang(lng: string): void {
  document.documentElement.lang = lng;
}
syncDocumentLang(i18n.resolvedLanguage ?? 'en');
i18n.on('languageChanged', syncDocumentLang);

/** Imperative translator, for the modules that have no access to hooks. */
export const t = i18n.t.bind(i18n);

export default i18n;
