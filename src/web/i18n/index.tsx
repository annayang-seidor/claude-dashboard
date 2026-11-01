import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  detectLang,
  format,
  HTML_LANG,
  LANG_STORAGE_KEY,
  lookup,
  MESSAGES,
  splitTemplate,
  type Lang,
  type MessageKey,
  type Messages,
  type Vars,
} from './core';

export { LANGS, HTML_LANG } from './core';
export type { Lang, MessageKey } from './core';

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translated string with {name} placeholders filled. */
  t: (key: MessageKey, vars?: Vars) => string;
  /** Like t, but slots may be React nodes (word order differs between languages). */
  tRich: (key: MessageKey, nodes: Record<string, ReactNode>) => ReactNode;
  messages: Messages;
}

const I18nContext = createContext<I18n | null>(null);

// localStorage can throw (privacy mode, blocked storage); the choice is a convenience only.
function readStored(): string | null {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() =>
    detectLang(readStored(), navigator.languages ?? [navigator.language]),
  );

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    writeStored(next);
    setLangState(next);
  }, []);

  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => format(lookup(lang, key), vars),
      tRich: (key, nodes) =>
        splitTemplate(lookup(lang, key)).map((part, i) => (
          <Fragment key={i}>{typeof part === 'string' ? part : nodes[part.slot]}</Fragment>
        )),
      messages: MESSAGES[lang],
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
