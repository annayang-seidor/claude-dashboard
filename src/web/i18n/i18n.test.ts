import { describe, expect, it } from 'vitest';
import { detectLang, format, MESSAGES, splitTemplate } from './core';

/** Flatten to path → value; arrays keep their index in the path. */
function flatten(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === 'string') return out.set(prefix, node);
  for (const [k, v] of Object.entries(node as object)) {
    for (const [p, s] of flatten(v, prefix ? `${prefix}.${k}` : k)) out.set(p, s);
  }
  return out;
}

const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('string tables', () => {
  const en = flatten(MESSAGES.en);
  const zh = flatten(MESSAGES['zh-TW']);

  it('have the same keys', () => {
    expect([...zh.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it('use the same placeholders for each key', () => {
    for (const [key, text] of en) expect(slots(zh.get(key)!), key).toEqual(slots(text));
  });

  it('have no empty strings', () => {
    for (const [key, text] of [...en, ...zh]) expect(text.trim(), key).not.toBe('');
  });
});

describe('detectLang', () => {
  it('prefers a stored choice', () => {
    expect(detectLang('en', ['zh-TW'])).toBe('en');
    expect(detectLang('zh-TW', ['en-US'])).toBe('zh-TW');
  });

  it('ignores an invalid stored value', () => {
    expect(detectLang('fr', ['zh-TW'])).toBe('zh-TW');
  });

  it('maps any Chinese browser language to zh-TW', () => {
    expect(detectLang(null, ['zh-Hant-TW'])).toBe('zh-TW');
    expect(detectLang(null, ['zh-CN'])).toBe('zh-TW');
  });

  it('uses the first language it knows, else English', () => {
    expect(detectLang(null, ['fr-FR', 'zh-TW', 'en'])).toBe('zh-TW');
    expect(detectLang(null, ['ja-JP'])).toBe('en');
    expect(detectLang(null, [])).toBe('en');
  });
});

describe('format', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('Deleted {n} session(s)', { n: 3 })).toBe('Deleted 3 session(s)');
    expect(format('Hi {name}')).toBe('Hi {name}');
  });

  it('splits around slots for rich text', () => {
    expect(splitTemplate('本專案由 {name} 用愛與token發電')).toEqual([
      '本專案由 ',
      { slot: 'name' },
      ' 用愛與token發電',
    ]);
  });
});
