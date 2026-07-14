import 'i18next';
import type en from './locales/en.json';

/**
 * Makes the English dictionary the typed key set: `t('topbar.nope')` fails to
 * compile, and every locale file is checked against it by `npm run i18n:check`.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
