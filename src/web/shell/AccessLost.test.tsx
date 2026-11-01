// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderEn } from '../sessions/testing';
import { AccessLost } from './AccessLost';

const refreshToken = vi.fn<() => Promise<string>>();
const reopenWithToken = vi.fn();
vi.mock('../api', () => ({
  accessStore: { get: () => true, subscribe: () => () => {} },
  refreshToken: () => refreshToken(),
  reopenWithToken: (t: string) => reopenWithToken(t),
}));

beforeEach(() => {
  refreshToken.mockReset();
  reopenWithToken.mockReset();
});
afterEach(cleanup);

describe('AccessLost Reconnect (ADR 0048)', () => {
  it('reopens the page with the token the server traded', async () => {
    refreshToken.mockResolvedValue('new-token');
    renderEn(<AccessLost />);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(reopenWithToken).toHaveBeenCalledWith('new-token');
  });

  it.each([
    ['refused', "This tab's link is too old to reconnect. Run the command instead."],
    ['down', "The server isn't running. Start it with dashboard start."],
  ])('says why when the answer is %s, and keeps the command', async (answer, note) => {
    refreshToken.mockResolvedValue(answer);
    renderEn(<AccessLost />);
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect((await screen.findByRole('status')).textContent).toBe(note);
    expect(reopenWithToken).not.toHaveBeenCalled();
    expect(screen.getByText('open "$(cat ~/.claude-dashboard/url)"')).toBeTruthy();
  });
});
