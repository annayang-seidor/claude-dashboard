// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSessionName, NewSessionButton, type OnNewSession } from './NewSessionButton';
import { renderEn } from './testing';

afterEach(cleanup);

function setup(props: { jiraTitle?: string; onStart?: OnNewSession } = {}) {
  const onStart = vi.fn<OnNewSession>(props.onStart ?? (async () => true));
  const user = userEvent.setup();
  renderEn(<NewSessionButton ticketKey="FA-540" jiraTitle={props.jiraTitle} onStart={onStart} />);
  const button = screen.getByRole('button', { name: 'New session for this ticket' });
  const open = async () => {
    await user.click(button);
    return screen.getByRole('textbox', { name: 'Session name' }) as HTMLInputElement;
  };
  return { user, onStart, button, open };
}

const selected = (input: HTMLInputElement) =>
  input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);

describe('NewSessionButton', () => {
  it('pre-fills "<KEY> <Jira title>", focused and selected', async () => {
    const { open, button } = setup({ jiraTitle: 'Fix the PDP accordion' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const input = await open();
    expect(input.value).toBe('FA-540 Fix the PDP accordion');
    expect(document.activeElement).toBe(input);
    expect(selected(input)).toBe(input.value);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Session name (optional)')).toBeTruthy();
    expect(screen.getByText('Leave empty to start without a name.')).toBeTruthy();
  });

  it('pre-fills the bare key when no Jira title is cached', async () => {
    const { open } = setup();
    expect((await open()).value).toBe('FA-540');
  });

  it('Enter starts with the trimmed name, closes and returns focus to the button', async () => {
    const { user, open, onStart, button } = setup();
    await open();
    // Typing replaces the selected suggestion.
    await user.keyboard('  cart fix  {Enter}');
    expect(onStart).toHaveBeenCalledWith('FA-540', 'cart fix');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it('Start with an empty name starts without one', async () => {
    const { user, open, onStart } = setup({ jiraTitle: 'Fix the PDP' });
    await user.clear(await open());
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStart).toHaveBeenCalledWith('FA-540', undefined);
  });

  it('Escape closes without starting and returns focus to the button', async () => {
    const { user, open, onStart, button } = setup();
    await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('Cancel closes without starting and returns focus to the button', async () => {
    const { user, open, onStart, button } = setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('disables Start while the request is in flight; a failure keeps the form open', async () => {
    let finish: (ok: boolean) => void = () => {};
    const { user, open, onStart } = setup({
      onStart: () => new Promise<boolean>((r) => (finish = r)),
    });
    await open();
    const start = screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    await user.click(start);
    expect(start.disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(onStart).toHaveBeenCalledTimes(1);

    finish(false);
    await waitFor(() => expect(start.disabled).toBe(false));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('FA-540');
  });

  it('is disabled for a ticket group without a key', () => {
    renderEn(<NewSessionButton ticketKey={null} onStart={async () => true} />);
    const button = screen.getByRole('button', { name: 'New session for this ticket' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('defaultSessionName', () => {
  it('drops control characters from the Jira title and fits 120 characters', () => {
    expect(defaultSessionName('FA-1', 'a\nb\tc')).toBe('FA-1 a b c');
    expect(defaultSessionName('FA-1', '  ')).toBe('FA-1');
    expect(defaultSessionName('FA-1', 'x'.repeat(200))).toHaveLength(120);
  });
});
