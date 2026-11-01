import en from './en.json';
import zhTW from './zh-TW.json';

export const LANGS = ['zh-TW', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export type Messages = typeof en;
// Typing zh-TW as Messages makes a key missing from it a compile error; i18n.test.ts checks the rest.
export const MESSAGES: Record<Lang, Messages> = { 'zh-TW': zhTW, en };

/** BCP 47 tag for <html lang>; matches the prototype's zh-Hant. */
export const HTML_LANG: Record<Lang, string> = { 'zh-TW': 'zh-Hant', en: 'en' };

export const LANG_STORAGE_KEY = 'claude-dashboard.lang';

/** Dot paths of every string leaf, e.g. 'header.searchLabel'. Arrays are read from MESSAGES directly. */
type StringPaths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends readonly unknown[]
      ? never
      : StringPaths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = StringPaths<Messages>;

export type Vars = Record<string, string | number>;

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** A stored choice wins; otherwise any zh-* browser language means zh-TW, else English. */
export function detectLang(stored: string | null, browserLangs: readonly string[]): Lang {
  if (isLang(stored)) return stored;
  for (const tag of browserLangs) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-TW';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

export function lookup(lang: Lang, key: MessageKey): string {
  let node: unknown = MESSAGES[lang];
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  return node as string;
}

/** Split a template into literal text and {name} slots, in order. */
export function splitTemplate(template: string): (string | { slot: string })[] {
  return template
    .split(/(\{\w+\})/)
    .filter((part) => part !== '')
    .map((part) => (/^\{\w+\}$/.test(part) ? { slot: part.slice(1, -1) } : part));
}

export function format(template: string, vars: Vars = {}): string {
  return splitTemplate(template)
    .map((part) => (typeof part === 'string' ? part : String(vars[part.slot] ?? `{${part.slot}}`)))
    .join('');
}
