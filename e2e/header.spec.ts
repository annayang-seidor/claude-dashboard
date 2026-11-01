import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHOTS = 'e2e/screenshots';
const LANG_KEY = 'claude-dashboard.lang';
const WIDTHS = [1440, 880];
// Each case pairs an app route with its prototype page in docs/prototype/.
const CASES = [
  { lang: 'en', workspace: 'work', file: 'Main-en.dc.html' },
  { lang: 'en', workspace: 'personal', file: 'Personal-en.dc.html' },
  { lang: 'zh-TW', workspace: 'work', file: 'Main.dc.html' },
  { lang: 'zh-TW', workspace: 'personal', file: 'Personal.dc.html' },
] as const;

async function openApp(page: Page, path: string, lang?: string) {
  if (lang) await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [LANG_KEY, lang]);
  await page.goto(`${path}?t=test-token`);
  await page.locator('header').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

test.describe('header matches the prototype', () => {
  mkdirSync(SHOTS, { recursive: true });

  for (const width of WIDTHS) {
    for (const { lang, workspace, file } of CASES) {
      const name = `${lang}-${workspace}-${width}`;
      test(name, async ({ browser }) => {
        const viewport = { width, height: 900 };

        const proto = await browser.newPage({ viewport });
        await proto.goto(pathToFileURL(resolve('docs/prototype', file)).href);
        await proto.locator('header').waitFor();
        await proto.evaluate(() => document.fonts.ready);
        const protoShot = await proto.locator('header').screenshot();

        const app = await browser.newPage({ viewport });
        await openApp(app, `/${workspace}`, lang);
        const appShot = await app.locator('header').screenshot();

        // Stack the two header crops into one image for review.
        const sheet = await browser.newPage({ viewport: { width, height: 400 } });
        await sheet.setContent(`
          <body style="margin:0;font:13px system-ui;background:#fff">
            <p style="margin:8px">Prototype — ${name}</p>
            <img src="data:image/png;base64,${protoShot.toString('base64')}" style="display:block">
            <p style="margin:8px">App — ${name}</p>
            <img src="data:image/png;base64,${appShot.toString('base64')}" style="display:block">
          </body>`);
        await sheet.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
      });
    }
  }
});

test('every button has an accessible name and a tooltip when it has no text', async ({ page }) => {
  await openApp(page, '/work', 'en');
  const buttons = page.locator('button');
  for (let i = 0; i < (await buttons.count()); i++) {
    const b = buttons.nth(i);
    if ((await b.innerText()).trim() === '') {
      await expect(b).toHaveAttribute('aria-label', /.+/);
      await expect(b).toHaveAttribute('title', /.+/);
    }
  }
  for (const label of ['中文（台灣）', 'English']) {
    const b = page.getByRole('button', { name: label });
    await expect(b).toHaveAttribute('title', label);
  }
});

test('keyboard focus is visible on every header control', async ({ page }) => {
  await openApp(page, '/work', 'en');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const seen: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      // The search input shows its ring on the surrounding box (:focus-within).
      const target = el.id === 'q' ? el.closest('.search')! : el;
      const s = getComputedStyle(target);
      return {
        label: el.getAttribute('aria-label') ?? el.textContent ?? el.id,
        style: s.outlineStyle,
        width: s.outlineWidth,
      };
    });
    expect(ring.style, `focus ring on ${ring.label}`).not.toBe('none');
    expect(ring.width).toBe('2px');
    seen.push(ring.label);
  }
  await page.keyboard.press('Shift+Tab');
  await page.locator('header').screenshot({ path: `${SHOTS}/focus-ring.png` });
  expect(seen).toHaveLength(5);
});

test('⌘K / Ctrl+K and / focus the search box', async ({ page }) => {
  await openApp(page, '/work', 'en');
  const search = page.getByRole('searchbox', { name: 'Search sessions' });
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');
  await search.blur();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(search).toBeFocused();
  // '/' typed inside the field is text, not a shortcut.
  await page.keyboard.type('a/b');
  await expect(search).toHaveValue('a/b');
});

test('tabs switch routes and keep the token', async ({ page }) => {
  await openApp(page, '/', 'en');
  await expect(page).toHaveURL(/\/work\?t=test-token$/);
  await page.getByRole('link', { name: /Personal/ }).click();
  await expect(page).toHaveURL(/\/personal\?t=test-token$/);
  await expect(page.getByRole('link', { name: /Personal/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page).toHaveTitle('Personal sessions');
  await page.goBack();
  await expect(page).toHaveURL(/\/work\?t=test-token$/);
});

test('language follows the browser, and a choice survives reload', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'zh-TW' });
  const page = await ctx.newPage();
  await openApp(page, '/work');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.getByRole('link', { name: /工作/ })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('link', { name: /Work/ })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await ctx.close();
});
