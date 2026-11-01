// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiSession } from '../../shared/api';
import { PersonalList } from './PersonalList';
import { NOW, renderEn, session } from './testing';
import { WorkList } from './WorkList';

afterEach(cleanup);

const plain = session({ ticketKey: 'FA-540', title: 'Cart API', at: [10, 23, 9, 0] });
const renamed: ApiSession = {
  ...session({ ticketKey: 'FA-540', title: 'My name', autoTitle: 'Auto name', at: [10, 23, 8, 0] }),
};
renamed.state = { ...renamed.state, title: 'My name' };
const ops = session({
  category: 'ops',
  env: { project: 'acme', name: 's1', display: 'S1', prod: false },
  title: 'Solr reindex stuck',
  at: [10, 22, 9, 0],
});
const long = session({ ticketKey: 'FA-540', title: 'x'.repeat(130), at: [10, 21, 9, 0] });

function renderWork(sessions: ApiSession[] = [plain, renamed, ops]) {
  const onEdit = vi.fn();
  renderEn(
    <WorkList
      sessions={sessions}
      query=""
      now={NOW}
      onEdit={onEdit}
      onResume={vi.fn()}
      onDelete={vi.fn()}
      onNewSession={vi.fn()}
      onCleanup={vi.fn()}
    />,
  );
  return onEdit;
}

const rowOf = (title: string) =>
  screen.getAllByTestId('session-row').find((r) => r.textContent?.includes(title))!;
const moreButton = (title: string) =>
  within(rowOf(title)).getByRole('button', { name: 'More actions' });

/** ⋯ → Rename, from the keyboard. */
async function startRename(title: string) {
  const button = moreButton(title);
  button.focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard('{Enter}'); // Rename is the first item
  return { button, input: screen.getByRole('textbox', { name: 'Session title' }) };
}

describe('row ⋯ menu', () => {
  it('opens from the keyboard with the first item focused, and exposes its state', async () => {
    renderWork();
    const button = moreButton('Cart API');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Personal rows show only Rename and Copy resume command', async () => {
    const mine = session({ workspace: 'personal', title: 'Blog post', at: [10, 23, 9, 0] });
    renderEn(
      <PersonalList
        sessions={[mine]}
        query=""
        now={NOW}
        onEdit={vi.fn()}
        onResume={vi.fn()}
        onDelete={vi.fn()}
        onCleanup={vi.fn()}
      />,
    );
    await userEvent.click(moreButton('Blog post'));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Rename',
      'Copy resume command',
    ]);
  });
});

describe('rename', () => {
  it('turns the title into an input with the text selected and the auto-title hint', async () => {
    renderWork();
    const { input } = await startRename('My name');
    const field = input as HTMLInputElement;
    expect(field.value).toBe('My name');
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 7]);
    const hint = document.getElementById(field.getAttribute('aria-describedby')!);
    expect(hint?.textContent).toBe('Leave empty to restore "Auto name".');
  });

  it('Enter saves the trimmed title and returns focus to ⋯', async () => {
    const onEdit = renderWork();
    const { button, input } = await startRename('Cart API');
    await userEvent.clear(input);
    await userEvent.type(input, '  Cart fix  {Enter}');
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(plain.id, { title: 'Cart fix' });
    expect(screen.queryByRole('textbox', { name: 'Session title' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('typing replaces the selected title, and blur saves', async () => {
    const onEdit = renderWork();
    await startRename('Cart API');
    await userEvent.keyboard('Cart fix');
    await userEvent.click(document.body);
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(plain.id, { title: 'Cart fix' });
  });

  it('Esc cancels and returns focus to ⋯', async () => {
    const onEdit = renderWork();
    const { button, input } = await startRename('Cart API');
    await userEvent.type(input, 'Cart fix{Escape}');
    expect(onEdit).not.toHaveBeenCalled();
    expect(rowOf('Cart API')).toBeTruthy();
    expect(document.activeElement).toBe(button);
  });

  it('an unchanged title sends nothing', async () => {
    const onEdit = renderWork();
    const { input } = await startRename('Cart API');
    await userEvent.type(input, '{End}  {Enter}');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('empty clears a dashboard rename, and does nothing when there is none', async () => {
    const onEdit = renderWork();
    let { input } = await startRename('My name');
    await userEvent.clear(input);
    await userEvent.type(input, '   {Enter}');
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(renamed.id, { title: null });

    ({ input } = await startRename('Cart API'));
    await userEvent.clear(input);
    await userEvent.keyboard('{Enter}');
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('caps typing at 120 characters', async () => {
    const onEdit = renderWork();
    const { input } = await startRename('Cart API');
    await userEvent.clear(input);
    await userEvent.type(input, `${'a'.repeat(125)}{Enter}`);
    expect(onEdit).toHaveBeenCalledWith(plain.id, { title: 'a'.repeat(120) });
  });

  it('a title already over 120 characters says so and is not saved until shortened', async () => {
    const onEdit = renderWork([long]);
    const { input } = await startRename('xxxx');
    await userEvent.type(input, '{End}{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Use at most 120 characters.')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();

    await userEvent.type(input, `{Backspace>10}{Enter}`);
    expect(onEdit).toHaveBeenCalledWith(long.id, { title: 'x'.repeat(120) });
  });

  it('a double-click on the title starts it; the [ENV] tag stays outside the input', async () => {
    renderWork();
    await userEvent.dblClick(screen.getByText('Solr reindex stuck'));
    const input = screen.getByRole('textbox', { name: 'Session title' }) as HTMLInputElement;
    expect(input.value).toBe('Solr reindex stuck');
    expect(rowOf('[S1]').querySelector('.row__title > .env-tag')?.textContent).toBe('[S1]');
  });
});
