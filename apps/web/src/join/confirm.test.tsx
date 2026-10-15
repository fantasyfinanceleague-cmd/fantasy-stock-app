import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfirmPage from './ConfirmPage';
import { readConfirmOutcome } from './confirmOutcome';
import { WEB_COPY } from './joinCopy';

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
  const preview = (body: unknown, status = 200) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

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

  it('a touch device after a reload (the code is gone from memory): the line, no button', () => {
    arrive({ authConfirm: 'confirmed' }, undefined, true);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.confirmed);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('with an invite: names the league, from the preview and never from the URL', async () => {
    const spy = preview({ found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: null });
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: 'abcde23456' });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Your email is confirmed. Open the app and sign in to finish joining Stock Scudetto.',
    );
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({ code: 'ABCDE23456' });
    // the auth code is never sent anywhere
    expect(JSON.stringify(spy.mock.calls)).not.toContain(CODE);
  });

  it.each([
    ['a refused league', () => preview({ found: true, name: 'Stock Scudetto', inviter: null, reason: 'league_full' })],
    ['an unknown code', () => preview({ found: false })],
    ['a failed preview', () => preview({ error: 'unavailable' }, 500)],
    ['a network error', () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('x'))],
  ])('with an invite but %s: the plain line', async (_label, arrange) => {
    arrange();
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: 'ABCDE23456' });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Your email is confirmed\. Open the app and sign in\.$/);
  });

  it('a junk invite is never sent to the preview', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    arrive({ authConfirm: 'confirmed' }, { code: CODE, invite: '<script>' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(WEB_COPY.confirmed);
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

  it('the pending-invite variant is the approved line', () => {
    expect(WEB_COPY.confirmedWithInvite('Stock Scudetto')).toBe(
      'Your email is confirmed. Open the app and sign in to finish joining Stock Scudetto.',
    );
  });
});
