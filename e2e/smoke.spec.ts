import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { E2E_JIRA_TITLE, E2E_ORIGIN, E2E_TOKEN } from './support/env';

// v0 smoke on the real server and fixtures/projects (ADR 0028). Fixture titles are scrubbed, so
// rows are found through their ticket group. Work fixtures: tickets ACME-608 and ACME-623,
// two Scratch sessions, one S1 Ops session (fixtures/hac-cli); Personal: two sessions outside a repo.

const rows = (scope: Page | Locator) => scope.getByTestId('session-row');
const group = (page: Page, key: string) => page.getByTestId('group').filter({ hasText: key });

test('v0 smoke: filter, search, bookmark, delete + undo, Personal, English', async ({
  browser,
}) => {
  // Starts in Traditional Chinese, as the default for this user, and switches at the end.
  const ctx = await browser.newContext({ locale: 'zh-TW' });
  const page = await ctx.newPage();
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);

  await test.step('open /work with the fixtures', async () => {
    await expect(page.getByRole('link', { name: /工作/ })).toHaveAttribute('aria-current', 'page');
    await expect(rows(page)).toHaveCount(5);
  });

  await test.step('filter Ticket + To do', async () => {
    await page.getByRole('button', { name: /^Ticket/ }).click();
    await page.getByRole('button', { name: /^未完成/ }).click();
    await expect(page.getByTestId('group')).toHaveCount(2);
    await expect(rows(page)).toHaveCount(2);
    // The Scratch group is filtered out.
    await expect(page.getByTestId('group').filter({ hasText: 'Scratch' })).toHaveCount(0);
  });

  const search = page.getByRole('searchbox', { name: '搜尋 session' });
  const ticket = group(page, 'ACME-608');
  const row = rows(ticket);

  await test.step('search a key', async () => {
    await search.fill('acme-608');
    await expect(page.getByTestId('group')).toHaveCount(1);
    await expect(row).toHaveCount(1);
  });

  await test.step('bookmark, with the one-time note, and it survives a reload', async () => {
    const bookmark = row.getByRole('button', { name: '參考留存' });
    await expect(bookmark).toHaveAttribute('aria-pressed', 'false');
    await bookmark.click();
    await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: '參考留存只會避開' })).toBeVisible();

    await page.reload();
    await search.fill('ACME-608');
    await expect(row.getByRole('button', { name: '參考留存' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  await test.step('delete + undo', async () => {
    await row.getByRole('button', { name: '刪除' }).click();
    await expect(page.getByTestId('group')).toHaveCount(0);
    await page.getByRole('button', { name: '復原' }).click();
    await expect(row).toHaveCount(1);
    // Status and bookmark came back with the files.
    await expect(row.getByRole('button', { name: '參考留存' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  await test.step('switch to /personal', async () => {
    await search.fill('');
    await page.getByRole('link', { name: /個人/ }).click();
    await expect(page).toHaveURL(`${E2E_ORIGIN}/personal?t=${E2E_TOKEN}`);
    await expect(page.getByText('個人專案 - 以repo分組')).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
  });

  await test.step('switch to English', async () => {
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: /Personal/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('Personal projects - grouped by repo')).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
  });

  await ctx.close();
});

test('Clean up: the modal previews per workspace and Cancel leaves the list alone', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en' });
  const page = await ctx.newPage();
  for (const [path, root] of [
    ['work', '~/y'],
    ['personal', '~/o'],
  ] as const) {
    await page.goto(`${E2E_ORIGIN}/${path}?t=${E2E_TOKEN}`);
    await expect(rows(page).first()).toBeVisible();
    const before = await rows(page).count();
    await page.getByRole('button', { name: 'Clean up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clean up old sessions' });
    await expect(dialog.getByText(`Only ${root} sessions are affected.`)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '2 weeks' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Fixture dates are fixed, so what matches depends on today: check the parts agree instead.
    await dialog.getByRole('checkbox', { name: 'Keep To do sessions' }).click();
    await expect(dialog.getByText(/Bookmarked kept: \d+ · To do kept: 0/)).toBeVisible();
    const items = await dialog.getByRole('listitem').count();
    const confirm = dialog.getByRole('button', { name: /^Delete \d+ session/ });
    await expect(confirm).toHaveText(`Delete ${items} session(s)`);
    await expect(confirm).toBeEnabled({ enabled: items > 0 });
    await page.screenshot({ path: `e2e/screenshots/en-cleanup-${path}.png` });

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clean up' })).toBeFocused();
    await expect(rows(page)).toHaveCount(before);
  }
  await ctx.close();
});

test('a refused token shows the new-link banner and stops retrying (ADR 0032)', async ({
  page,
}) => {
  let streams = 0;
  page.on('request', (r) => void (r.url().endsWith('/api/events') && streams++));
  await page.goto(`${E2E_ORIGIN}/work?t=rotated-away`);
  const banner = page.getByRole('alert').filter({ hasText: 'open the new link' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('open "$(cat ~/.claude-dashboard/url)"');
  await expect(page.getByText(/Couldn't load sessions|無法載入/)).toHaveCount(0);
  await page.locator('.page').screenshot({ path: 'e2e/screenshots/access-lost.png' });
  // Backoff would have retried after 1 s and 2 s by now.
  await page.waitForTimeout(3500);
  expect(streams).toBeLessThanOrEqual(1);
});

test('Ops: [S1] group from hac calls; the row menu sets a release label', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const ops = page.getByTestId('group').filter({ hasText: '[S1]' });
  await expect(ops).toContainText('Cloud environment debug · no ticket');
  await expect(rows(ops).first()).toContainText('[S1]');

  await rows(ops).first().getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  // The menu is fixed to the viewport and can hang below the group: crop to both.
  const [a, b] = [await ops.boundingBox(), await page.getByRole('menu').boundingBox()];
  const top = Math.min(a!.y, b!.y);
  await page.screenshot({
    path: 'e2e/screenshots/en-ops-menu.png',
    clip: {
      x: a!.x,
      y: top,
      width: a!.width,
      height: Math.max(a!.y + a!.height, b!.y + b!.height) - top + 8,
    },
  });
  await page.getByRole('menuitem', { name: 'Set release label' }).click();
  await page.getByRole('textbox', { name: 'Set release label' }).fill('2026.10 go-live');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(ops).toContainText('[S1]2026.10 go-live');
  await expect(ops).toContainText('Release debug');
  await ops.screenshot({ path: 'e2e/screenshots/en-ops-release.png' });

  await rows(ops).first().getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Set environment' }).click();
  const envSelect = page.getByRole('combobox', { name: 'Set environment' });
  await expect(envSelect.locator('option', { hasText: '[P1] acme (production)' })).toHaveCount(1);
  await envSelect.selectOption('acme/p1');
  await page.getByRole('button', { name: 'Save' }).click();
  const prod = page.getByTestId('group').filter({ hasText: '[P1]' });
  await expect(prod.locator('.env-tag').first()).toHaveAttribute('data-prod', 'true');
  await prod.screenshot({ path: 'e2e/screenshots/en-ops-prod.png' });
  await ctx.close();
});

test('Jira titles: in the ticket group heading and found by search', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en' });
  const page = await ctx.newPage();
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const ticket = group(page, 'ACME-608');
  await expect(ticket.getByRole('button').first()).toContainText(`ACME-608${E2E_JIRA_TITLE}`);
  // The fake Jira has no title for ACME-623: its heading is the key alone.
  await expect(group(page, 'ACME-623')).not.toContainText(E2E_JIRA_TITLE);
  await page.getByRole('searchbox', { name: 'Search sessions' }).fill('preorder and gift');
  await expect(page.getByTestId('group')).toHaveCount(1);
  await expect(ticket).toHaveCount(1);
  await ticket.screenshot({ path: 'e2e/screenshots/en-jira-title.png' });
  // No login note when the lookup worked.
  await expect(page.getByText('Jira login needed')).toHaveCount(0);
  await ctx.close();
});

test('Rename: ⋯ → Rename saves in place; search finds the new title and the old one', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const ticket = group(page, 'ACME-623');
  const row = rows(ticket).first();
  const title = row.locator('.row__title');
  const oldTitle = (await title.textContent())!.trim();

  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = row.getByRole('textbox', { name: 'Session title' });
  await expect(input).toBeFocused();
  await expect(row).toContainText(`Leave empty to restore "${oldTitle}".`);
  await page.keyboard.type('E2E renamed checkout');
  await ticket.screenshot({ path: 'e2e/screenshots/en-rename.png' });
  await page.keyboard.press('Enter');
  await expect(title).toHaveText('E2E renamed checkout');
  await expect(row.getByRole('button', { name: 'More actions' })).toBeFocused();

  // The rename is in state.json: it survives a reload.
  await page.reload();
  await expect(title).toHaveText('E2E renamed checkout');

  const search = page.getByRole('searchbox', { name: 'Search sessions' });
  for (const q of ['renamed checkout', oldTitle]) {
    await search.fill(q);
    await expect(page.getByTestId('group')).toHaveCount(1);
    await expect(rows(ticket)).toHaveCount(1);
    await expect(rows(ticket).first().locator('.row__title')).toHaveText('E2E renamed checkout');
  }
  await ctx.close();
});

test('New session for this ticket: the name form starts the fake launcher with the edited name', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bodies: (string | null)[] = [];
  page.on('request', (r) => r.url().endsWith('/new-session') && bodies.push(r.postData()));
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const ticket = group(page, 'ACME-608');
  const button = ticket.getByRole('button', { name: 'New session for this ticket' });

  await test.step('pre-filled with the key and cached Jira title, selected', async () => {
    await button.click();
    const input = page.getByRole('textbox', { name: 'Session name' });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue(`ACME-608 ${E2E_JIRA_TITLE}`);
    expect(
      await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([0, `ACME-608 ${E2E_JIRA_TITLE}`.length]);
    await page.screenshot({ path: 'e2e/screenshots/en-new-session-name.png' });
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(bodies).toEqual([]);
  });

  await test.step('Enter starts it with the edited name; the form closes', async () => {
    await button.click();
    await expect(page.getByRole('textbox', { name: 'Session name' })).toBeFocused();
    // Collapses the selection to its end (End does not move the caret on macOS).
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type(` it's "e2e" $(x) 🚀`);
    const res = page.waitForResponse((r) => r.url().endsWith('/new-session'));
    await page.keyboard.press('Enter');
    expect((await res).status()).toBe(200);
    expect(bodies.map((b) => JSON.parse(b!))).toEqual([
      { name: `ACME-608 ${E2E_JIRA_TITLE} it's "e2e" $(x) 🚀` },
    ]);
    await expect(page.getByRole('textbox', { name: 'Session name' })).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
  await ctx.close();
});

test('Jira login note: shown in the header after an auth failure; retry asks again', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en' });
  const page = await ctx.newPage();
  const authFailed = {
    titles: {},
    lastRun: { at: new Date().toISOString(), ok: false, reason: 'auth' },
  };
  await page.route('**/api/jira/titles', (r) => r.fulfill({ json: authFailed }));
  let retried = 0;
  let synced = 0;
  await page.route(
    '**/api/jira/titles/refresh',
    (r) => (retried++, r.fulfill({ json: authFailed })),
  );
  // The retry syncs the inbox too (ADR 0043).
  await page.route('**/api/jira/inbox/sync', (r) => (synced++, r.continue()));
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const note = page
    .getByRole('status')
    .filter({ hasText: 'Jira login needed — run claude and /mcp' });
  await expect(note).toBeVisible();
  await page.locator('header').screenshot({ path: 'e2e/screenshots/en-jira-login.png' });
  await note.getByRole('button', { name: 'Sync Jira again' }).click();
  await expect.poll(() => retried).toBe(1);
  await expect.poll(() => synced).toBe(1);
  // Personal has no Jira: no note there.
  await page.getByRole('link', { name: /Personal/ }).click();
  await expect(note).toHaveCount(0);
  await ctx.close();
});

test('Jira sync status: the Sync button runs a sync and the header says when', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en' });
  const page = await ctx.newPage();
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const header = page.locator('header');
  // The fake Jira has an empty inbox; on a weekday the start-up sync may already have run.
  await header.getByRole('button', { name: 'Sync Jira now' }).click();
  await expect(header).toContainText('Jira synced just now');
  await header.screenshot({ path: 'e2e/screenshots/en-jira-synced.png' });
  await page.getByRole('link', { name: /Personal/ }).click();
  await expect(header.getByRole('button', { name: 'Sync Jira now' })).toHaveCount(0);
  await ctx.close();
});

test('Jira sync error: the note keeps the age of the results shown, with the reason', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en' });
  const page = await ctx.newPage();
  const now = Date.now();
  await page.route('**/api/jira/inbox', (r) =>
    r.fulfill({
      json: {
        result: { syncedAt: new Date(now - 2 * 3600_000).toISOString(), items: [] },
        lastAttempt: { at: new Date(now - 60_000).toISOString(), ok: false, reason: 'invalid' },
        jiraBaseUrl: null,
      },
    }),
  );
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const note = page.getByRole('status').filter({ hasText: 'Jira sync failed' });
  await expect(note).toHaveText('Jira sync failed · showing results from 2h ago');
  await expect(note).toHaveAttribute('title', "Claude's answer did not match the expected format");
  await expect(note.getByRole('button', { name: 'Sync Jira now' })).toBeVisible();
  await page.locator('header').screenshot({ path: 'e2e/screenshots/en-jira-sync-error.png' });
  await ctx.close();
});

test('Needs you inbox: actions, keyboard, FYI, matched against the prototype', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: 'en', viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const item = (key: string, over: object) => ({
    key,
    title: 'Order filters in member center',
    status: 'To Do',
    assignee: 'Anna Yang',
    bucket: 'action',
    kind: 'assigned',
    reason: 'Assigned to you, not started yet',
    lastRelevantAt: ago(2),
    ...over,
  });
  await page.route('**/api/jira/inbox', (r) =>
    r.fulfill({
      json: {
        result: {
          syncedAt: ago(0.05),
          items: [
            item('FA-561', {}),
            // ACME-608 has a fixture session, so it offers Resume.
            item('ACME-608', {
              title: 'PDP stock sync',
              kind: 'mention',
              reason: 'PM asked after your last comment',
              lastRelevantAt: ago(20),
            }),
            item('ACME-615', { bucket: 'fyi', reason: 'S1 test results cc’d to you; done' }),
          ],
        },
        lastAttempt: { at: ago(0.05), ok: true },
        jiraBaseUrl: 'https://example.atlassian.net',
      },
    }),
  );
  const posts: string[] = [];
  page.on('request', (req) => req.method() === 'POST' && posts.push(new URL(req.url()).pathname));
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);

  const inbox = page.getByRole('complementary', { name: 'Needs you' });
  const items = inbox.getByRole('list', { name: 'Needs you' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).getByRole('button', { name: 'New session' })).toBeVisible();
  await expect(items.nth(1).getByRole('button', { name: 'Resume session' })).toBeVisible();
  await expect(items.nth(0).getByRole('link', { name: 'Open in Jira' })).toHaveAttribute(
    'href',
    'https://example.atlassian.net/browse/FA-561',
  );
  const fyi = inbox.getByRole('button', { name: 'FYI · 1 need no action from you' });
  await expect(fyi).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => document.fonts.ready);
  const appShot = await inbox.screenshot();

  await test.step('arrow keys + Enter resume the ticket session', async () => {
    await items.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => posts.filter((p) => /\/api\/sessions\/.+\/resume$/.test(p)))
      .toHaveLength(1);
    expect(posts.some((p) => p.includes('new-session'))).toBe(false);
  });

  await test.step('FYI expands', async () => {
    await fyi.click();
    await expect(fyi).toHaveAttribute('aria-expanded', 'true');
    await expect(inbox).toContainText('S1 test results cc’d to you; done');
  });

  // Prototype and app columns side by side for review.
  const proto = await ctx.newPage();
  await proto.goto(pathToFileURL(resolve('docs/prototype', 'Main-en.dc.html')).href);
  await proto.locator('aside').waitFor();
  await proto.evaluate(() => document.fonts.ready);
  const protoShot = await proto.locator('aside').screenshot();
  const sheet = await ctx.newPage();
  await sheet.setContent(`
    <body style="margin:0;font:13px system-ui;background:#fff;display:flex;gap:16px;align-items:flex-start">
      <div><p style="margin:8px">Prototype</p><img src="data:image/png;base64,${protoShot.toString('base64')}"></div>
      <div><p style="margin:8px">App</p><img src="data:image/png;base64,${appShot.toString('base64')}"></div>
    </body>`);
  await sheet.screenshot({ path: 'e2e/screenshots/en-inbox.png', fullPage: true });
  await ctx.close();
});
