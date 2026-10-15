import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import JoinPage, { joinStateFor } from './JoinPage';
import { JoinView } from './JoinView';
import { normalizeInviteCode } from './inviteCode';
import { blockMessage, JOIN_BLOCKS, JOIN_COPY, PENDING_COPY, type JoinBlock } from './joinCopy';
import { APP_STORE_URL } from './config';

describe('normalizeInviteCode', () => {
  it.each([
    ['ABCDE23456', 'ABCDE23456'], // today's generator
    ['abcde23456', 'ABCDE23456'], // typed or pasted lower-case
    ['  ABCDE23456 ', 'ABCDE23456'],
    ['K0O1IZ', 'K0O1IZ'], // a pre-2026-08 Math.random code (0/O/1/I allowed)
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

describe('/join/:code', () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/join/:code" element={<JoinPage />} /></Routes>
      </MemoryRouter>,
    );

  afterEach(() => vi.restoreAllMocks());

  const answer = (status: number, body: unknown) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('junk: the app\'s "no league has that code" line, no way into the app, NO network call', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    renderAt('/join/%3Cscript%3E');
    expect(screen.getByRole('alert')).toHaveTextContent(JOIN_COPY.badCode);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a found league with an inviter: "{inviter} invited you to {league}", open-in-app with the normalised code', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: null });
    renderAt('/join/abcde23456');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('roberto_b invited you to Stock Scudetto');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: PENDING_COPY.openInApp })).toHaveAttribute('href', 'fantasystockapp://join/ABCDE23456');
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute('href', APP_STORE_URL);
  });

  it('no inviter: "You\'re invited to {league}"', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: null, reason: null });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^You're invited to Stock Scudetto$/);
  });

  it('a refusal: its line in place, the App Store only', async () => {
    answer(200, { found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: 'season_completed' });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('alert')).toHaveTextContent("Stock Scudetto's season is over. Ask your commissioner whether they're running it back.");
    expect(screen.queryByRole('link', { name: PENDING_COPY.openInApp })).toBeNull();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
  });

  it('found:false: the "no league has that code" line, no links', async () => {
    answer(200, { found: false });
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('alert')).toHaveTextContent(JOIN_COPY.badCode);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it.each([
    ['a 429', () => answer(429, { error: 'rate_limited' })],
    ['a 500', () => answer(500, { error: 'unavailable' })],
    ['a body that is not JSON', () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 200 }))],
    ['a network error', () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))],
  ])('%s: "You\'re invited to a league" and the app, never an error page', async (_label, arrange) => {
    arrange();
    renderAt('/join/ABCDE23456');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^You're invited to a league$/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: PENDING_COPY.openInApp })).toBeInTheDocument();
  });

  it('joinStateFor', () => {
    expect(joinStateFor('abcde23456', null)).toEqual({ kind: 'loading' });
    expect(joinStateFor(undefined, null)).toEqual({ kind: 'bad_code' });
    expect(joinStateFor('abcde23456', { kind: 'unknown' })).toEqual({ kind: 'invited', code: 'ABCDE23456', name: null, inviter: null, block: null });
  });
});

describe('JoinView: the preview and every refusal', () => {
  const league = { name: 'Stock Scudetto', max: 6 };

  it('with the inviter: "{inviter} invited you to {league}"', () => {
    render(<JoinView state={{ kind: 'preview', code: 'ABCDE23456', league, inviter: 'Roberto B.', block: null }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Roberto B. invited you to Stock Scudetto');
    expect(screen.getByText('RB')).toBeInTheDocument();
  });

  it('without the inviter (preview-league not yet sending it): the league name alone, no avatar', () => {
    const { container } = render(<JoinView state={{ kind: 'preview', code: 'ABCDE23456', league, inviter: null, block: null }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Stock Scudetto$/);
    expect(container.querySelector('.obw__av')).toBeNull();
  });

  it('shows the rows when given', () => {
    render(<JoinView state={{ kind: 'preview', code: 'C0DE23', league, inviter: null, block: null, rows: [{ label: 'Managers', value: '5 of 6' }] }} />);
    expect(screen.getByText('Managers')).toBeInTheDocument();
    expect(screen.getByText('5 of 6')).toBeInTheDocument();
  });

  it.each(JOIN_BLOCKS.map((b) => [b] as [JoinBlock]))('%s: its approved line in place, the App Store, no open-in-app', (block) => {
    render(<JoinView state={{ kind: 'preview', code: 'ABCDE23456', league, inviter: 'Roberto B.', block }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(blockMessage(block, league));
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: PENDING_COPY.openInApp })).toBeNull();
  });

  it.each([
    ['unreachable', JOIN_COPY.unreachable],
    ['rate_limited', JOIN_COPY.rateLimited],
  ] as const)('transport %s: our line, never the server\'s', (error, line) => {
    render(<JoinView state={{ kind: 'error', code: 'ABCDE23456', error }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(line);
  });

  it('renders a hostile league name as text, never markup', () => {
    const { container } = render(
      <JoinView state={{ kind: 'preview', code: 'ABCDE23456', league: { name: '<img src=x onerror=alert(1)>', max: 6 }, inviter: '<b>x</b>', block: 'league_full' }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });
});
