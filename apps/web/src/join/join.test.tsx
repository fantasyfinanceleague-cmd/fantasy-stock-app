import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import JoinPage, { joinStateFor, readHandoff } from './JoinPage';
import { JoinView, inviteHeadline } from './JoinView';
import { normalizeInviteCode } from './inviteCode';
import { WEB_COPY, preSignInBlockMessage, JOIN_BLOCKS } from './joinCopy';
import { APP_STORE_URL } from './config';
import type { makeAuthMock } from './testing/mockAuth';

const m = vi.hoisted(() => {
  const f = () => vi.fn();
  return {
    onboardingClient: vi.fn(() => null), currentSession: f(), signInWithProvider: f(), signUpWithEmail: f(), signInWithEmail: f(), exchangeCode: f(),
    signOutLocal: f(), readOwnUsername: f(), checkUsernames: f(), setUsername: f(), previewWithSession: f(), joinWithSession: f(),
  } as ReturnType<typeof makeAuthMock>;
});
vi.mock('./onboardingAuth', () => m);

describe('normalizeInviteCode', () => {
  it.each([
    ['ABCDE23456', 'ABCDE23456'],
    ['abcde23456', 'ABCDE23456'],
    ['  ABCDE23456 ', 'ABCDE23456'],
    ['K0O1IZ', 'K0O1IZ'], // a pre-2026-08 Math.random code (0/O/1/I allowed)
    ['ABCD', 'ABCD'],
    ['A'.repeat(12), 'A'.repeat(12)],
  ])('%s -> %s', (raw, code) => {
    expect(normalizeInviteCode(raw)).toBe(code);
  });

  it.each([undefined, null, '', 'ABC', 'A'.repeat(13), 'ABCDE-2345', 'ABCDE 23456', '<script>', '../../etc', 'ABCDÉ23456', '%00ABCDE'])(
    'refuses %s without a network call',
    (raw) => {
      expect(normalizeInviteCode(raw)).toBeNull();
    },
  );
});

describe('the headline', () => {
  it.each([
    ['Stock Scudetto', 'roberto_b', 'roberto_b invited you to Stock Scudetto'],
    ['Stock Scudetto', null, "You're invited to Stock Scudetto"],
    [null, 'roberto_b', "You're invited to a league"],
    [null, null, "You're invited to a league"],
  ])('%s / %s', (name, inviter, line) => {
    expect(inviteHeadline(name, inviter)).toBe(line);
  });
});

describe('joinStateFor', () => {
  it('maps every preview to a state', () => {
    expect(joinStateFor('abcde23456', null)).toEqual({ kind: 'loading' });
    expect(joinStateFor(undefined, null)).toEqual({ kind: 'dead' });
    expect(joinStateFor('abcde23456', { kind: 'not_found' })).toEqual({ kind: 'dead' });
    expect(joinStateFor('abcde23456', { kind: 'unknown' })).toEqual({ kind: 'invited', code: 'ABCDE23456', name: null, inviter: null });
    expect(joinStateFor('abcde23456', { kind: 'found', name: 'X', inviter: 'r', block: null })).toEqual({ kind: 'invited', code: 'ABCDE23456', name: 'X', inviter: 'r' });
    expect(joinStateFor('abcde23456', { kind: 'found', name: 'X', inviter: 'r', block: 'league_full' })).toEqual({ kind: 'refused', name: 'X', inviter: 'r', block: 'league_full' });
  });
});

describe('readHandoff: only known words from the router state', () => {
  it.each([
    [{ notice: 'expired' }, { notice: 'expired', emailConfirmed: false }],
    [{ notice: 'confirmed-sign-in' }, { notice: 'confirmed-sign-in', emailConfirmed: false }],
    [{ emailConfirmed: true }, { notice: undefined, emailConfirmed: true }],
    [{ notice: 'paused', emailConfirmed: true }, { notice: 'paused', emailConfirmed: true }],
    [{ notice: '<img src=x onerror=alert(1)>' }, null],
    [{ notice: 'Your email is confirmed.' }, null],
    [{ emailConfirmed: 'yes' }, null],
    [{}, null],
    [null, null],
    ['expired', null],
    [undefined, null],
  ])('%j', (state, want) => {
    expect(readHandoff(state)).toEqual(want);
  });
});

describe('JoinView: the static states', () => {
  afterEach(() => cleanup());

  it('loading is the page frame only: no words, no links', () => {
    const { container } = render(<JoinView state={{ kind: 'loading' }} />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('dead: the Planner\'s line, never the typing line, no way onward', () => {
    render(<JoinView state={{ kind: 'dead' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent("This invite link doesn't work anymore. Ask for a new one.");
    expect(screen.queryByText(/check it/i)).toBeNull();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it.each([
    ['league_full', 'Stock Scudetto is full. Ask whoever invited you if they can make room.'],
    ['draft_started', "Stock Scudetto isn't taking new players right now."],
    ['draft_in_progress', "Stock Scudetto isn't taking new players right now."],
    ['season_completed', "Stock Scudetto isn't taking new players right now."],
    ['unknown', "You can't join this league right now. Ask your commissioner to check the invite."],
  ] as const)('refused before sign-in: %s', (block, line) => {
    render(<JoinView state={{ kind: 'refused', name: 'Stock Scudetto', inviter: 'roberto_b', block }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    expect(screen.getByRole('alert')).toHaveTextContent(line);
    expect(screen.getByRole('link', { name: WEB_COPY.appStoreBadge })).toHaveAttribute('href', APP_STORE_URL);
    expect(screen.queryByRole('button')).toBeNull(); // nobody makes an account for a closed league
    expect(preSignInBlockMessage(block, 'Stock Scudetto')).toBe(line);
  });

  it('every block has a pre-sign-in line (none is empty or raw)', () => {
    for (const b of JOIN_BLOCKS) expect(preSignInBlockMessage(b, 'X').length).toBeGreaterThan(10);
  });

  it('renders a hostile league name or inviter as text, never markup', () => {
    const { container } = render(<JoinView state={{ kind: 'refused', name: '<img src=x onerror=alert(1)>', inviter: '<b>x</b>', block: 'league_full' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('/join/:code', () => {
  const renderAt = (entry: string | { pathname: string; state: unknown }) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes><Route path="/join/:code" element={<JoinPage />} /></Routes>
      </MemoryRouter>,
    );
  const answer = (status: number, body: unknown) => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

  beforeEach(() => {
    for (const fn of Object.values(m)) fn.mockReset();
    m.currentSession.mockResolvedValue(null);
    m.signOutLocal.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('junk: the dead-link line, NO network call, no way in', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    renderAt('/join/%3Cscript%3E');
    expect(screen.getByRole('alert')).toHaveTextContent(WEB_COPY.inviteLinkDead);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    expect(m.currentSession).not.toHaveBeenCalled();
  });

  it('a found league with an inviter: the headline, then the three sign-ins', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: null });
    renderAt('/join/abcde23456');
    expect(await screen.findByRole('button', { name: WEB_COPY.continueApple })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    expect(screen.getByRole('link', { name: WEB_COPY.openApp })).toHaveAttribute('href', 'fantasystockapp://join/ABCDE23456');
  });

  it('a refusal: its neutral line and the App Store, and the sign-in flow never starts', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: 'draft_started' });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('alert')).toHaveTextContent("Stock Scudetto isn't taking new players right now.");
    expect(screen.queryByRole('button')).toBeNull();
    expect(m.currentSession).not.toHaveBeenCalled();
  });

  it('found:false: the dead-link line', async () => {
    answer(200, { found: false });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.inviteLinkDead);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it.each([
    ['a 429', () => answer(429, { error: 'rate_limited' })],
    ['a 500', () => answer(500, { error: 'unavailable' })],
    ['a body that is not JSON', () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }))],
    ['a network error', () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('%s: "You\'re invited to a league" and the same sign-ins, never an error page', async (_label, arrange) => {
    arrange();
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('button', { name: WEB_COPY.continueApple })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^You're invited to a league$/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a notice handed back by the web callback shows; junk router state is ignored', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: null, reason: null });
    renderAt({ pathname: '/join/ABCDE23456', state: { notice: 'expired' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.webLinkExpired);
    cleanup();
    answer(200, { found: true, name: 'Stock Scudetto', inviter: null, reason: null });
    renderAt({ pathname: '/join/ABCDE23456', state: { notice: '<img src=x>' } });
    await screen.findByRole('button', { name: WEB_COPY.continueApple });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
