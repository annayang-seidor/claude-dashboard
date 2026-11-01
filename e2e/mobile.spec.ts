import { expect, test } from '@playwright/test';
import { E2E_ORIGIN, E2E_TOKEN } from './support/env';

// Phone width (NARROW_QUERY, max-width 600px) on the fixture server (ADR 0028).
test.use({ viewport: { width: 390, height: 844 }, locale: 'en-US' });

test('phone width: full-width search, wrapped rows, no sideways scroll', async ({ page }) => {
  await page.goto(`${E2E_ORIGIN}/work?t=${E2E_TOKEN}`);
  const rows = page.getByTestId('session-row');
  await expect(rows.first()).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search sessions' });
  await expect(search).toHaveAttribute('placeholder', 'Ticket or keyword');
  await expect(page.locator('.search .kbd')).toBeHidden();
  // 16px gutters on each side.
  expect((await page.locator('.search').boundingBox())?.width).toBe(390 - 2 * 16);

  // The title and meta take their own line inside the row's 12px padding.
  const row = (await rows.first().boundingBox())!;
  const body = (await rows.first().locator('.row__body').boundingBox())!;
  expect(body.width).toBe(row.width - 2 * 12);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  await page.screenshot({ path: 'e2e/screenshots/en-mobile-work.png', fullPage: true });
});
