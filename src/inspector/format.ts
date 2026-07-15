import i18n from '../i18n';

// Slider read-outs are numbers, so they follow the locale, not the dictionary:
// "50 %" in French, "1,5 s" instead of "1.5s".
export const pct = (v: number) =>
  new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(v);
export const seconds = (ms: number) =>
  new Intl.NumberFormat(i18n.language, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ms / 1000);
