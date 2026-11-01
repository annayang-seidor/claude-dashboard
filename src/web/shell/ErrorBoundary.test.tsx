// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderEn } from '../sessions/testing';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let fail = false;
function Flaky() {
  if (fail) throw new Error('boom');
  return <p>Loaded</p>;
}

describe('ErrorBoundary', () => {
  it('shows the error with a Try again button that mounts the children again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fail = true;
    renderEn(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Something went wrong on this page.');
    expect(console.error).toHaveBeenCalledWith('[ui]', expect.any(Error), expect.any(String));

    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Loaded')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
