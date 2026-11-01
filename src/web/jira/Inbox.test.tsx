// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession, JiraInboxResponse } from '../../shared/api';
import type { JiraInboxItem } from '../../shared/state';
import { NOW, renderEn, session } from '../sessions/testing';
import { Inbox } from './Inbox';

afterEach(cleanup);

const BASE = 'https://example.atlassian.net';
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const item = (over: Partial<JiraInboxItem>): JiraInboxItem => ({
  key: 'FA-561',
  title: 'Order filters in member center',
  status: 'To Do',
  assignee: 'Anna Yang',
  bucket: 'action',
  kind: 'assigned',
  reason: 'Assigned to you, not started yet',
  lastRelevantAt: hoursAgo(2),
  ...over,
});

// Shaped after the prototype's inbox, listed out of order.
const mention = item({
  key: 'ACME-786',
  title: 'PDP stock sync',
  kind: 'mention',
  reason: 'PM asked after your last comment',
  lastRelevantAt: hoursAgo(20),
});
const assigned = item({});
const fyiItems = [
  item({ key: 'ACME-615', bucket: 'fyi', reason: 'S1 test results cc’d to you; done' }),
  item({ key: 'ACME-594', bucket: 'fyi', reason: 'Assigned to someone else' }),
];
const stockDone = session({ ticketKey: 'ACME-786', status: 'done', at: [10, 23, 9, 0] });
const stockTodo = session({ ticketKey: 'ACME-786', at: [10, 20, 9, 0] });

function renderInbox(
  over: Partial<JiraInboxResponse & { loaded: boolean; syncing: boolean }> = {},
  sessions: ApiSession[] | null = [stockDone, stockTodo],
) {
  const handlers = { onSync: vi.fn(), onResume: vi.fn(), onNewSession: vi.fn() };
  const inbox = {
    result: { syncedAt: hoursAgo(0.1), items: [mention, ...fyiItems, assigned] },
    lastAttempt: { at: hoursAgo(0.1), ok: true },
    jiraBaseUrl: BASE,
    loaded: true,
    syncing: false,
    ...over,
  };
  renderEn(<Inbox inbox={inbox} sessions={sessions} now={NOW} {...handlers} />);
  return handlers;
}

const items = () =>
  within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem');

describe('Inbox', () => {
  it('lists action items newest first, with the count, kind, age, key, title and reason', () => {
    renderInbox();
    const heading = screen.getByRole('heading', { name: 'Needs you' });
    expect(heading.nextElementSibling?.textContent).toContain('2');
    const [first, second] = items();
    expect(first?.textContent).toContain('Newly assigned · 2h ago');
    expect(first?.textContent).toContain('FA-561 Order filters in member center');
    expect(first?.textContent).toContain('Assigned to you, not started yet');
    expect(second?.textContent).toContain('Mentioned you · 20h ago');
    expect(second?.textContent).toContain('ACME-786 PDP stock sync');
  });

  it('offers New session with no session for the key, else Resume of the To do one', async () => {
    const h = renderInbox();
    const [first, second] = items();
    await userEvent.click(within(first!).getByRole('button', { name: 'New session' }));
    expect(h.onNewSession).toHaveBeenCalledWith('FA-561');
    expect(within(second!).queryByRole('button', { name: 'New session' })).toBeNull();
    await userEvent.click(within(second!).getByRole('button', { name: 'Resume session' }));
    expect(h.onResume).toHaveBeenCalledWith(stockTodo);
  });

  it('offers no session action until the sessions have loaded', () => {
    renderInbox({}, null);
    for (const li of items()) {
      expect(within(li).queryByRole('button', { name: /session/ })).toBeNull();
      expect(within(li).getByRole('link', { name: 'Open in Jira' })).toBeTruthy();
    }
  });

  it('links Open in Jira to the issue in a new tab', () => {
    renderInbox();
    const link = within(items()[0]!).getByRole('link', { name: 'Open in Jira' });
    expect(link?.getAttribute('href')).toBe(`${BASE}/browse/FA-561`);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('title')).toBe('Open in Jira');
  });

  it('says how to set the base URL when it is unset', () => {
    renderInbox({ jiraBaseUrl: null });
    const button = within(items()[0]!).getByRole('button', { name: 'Open in Jira' });
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.getAttribute('title')).toBe(
      'Add jiraBaseUrl to dashboard.config.json to open Jira',
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('moves through items with the arrow keys; Enter runs the primary action', async () => {
    const h = renderInbox();
    const [first, second] = items();
    expect(first?.getAttribute('tabindex')).toBe('0');
    expect(second?.getAttribute('tabindex')).toBe('-1');
    await userEvent.tab();
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    expect(second?.getAttribute('tabindex')).toBe('0');
    expect(first?.getAttribute('tabindex')).toBe('-1');
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    await userEvent.keyboard('{Enter}');
    expect(h.onResume).toHaveBeenCalledWith(stockTodo);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard('{Enter}');
    expect(h.onNewSession).toHaveBeenCalledWith('FA-561');
    await userEvent.keyboard('{End}{ArrowUp}');
    expect(document.activeElement).toBe(first);
  });

  it('moves from a button inside an item, and Enter there is only that button', async () => {
    const h = renderInbox();
    const [first, second] = items();
    within(first!).getByRole('button', { name: 'New session' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(second);
    within(second!).getByRole('link', { name: 'Open in Jira' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(h.onResume).not.toHaveBeenCalled();
    expect(h.onNewSession).not.toHaveBeenCalled();
  });

  it('keeps FYI collapsed by default with its count, and expands it on click', async () => {
    renderInbox();
    const toggle = screen.getByRole('button', { name: 'FYI · 2 need no action from you' });
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Assigned to someone else')).toBeNull();
    await userEvent.click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('ACME-594').closest('li')?.textContent).toContain(
      'Assigned to someone else',
    );
    await userEvent.click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('hides FYI when there are no FYI items', () => {
    renderInbox({ result: { syncedAt: hoursAgo(1), items: [assigned] } });
    expect(screen.queryByRole('button', { name: /FYI/ })).toBeNull();
  });

  it('says nothing needs you when the sync found no action items', () => {
    renderInbox({ result: { syncedAt: hoursAgo(1), items: fyiItems } });
    expect(screen.getByText('Nothing needs you right now')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Needs you' }).nextElementSibling?.textContent,
    ).toContain('0');
    expect(screen.getByRole('button', { name: /FYI · 2/ })).toBeTruthy();
  });

  it('says Jira has not synced yet before the first sync, without a count', () => {
    renderInbox({ result: null, lastAttempt: null });
    expect(screen.getByText(/Jira hasn't synced yet/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Needs you' }).nextElementSibling).toBeNull();
  });

  it('shows nothing below the heading until the inbox has loaded', () => {
    renderInbox({ result: null, lastAttempt: null, loaded: false });
    expect(screen.queryByText(/Jira hasn't synced yet/)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the sync error with a retry when there is no result yet', async () => {
    const h = renderInbox({
      result: null,
      lastAttempt: { at: hoursAgo(0.1), ok: false, reason: 'timeout' },
    });
    const alert = screen.getByRole('alert');
    expect(alert?.textContent).toContain("Jira sync failed, so there's nothing to show yet");
    await userEvent.click(within(alert).getByRole('button', { name: 'Sync Jira again' }));
    expect(h.onSync).toHaveBeenCalledOnce();
  });

  it('asks for the Jira login when that is why there is no result', () => {
    renderInbox({ result: null, lastAttempt: { at: hoursAgo(0.1), ok: false, reason: 'auth' } });
    expect(screen.getByRole('alert')?.textContent).toContain(
      'Jira login needed — run claude and /mcp',
    );
  });

  it('disables the retry while a sync runs', () => {
    renderInbox({
      result: null,
      lastAttempt: { at: hoursAgo(0.1), ok: false, reason: 'failed' },
      syncing: true,
    });
    expect(
      screen.getByRole('button', { name: 'Sync Jira again' }) as HTMLButtonElement,
    ).toHaveProperty('disabled', true);
  });

  it('keeps the last good items after a failed sync', () => {
    renderInbox({ lastAttempt: { at: hoursAgo(0.1), ok: false, reason: 'invalid' } });
    expect(items()).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
