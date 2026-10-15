import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import WebCallbackPage, { failureNotice, readHeldCallback, type HeldCallback } from './WebCallbackPage';
import { PENDING_INVITE_KEY } from './pendingInvite';
import { WEB_COPY } from './joinCopy';
import type { makeAuthMock } from './testing/mockAuth';

const m = vi.hoisted(() => {
  const f = () => vi.fn();
  return {
    onboardingClient: vi.fn(() => null), currentSession: f(), signInWithProvider: f(), signUpWithEmail: f(), signInWithEmail: f(), exchangeCode: f(),
    signOutLocal: f(), readOwnUsername: f(), checkUsernames: f(), setUsername: f(), previewWithSession: f(), joinWithSession: f(),
  } as ReturnType<typeof makeAuthMock>;
});
vi.mock('./onboardingAuth', () => m);

const CODE = '9f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';

/** Lands on /join/:code and shows exactly what the router handed it. */
function JoinProbe() {
  const { pathname, state } = useLocation();
  return <p data-testid="join">{pathname} {JSON.stringify(state)}</p>;
}

const hold = (held: Partial<HeldCallback> | null) => {
  if (held) Object.defineProperty(window, '__stockpileWebCallback', { value: Object.freeze({ code: null, invite: null, via: 'email', error: false, ...held }), configurable: true });
};
const renderCallback = () =>
  render(
    <MemoryRouter initialEntries={['/auth/web-callback']}>
      <Routes>
        <Route path="/" element={<p>LANDING</p>} />
        <Route path="/join/:code" element={<JoinProbe />} />
        <Route path="/auth/web-callback" element={<WebCallbackPage />} />
      </Routes>
    </MemoryRouter>,
  );
const landed = async () => (await screen.findByTestId('join')).textContent;

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.exchangeCode.mockResolvedValue({ error: null });
  m.signOutLocal.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__stockpileWebCallback;
  localStorage.clear();
});

describe('/auth/web-callback: the web flow\'s own return exchanges the code, once', () => {
  it('an email link: exchanges the code, then back to /join/<invite> with the chip flag', async () => {
    hold({ code: CODE, invite: 'abcde23456', via: 'email' });
    renderCallback();
    expect(await landed()).toBe('/join/ABCDE23456 {"emailConfirmed":true}');
    expect(m.exchangeCode).toHaveBeenCalledTimes(1);
    expect(m.exchangeCode).toHaveBeenCalledWith(CODE);
  });

  it('an OAuth return: no "email confirmed" chip', async () => {
    hold({ code: CODE, invite: 'ABCDE23456', via: 'oauth' });
    renderCallback();
    expect(await landed()).toBe('/join/ABCDE23456 {"emailConfirmed":false}');
  });

  it('takes the invite from the one stored when sign-in began when the URL had none', async () => {
    localStorage.setItem(PENDING_INVITE_KEY, 'XYZW9876');
    hold({ code: CODE, invite: null, via: 'email' });
    renderCallback();
    expect(await landed()).toBe('/join/XYZW9876 {"emailConfirmed":true}');
  });

  it('a junk invite is ignored, never navigated to', async () => {
    hold({ code: CODE, invite: '../../evil', via: 'email' });
    renderCallback();
    await waitFor(() => expect(m.signOutLocal).toHaveBeenCalled());
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
  });

  it('the exchange fails (a different browser: no verifier): "your email is confirmed, sign in" via email', async () => {
    m.exchangeCode.mockResolvedValue({ error: { message: 'code verifier not found', code: 'flow_state_not_found' } });
    hold({ code: CODE, invite: 'ABCDE23456', via: 'email' });
    renderCallback();
    expect(await landed()).toBe('/join/ABCDE23456 {"notice":"confirmed-sign-in"}');
  });

  it('the exchange fails via OAuth: the generic line', async () => {
    m.exchangeCode.mockResolvedValue({ error: { message: 'x' } });
    hold({ code: CODE, invite: 'ABCDE23456', via: 'oauth' });
    renderCallback();
    expect(await landed()).toBe('/join/ABCDE23456 {"notice":"generic"}');
  });

  it.each([
    ['an expired email link', { via: 'email', error: 'other' }, 'expired'],
    ['an OAuth error', { via: 'oauth', error: 'other' }, 'generic'],
    ['the signup gate (email)', { via: 'email', error: 'paused' }, 'paused'],
    ['the signup gate (OAuth)', { via: 'oauth', error: 'paused' }, 'paused'],
  ] as const)('%s: never exchanges, hands back %s', async (_label, held, notice) => {
    hold({ ...held, invite: 'ABCDE23456' });
    renderCallback();
    expect(await landed()).toBe(`/join/ABCDE23456 {"notice":"${notice}"}`);
    expect(m.exchangeCode).not.toHaveBeenCalled();
  });

  it('an error wins over a code that came with it (never exchange a link that failed)', async () => {
    hold({ code: CODE, invite: 'ABCDE23456', via: 'email', error: 'other' });
    renderCallback();
    await landed();
    expect(m.exchangeCode).not.toHaveBeenCalled();
  });

  it('with no invite anywhere, a failure shows its line right here (there is nowhere to sign in)', async () => {
    hold({ via: 'email', error: 'other' });
    renderCallback();
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.webLinkExpired);
    expect(screen.queryByTestId('join')).toBeNull();
  });

  it('a successful sign-in with nothing to join ends the session and goes to the landing', async () => {
    hold({ code: CODE, via: 'oauth' });
    renderCallback();
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    expect(m.signOutLocal).toHaveBeenCalled();
  });

  it('a reload (nothing in memory) with a stored invite: back to the join page, no exchange', async () => {
    localStorage.setItem(PENDING_INVITE_KEY, 'ABCDE23456');
    renderCallback();
    expect(await landed()).toBe('/join/ABCDE23456 null');
    expect(m.exchangeCode).not.toHaveBeenCalled();
  });

  it('a typed URL with nothing stored: the landing', async () => {
    renderCallback();
    expect(await screen.findByText('LANDING')).toBeInTheDocument();
    expect(m.exchangeCode).not.toHaveBeenCalled();
  });

  it('shows no words while it works', () => {
    m.exchangeCode.mockReturnValue(new Promise(() => {}));
    hold({ code: CODE, invite: 'ABCDE23456' });
    const { container } = renderCallback();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.textContent).not.toContain(CODE);
  });
});

describe('failureNotice', () => {
  it.each([
    ['email', 'error-link', false, 'expired'],
    ['email', 'exchange-failed', false, 'confirmed-sign-in'],
    ['oauth', 'error-link', false, 'generic'],
    ['oauth', 'exchange-failed', false, 'generic'],
    ['email', 'error-link', 'paused', 'paused'],
    ['oauth', 'exchange-failed', 'paused', 'paused'],
  ] as const)('%s / %s / %s -> %s', (via, cause, error, notice) => {
    expect(failureNotice(via, cause, error)).toBe(notice);
  });
});

describe('readHeldCallback', () => {
  it('reads what the inline script kept, and nothing else', () => {
    expect(readHeldCallback()).toBeNull();
    hold({ code: CODE, invite: 'ABCDE23456', via: 'oauth', error: 'paused' });
    expect(readHeldCallback()).toEqual({ code: CODE, invite: 'ABCDE23456', via: 'oauth', error: 'paused' });
  });

  it('coerces anything odd to a safe value', () => {
    Object.defineProperty(window, '__stockpileWebCallback', { value: { code: 42, invite: {}, via: 'carrier-pigeon', error: 'weird' }, configurable: true });
    expect(readHeldCallback()).toEqual({ code: null, invite: null, via: 'email', error: 'other' });
  });
});
