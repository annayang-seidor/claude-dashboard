// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_CONFIG } from '../../shared/config';
import { ConfigProvider } from '../config';
import { renderEn } from '../sessions/testing';
import { Header, JiraLoginNote, JiraSyncStatus } from './Header';

afterEach(cleanup);

describe('JiraLoginNote', () => {
  it('says what to run, and its labelled retry button syncs again', async () => {
    const onRetry = vi.fn();
    renderEn(<JiraLoginNote busy={false} onRetry={onRetry} />);
    expect(screen.getByRole('status').textContent).toContain(
      'Jira login needed — run claude and /mcp',
    );
    const retry = screen.getByRole('button', { name: 'Sync Jira again' });
    expect(retry.getAttribute('title')).toBe('Sync Jira again');
    await userEvent.setup().click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables the retry while a lookup runs', () => {
    renderEn(<JiraLoginNote busy onRetry={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sync Jira again' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('JiraSyncStatus', () => {
  const NOW = new Date('2026-10-26T02:30:00.000Z');
  const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
  const props = { syncedAt: minutesAgo(12), failure: null, busy: false, onSync: vi.fn(), now: NOW };

  it('says how long ago Jira synced; the icon is a labelled Sync button', async () => {
    const onSync = vi.fn();
    renderEn(<JiraSyncStatus {...props} onSync={onSync} />);
    expect(screen.getByText('Jira synced 12 min ago')).toBeTruthy();
    const sync = screen.getByRole('button', { name: 'Sync Jira now' });
    expect(sync.getAttribute('title')).toBe('Sync Jira now');
    await userEvent.setup().click(sync);
    expect(onSync).toHaveBeenCalledOnce();
    // No live region: the status changes every minute and must not be read out each time.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says when Jira has never synced', () => {
    renderEn(<JiraSyncStatus {...props} syncedAt={null} />);
    expect(screen.getByText('Jira not synced yet')).toBeTruthy();
  });

  it('disables the button while a sync runs', () => {
    renderEn(<JiraSyncStatus {...props} busy />);
    const sync = screen.getByRole('button', { name: 'Sync Jira now' });
    expect(sync).toHaveProperty('disabled', true);
    expect(sync.getAttribute('aria-busy')).toBe('true');
  });

  it('after a failed sync, keeps the age of the results shown and gives the reason as a tooltip', () => {
    renderEn(<JiraSyncStatus {...props} syncedAt={minutesAgo(120)} failure="invalid" />);
    const note = screen.getByRole('status');
    expect(note.textContent).toBe('Jira sync failed · showing results from 2h ago');
    expect(note.getAttribute('title')).toBe("Claude's answer did not match the expected format");
    expect(screen.getByRole('button', { name: 'Sync Jira now' })).toBeTruthy();
  });

  it('says there are no results yet when no sync has worked', () => {
    renderEn(<JiraSyncStatus {...props} syncedAt={null} failure="timeout" />);
    const note = screen.getByRole('status');
    expect(note.textContent).toBe('Jira sync failed · no results yet');
    expect(note.getAttribute('title')).toBe('Claude took longer than 2 minutes');
  });
});

describe('workspace tabs', () => {
  it('has one tab per configured workspace, with its label and root as written', () => {
    const side = {
      id: 'side',
      label: { en: 'Side projects', 'zh-TW': '副業' },
      root: '~/side',
      kind: 'personal' as const,
      fallback: false,
      autoArchiveDays: 14,
    };
    renderEn(
      <ConfigProvider
        value={{ ...DEFAULT_PAGE_CONFIG, workspaces: [...DEFAULT_PAGE_CONFIG.workspaces, side] }}
      >
        <Header workspace="side" query="" onQuery={vi.fn()} />
      </ConfigProvider>,
    );
    const tabs = screen.getByRole('navigation', { name: 'Workspace' });
    const links = within(tabs).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Work ~/y', '/work'],
      ['Personal ~/o', '/personal'],
      ['Side projects ~/side', '/side'],
    ]);
    expect(links[2]!.getAttribute('aria-current')).toBe('page');
    // A Personal-kind workspace gets the Personal search hint.
    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toMatch(/Project/);
  });
});
