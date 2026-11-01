// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '../../shared/api';
import { DEFAULT_PAGE_CONFIG } from '../../shared/config';
import type { Workspace } from '../../shared/session';
import { ConfigProvider } from '../config';
import { CleanupModal } from './CleanupModal';
import { RetentionContext } from './retention';
import { NOW, renderEn, session } from './testing';

afterEach(cleanup);

// NOW is Fri 23 Oct 2026, 12:00.
const oldDone = session({ title: 'Old done', at: [10, 3, 9, 0], status: 'done' });
const oldTodo = session({ title: 'Old to do', at: [10, 3, 9, 0] });
const oldBookmarked = session({
  title: 'Old bookmarked',
  at: [10, 3, 9, 0],
  status: 'done',
  bookmarked: true,
});
const septemberDone = session({ title: 'September done', at: [9, 1, 9, 0], status: 'done' });
const julyDone = session({ title: 'July done', at: [7, 1, 9, 0], status: 'done' });
const tenDaysDone = session({ title: 'Ten days done', at: [10, 13, 9, 0], status: 'done' });
const recentDone = session({ title: 'Recent done', at: [10, 20, 9, 0], status: 'done' });
const personalDone = session({
  title: 'Personal done',
  at: [9, 1, 9, 0],
  status: 'done',
  workspace: 'personal',
});
const ALL = [
  oldDone,
  oldTodo,
  oldBookmarked,
  septemberDone,
  julyDone,
  tenDaysDone,
  recentDone,
  personalDone,
];

/** `retention` is Claude Code's cleanupPeriodDays as the pane provides it; undefined = not loaded. */
function setup(
  workspace: Workspace = 'work',
  retention?: number | null,
  config = DEFAULT_PAGE_CONFIG,
) {
  const onClose = vi.fn();
  const onConfirm = vi.fn<(s: ApiSession[]) => void>();
  const user = userEvent.setup();
  renderEn(
    <ConfigProvider value={config}>
      <RetentionContext value={retention}>
        <button type="button">Clean up</button>
        <CleanupModal
          workspace={workspace}
          sessions={ALL}
          now={NOW}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      </RetentionContext>
    </ConfigProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Clean up old sessions' });
  const preview = () =>
    within(dialog)
      .queryAllByRole('listitem')
      .map((li) => li.textContent);
  const confirm = () => within(dialog).getByRole('button', { name: /^Delete \d+ session/ });
  const pick = (name: string) => user.click(within(dialog).getByRole('button', { name }));
  const toggle = (name: string) => user.click(within(dialog).getByRole('checkbox', { name }));
  return { user, dialog, preview, confirm, pick, toggle, onClose, onConfirm };
}

describe('CleanupModal', () => {
  it('takes its ranges, default range and keeps from the config', () => {
    const config = {
      ...DEFAULT_PAGE_CONFIG,
      cleanup: {
        ...DEFAULT_PAGE_CONFIG.cleanup,
        ranges: [3, 10, 21],
        defaultRange: 10,
        keepTodo: false,
      },
    };
    const { dialog } = setup('work', 30, config);
    expect(
      within(within(dialog).getByRole('group', { name: 'Older than' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['3 days', '10 days', '3 weeks', 'Custom date']);
    expect(within(dialog).getByRole('button', { name: '10 days' }).ariaPressed).toBe('true');
    expect(within(dialog).getByRole('checkbox', { name: /Keep bookmarked/ }).ariaChecked).toBe(
      'true',
    );
    expect(within(dialog).getByRole('checkbox', { name: /Keep To do/ }).ariaChecked).toBe('false');
  });

  it('defaults to 2 weeks with both keeps on, and previews what will go', () => {
    const { dialog, preview, confirm } = setup();
    expect(within(dialog).getByText('Based on last activity. Only ~/y sessions are affected.'));
    expect(within(dialog).getByRole('button', { name: '2 weeks' }).ariaPressed).toBe('true');
    // Only ranges under Claude Code's 30-day cleanup (ADR 0038).
    expect(
      within(within(dialog).getByRole('group', { name: 'Older than' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['1 week', '2 weeks', 'Custom date']);
    for (const name of ['Keep bookmarked sessions', 'Keep To do sessions']) {
      expect(within(dialog).getByRole('checkbox', { name }).ariaChecked).toBe('true');
    }
    expect(within(dialog).getByText('Will delete 3 session(s)')).toBeTruthy();
    expect(preview()).toEqual([
      'Old done · 10/03 09:00',
      'September done · 09/01 09:00',
      'July done · 07/01 09:00',
    ]);
    expect(within(dialog).getByText('Bookmarked kept: 1 · To do kept: 1')).toBeTruthy();
    expect(confirm().textContent).toBe('Delete 3 session(s)');
    expect((confirm() as HTMLButtonElement).disabled).toBe(false);
  });

  it('1 week also picks sessions idle 8 to 14 days', async () => {
    const { dialog, preview, pick } = setup();
    await pick('1 week');
    expect(preview()).toEqual([
      'Old done · 10/03 09:00',
      'September done · 09/01 09:00',
      'July done · 07/01 09:00',
      'Ten days done · Last Tue 09:00',
    ]);
    expect(within(dialog).getByText('Bookmarked kept: 1 · To do kept: 1')).toBeTruthy();
  });

  it('unchecking a keep box adds the sessions it protected', async () => {
    const { dialog, preview, toggle } = setup();
    await toggle('Keep To do sessions');
    expect(preview()).toContain('Old to do · 10/03 09:00');
    expect(within(dialog).getByText('Bookmarked kept: 1 · To do kept: 0')).toBeTruthy();
    await toggle('Keep bookmarked sessions');
    expect(preview()).toContain('Old bookmarked · 10/03 09:00');
    expect(within(dialog).getByText('Will delete 5 session(s)')).toBeTruthy();
  });

  it('a custom date has no future days and picks sessions last active before it', async () => {
    const { dialog, preview, pick, confirm } = setup();
    await pick('Custom date');
    const input = within(dialog).getByLabelText('Pick a date') as HTMLInputElement;
    expect(input.max).toBe('2026-10-23');
    // Starts 3 weeks back; no lower limit while cleanupPeriodDays is unknown.
    expect(input.value).toBe('2026-10-02');
    expect(input.min).toBe('');
    expect(preview()).toEqual(['September done · 09/01 09:00', 'July done · 07/01 09:00']);

    fireEvent.change(input, { target: { value: '2026-10-21' } });
    expect(preview()).toHaveLength(5);
    expect(preview()).toContain('Recent done · Tue 09:00');

    // Typed past the picker's max: nothing matches.
    fireEvent.change(input, { target: { value: '2026-10-30' } });
    expect(within(dialog).getByText('No sessions match these settings')).toBeTruthy();
    expect(preview()).toEqual([]);
    expect(confirm().textContent).toBe('Delete 0 session(s)');
    expect((confirm() as HTMLButtonElement).disabled).toBe(true);
  });

  it("the date picker stops where Claude Code's own cleanup has already removed sessions", async () => {
    const { dialog, pick } = setup('work', 30);
    await pick('Custom date');
    expect((within(dialog).getByLabelText('Pick a date') as HTMLInputElement).min).toBe(
      '2026-09-23',
    );
  });

  it('a shorter cleanupPeriodDays moves the starting date up to the limit; off means no limit', async () => {
    const short = setup('work', 14);
    await short.pick('Custom date');
    const input = within(short.dialog).getByLabelText('Pick a date') as HTMLInputElement;
    expect([input.min, input.value]).toEqual(['2026-10-09', '2026-10-09']);
    cleanup();

    const off = setup('work', null);
    await off.pick('Custom date');
    expect((within(off.dialog).getByLabelText('Pick a date') as HTMLInputElement).min).toBe('');
  });

  it('confirm closes and hands over exactly the previewed sessions', async () => {
    const { user, confirm, onClose, onConfirm } = setup();
    await user.click(confirm());
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith([oldDone, septemberDone, julyDone]);
  });

  it('confirm does nothing when nothing matches', async () => {
    const { user, confirm, onConfirm, toggle } = setup();
    await toggle('Keep To do sessions');
    fireEvent.click(screen.getByRole('button', { name: 'Custom date' }));
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-01-01' } });
    await user.click(confirm());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('only looks at its own workspace', () => {
    const { dialog, preview } = setup('personal');
    expect(within(dialog).getByText('Based on last activity. Only ~/o sessions are affected.'));
    expect(preview()).toEqual(['Personal done · 09/01 09:00']);
  });

  it('closes with Escape, the close button, Cancel and a click outside', async () => {
    const { user, dialog, onClose } = setup();
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(dialog.parentElement!);
    // A click inside the dialog does not close it.
    await user.click(within(dialog).getByText('Older than', { selector: 'div' }));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('moves focus in, keeps Tab inside, and labels the close button', async () => {
    const { user, dialog } = setup();
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(close.title).toBe('Close');
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement?.textContent).toBe('Delete 3 session(s)');
    await user.tab();
    expect(document.activeElement).toBe(close);
  });
});
