import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfirmPage from './ConfirmPage';
import { readConfirmOutcome } from './confirmOutcome';
import { WEB_COPY } from './joinCopy';
import { forgetHeld } from './heldLink';

describe('readConfirmOutcome', () => {
  it.each([
    [{ authConfirm: 'confirmed' }, 'confirmed'],
    [{ authConfirm: 'error' }, 'error'],
    [{ authConfirm: 'none' }, 'none'],
    [{ authConfirm: 'yes' }, 'none'],
    [{ authConfirm: true }, 'none'],
    [{ usr: null, key: 'default', idx: 0 }, 'none'],
    [null, 'none'],
    [undefined, 'none'],
    ['confirmed', 'none'],
  ])('%j -> %s', (state, outcome) => {
    expect(readConfirmOutcome(state)).toBe(outcome);
  });
});

describe('/auth/confirm', () => {
  const CODE = '9f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

  afterEach(() => {
    window.history.replaceState(null, '', '/');
    delete (window as unknown as Record<string, unknown>).__stockpileAuthConfirm;
    forgetHeld();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** Arrives the way the inline script leaves things: the outcome in history.state, code + invite in memory. */
  const arrive = (state: unknown, held?: { code: string | null; invite: string | null }, touch = false) => {
    window.history.replaceState(state, '', '/auth/confirm');
    if (held) Object.defineProperty(window, '__stockpileAuthConfirm', { value: Object.freeze(held), configurable: true });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: touch && q === '(pointer: coarse)', addEventListener() {}, removeEventListener() {} }));
    return render(
      <MemoryRouter initialEntries={['/auth/confirm']}>
        <Routes>
          <Route path="/" element={<p>LANDING</p>} />
          <Route path="/auth/confirm" element={<ConfirmPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it('confirmed: the approved line, verbatim, with no network call and no button on a desktop', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: null });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Your email is confirmed\. Open the app and sign in\.$/);
    expect(WEB_COPY.confirmed).toBe('Your email is confirmed. Open the app and sign in.');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a touch device with a code: "Open the app" to the app\'s confirm link', () => {
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: null }, true);
    expect(screen.getByRole('link', { name: WEB_COPY.openApp })).toHaveAttribute('href', `fantasystockapp://auth/confirm?code=${CODE}`);
  });

  it('takes the held code ONCE and deletes it from window (no other script on the origin can read it)', () => {
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: null }, true);
    expect('__stockpileAuthConfirm' in window).toBe(false);
    expect(screen.getByRole('link', { name: WEB_COPY.openApp })).toHaveAttribute('href', `fantasystockapp://auth/confirm?code=${CODE}`);
  });

  it('a touch device after a reload (the code is gone from memory): the line, no button', () => {
    arrive({ authConfirm: 'confirmed' }, undefined, true);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.confirmed);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('the app\'s email carries NO invite (decision 17): a stray one is ignored, nothing is called', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    // even if the held object somehow carried an invite, the page never reads or uses it
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: 'ABCDE23456' } as unknown as { code: string | null; invite: string | null });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Your email is confirmed\. Open the app and sign in\.$/);
    expect(screen.queryByText(/finish joining|Stock Scudetto|ABCDE23456/)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('error: the approved expired line, never the confirmed line, no button', () => {
    arrive({ authConfirm: 'error' }, { code: null, invite: null }, true);
    expect(screen.getByRole('alert')).toHaveTextContent('This link has expired. Open the app and sign in to get a new one.');
    expect(screen.queryByText(WEB_COPY.confirmed)).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('no outcome (typed URL): the landing, no claim', () => {
    arrive(null);
    expect(screen.getByText('LANDING')).toBeInTheDocument();
    expect(screen.queryByText(WEB_COPY.confirmed)).toBeNull();
  });
});
