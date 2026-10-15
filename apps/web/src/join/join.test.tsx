import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import JoinPage, { joinStateFor, readHandoff } from './JoinPage';
import { JoinView, inviteHeadline, initials, unbreakable, UNBROKEN_NAME_MAX } from './JoinView';
import { normalizeInviteCode } from './inviteCode';
import { WEB_COPY, refusalMessage, JOIN_BLOCKS } from './joinCopy';
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
  const nb = (v: string) => v.replace(/ /g, '\u00a0');
  it.each([
    ['Stock Scudetto', 'roberto_b', `roberto_b invited you to ${nb('Stock Scudetto')}`],
    ['Stock Scudetto', null, `You're invited to ${nb('Stock Scudetto')}`],
    [null, 'roberto_b', "You're invited to a league"],
    [null, null, "You're invited to a league"],
  ])('%s / %s', (name, inviter, line) => {
    expect(inviteHeadline(name, inviter)).toBe(line);
  });

  it('the league name never breaks across lines (non-breaking spaces; the rest may wrap)', () => {
    expect(unbreakable('Wall Street Wolves')).toBe('Wall\u00a0Street\u00a0Wolves');
    expect(inviteHeadline('Wall Street Wolves', 'roberto_b')).toContain('Wall\u00a0Street\u00a0Wolves');
    expect(inviteHeadline('Wall Street Wolves', 'roberto_b')).toMatch(/^roberto_b invited you to /);
  });

  it('a name too long to fit one line may wrap at its spaces (never chopped mid-word)', () => {
    const long = 'Wall Street Wolves Fantasy Finance Club';
    expect(Array.from(long).length).toBeGreaterThan(UNBROKEN_NAME_MAX);
    expect(unbreakable(long)).toBe(long);
    expect(unbreakable('A'.repeat(UNBROKEN_NAME_MAX - 2) + ' B')).toContain('\u00a0'); // exactly at the limit it still holds
    expect(unbreakable('A'.repeat(UNBROKEN_NAME_MAX - 1) + ' B')).not.toContain('\u00a0'); // one over, it may wrap
  });

  it('initials: first letters, code-point aware (never half an emoji)', () => {
    expect(initials('Roberto B.')).toBe('RB');
    expect(initials('roberto_b')).toBe('R');
    expect(initials('  ')).toBe('');
    expect(initials('😀 Bob')).toBe('😀B');
  });
});

describe('joinStateFor', () => {
  it('maps every preview to a state', () => {
    expect(joinStateFor('abcde23456', null)).toEqual({ kind: 'loading' });
    expect(joinStateFor(undefined, null)).toEqual({ kind: 'dead' });
    expect(joinStateFor('abcde23456', { kind: 'not_found' })).toEqual({ kind: 'dead' });
    expect(joinStateFor('abcde23456', { kind: 'unknown' })).toEqual({ kind: 'invited', code: 'ABCDE23456', name: null, inviter: null });
    expect(joinStateFor('abcde23456', { kind: 'found', name: 'X', inviter: 'r', block: null })).toEqual({ kind: 'invited', code: 'ABCDE23456', name: 'X', inviter: 'r' });
    expect(joinStateFor('abcde23456', { kind: 'found', name: 'X', inviter: 'r', block: 'league_full' })).toEqual({ kind: 'refused', name: 'X', inviter: 'r', block: 'league_full', signIn: true });
  });
});

describe('readHandoff: only known words from the router state', () => {
  it.each([
    [{ notice: 'expired' }, { notice: 'expired', emailConfirmed: false, signedIn: false }],
    [{ notice: 'confirmed-sign-in' }, { notice: 'confirmed-sign-in', emailConfirmed: false, signedIn: false }],
    [{ emailConfirmed: true }, { notice: undefined, emailConfirmed: true, signedIn: true }], // a confirmed link signed this browser in
    [{ signedIn: true }, { notice: undefined, emailConfirmed: false, signedIn: true }], // an OAuth return
    [{ signedIn: 'yes' }, null],
    [{ notice: 'paused', emailConfirmed: true }, { notice: 'paused', emailConfirmed: true, signedIn: true }],
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

  it('a dead link: ONLY the Planner\'s panel and "Sign in" (no heading, no avatar, no badge), never the typing line', () => {
    const { container } = render(<JoinView state={{ kind: 'dead' }} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(container.querySelector('.obw__av, .obw__icon')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent("This invite link doesn't work anymore. Ask for a new one.");
    expect(screen.queryByText(/check it/i)).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent('Sign in');
    expect(links[0]).toHaveAttribute('href', 'fantasystockapp://login');
    expect(container.querySelector('.obw__arrival--dead')).not.toBeNull(); // centred on the page, not bottom-anchored
  });

  it('a dead link after sign-in has no "Sign in" either', () => {
    render(<JoinView state={{ kind: 'dead', signIn: false }} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it.each([
    ['league_full', 'Stock Scudetto is full. Ask whoever invited you if they can make room.'],
    ['draft_started', "Stock Scudetto isn't taking new players right now."],
    ['draft_in_progress', "Stock Scudetto isn't taking new players right now."],
    ['season_completed', "Stock Scudetto isn't taking new players right now."],
    ['unknown', "You can't join this league right now. Ask your commissioner to check the invite."],
  ] as const)('refused (%s): the heading stays, the warn panel replaces the buttons, "Sign in" under it, NO App Store badge', (block, line) => {
    render(<JoinView state={{ kind: 'refused', name: 'Stock Scudetto', inviter: 'roberto_b', block, signIn: true }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    expect(screen.getByRole('alert')).toHaveTextContent(line);
    expect(screen.queryByRole('link', { name: WEB_COPY.appStoreBadge })).toBeNull();
    expect(screen.queryByRole('button')).toBeNull(); // nobody makes an account for a closed league
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', 'fantasystockapp://login');
    expect(refusalMessage(block, 'Stock Scudetto')).toBe(line);
  });

  it('after sign-in a refusal has no "Sign in" link', () => {
    render(<JoinView state={{ kind: 'refused', name: 'Stock Scudetto', inviter: null, block: 'league_full', signIn: false }} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("You're invited to Stock Scudetto");
  });

  it('no inviter: the league icon (not initials) above the heading', () => {
    const { container } = render(<JoinView state={{ kind: 'refused', name: 'Stock Scudetto', inviter: null, block: 'league_full', signIn: true }} />);
    expect(container.querySelector('.obw__icon')).not.toBeNull();
    expect(container.querySelector('.obw__av')).toBeNull();
  });

  it('with an inviter: their initials above the heading', () => {
    const { container } = render(<JoinView state={{ kind: 'refused', name: 'Stock Scudetto', inviter: 'Roberto B.', block: 'league_full', signIn: true }} />);
    expect(container.querySelector('.obw__av')).toHaveTextContent('RB');
    expect(container.querySelector('.obw__icon')).toBeNull();
  });

  it('every block has a line (none empty, none raw)', () => {
    for (const b of JOIN_BLOCKS) expect(refusalMessage(b, 'X').length).toBeGreaterThan(10);
  });

  it('the Planner\'s lines hold in this flow only: the app\'s typed-code "Ask your commissioner" is untouched elsewhere', () => {
    expect(refusalMessage('league_full', 'X')).not.toMatch(/commissioner/i);
    expect(refusalMessage('invite_expired', 'X')).toBe('This invite has expired. Ask your commissioner for a new code.');
  });

  it('renders a hostile league name or inviter as text, never markup', () => {
    const { container } = render(<JoinView state={{ kind: 'refused', name: '<img src=x onerror=alert(1)>', inviter: '<b>x</b>', block: 'league_full', signIn: true }} />);
    expect(container.querySelector('img')).toBeNull();
    expect([...container.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['Sign in']); // the hostile <b> never became markup
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
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Sign in']);
    expect(spy).not.toHaveBeenCalled();
    expect(m.currentSession).not.toHaveBeenCalled();
  });

  it('a found league with an inviter: the headline, then the three sign-ins', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: null });
    renderAt('/join/abcde23456');
    expect(await screen.findByRole('button', { name: WEB_COPY.continueApple })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('a refusal: its neutral line and the App Store, and the sign-in flow never starts', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: 'draft_started' });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('alert')).toHaveTextContent("Stock Scudetto isn't taking new players right now.");
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link', { name: WEB_COPY.appStoreBadge })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(m.currentSession).not.toHaveBeenCalled();
  });

  it('found:false: the dead-link panel, no heading, "Sign in"', async () => {
    answer(200, { found: false });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('alert')).toHaveTextContent(WEB_COPY.inviteLinkDead);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Sign in']);
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

  it('the handoff is read ONCE and wiped from the history entry (a Back or reload must not reuse a "this visit signed in")', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: null, reason: null });
    m.currentSession.mockResolvedValue({ userId: 'u1' });
    m.readOwnUsername.mockResolvedValue('roberto');
    m.previewWithSession.mockResolvedValue({ kind: 'found', league: { name: 'Stock Scudetto', members: 5, max: 6, stakeMode: null, notionalPerSlot: null, budgetAmount: null, leagueType: null, numWeeks: null, durationDays: null, draftDate: null, draftStatus: 'not_started' }, block: null });
    m.joinWithSession.mockResolvedValue({ kind: 'joined', leagueId: 'L1', leagueName: 'Stock Scudetto' });
    function Probe() {
      const { state } = useLocation();
      return <p data-testid="state">{JSON.stringify(state)}</p>;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: '/join/ABCDE23456', state: { signedIn: true, emailConfirmed: true } }]}>
        <Routes><Route path="/join/:code" element={<><JoinPage /><Probe /></>} /></Routes>
      </MemoryRouter>,
    );
    // the flow DID receive it (this visit signed in: it carries straight on to the join)...
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/You're in/);
    // ...and the entry no longer carries it
    expect(screen.getByTestId('state')).toHaveTextContent('null');
  });

  describe('ending the session when a sign-in return lands on a link that cannot be joined', () => {
    const renderWith = (state: unknown, path = '/join/ABCDE23456') =>
      render(
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
          <Routes><Route path="/join/:code" element={<JoinPage />} /></Routes>
        </MemoryRouter>,
      );

    it('refused after a sign-in return: the session is ended (the flow never mounts to do it)', async () => {
      answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: 'league_full' });
      renderWith({ signedIn: true });
      expect(await screen.findByRole('alert')).toHaveTextContent('is full');
      await waitFor(() => expect(m.signOutLocal).toHaveBeenCalledTimes(1));
    });

    it('a dead link after a sign-in return: ended too (found:false, and a malformed code)', async () => {
      answer(200, { found: false });
      renderWith({ signedIn: true });
      await screen.findByRole('alert');
      await waitFor(() => expect(m.signOutLocal).toHaveBeenCalled());
      cleanup();
      m.signOutLocal.mockClear();
      renderWith({ signedIn: true }, '/join/%3Cscript%3E');
      await waitFor(() => expect(m.signOutLocal).toHaveBeenCalledTimes(1));
    });

    it('a COLD visit to a refused link signs nobody out (there is nothing to end)', async () => {
      answer(200, { found: true, name: 'Stock Scudetto', inviter: null, reason: 'league_full' });
      renderWith(null);
      await screen.findByRole('alert');
      expect(m.signOutLocal).not.toHaveBeenCalled();
    });

    it('a joinable link after a sign-in return is the flow\'s to finish, not ended here', async () => {
      answer(200, { found: true, name: 'Stock Scudetto', inviter: null, reason: null });
      m.currentSession.mockResolvedValue(null);
      renderWith({ signedIn: true });
      await screen.findByRole('button', { name: WEB_COPY.continueApple });
      expect(m.signOutLocal).not.toHaveBeenCalled();
    });
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
