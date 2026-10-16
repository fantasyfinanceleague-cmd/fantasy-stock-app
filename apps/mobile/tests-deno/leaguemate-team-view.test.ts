/**
 * The leaguemate team view (Planner ruling 2026-10-16: wire `player-portfolio` the way ESPN /
 * Sleeper / Yahoo open another manager's team from the standings and the matchup header).
 *   1. entry routing: others → their team, you → your Portfolio tab, nothing else links there;
 *   2. the edge states: a left member, no league, a failed read, no manager, never blank;
 *   3. the stake basis: the SAME teamValue.stake as Home and Portfolio;
 *   4. the member's week inputs for the player card;
 *   5. source guards: read-only (no trade action, no sparkline), rows are buttons with hints.
 * Run: cd apps/mobile/tests-deno && deno test --allow-read .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { teamHref, teamLinkLabel, linkedName, PORTFOLIO_TAB_HREF } from '../lib/game/teamLink.ts';
import { memberSnapshots, memberTrades } from '../lib/game/memberWeek.ts';
import { playerPortfolio } from '../lib/money/playerPortfolio.ts';
import { formatPercent } from '../components/sp/logic/money.ts';
import { teamValue } from '../lib/home/teamValue.ts';
import { resolveResumeTarget } from '../lib/shell/resumeTarget.ts';
import type { PortfolioLedger } from '../lib/money/portfolioLedger.ts';
import { COPY } from '../lib/money/moneyCopy.ts';
import { SOURCES } from './sourceManifest.generated.ts';

// ── 1. entry routing ─────────────────────────────────────────────────────────────

Deno.test("another manager's row or avatar opens their team, carrying their name", () => {
  assertEquals(teamHref({ userId: 'u2', name: 'Paolo M.', isYou: false }), {
    pathname: '/player-portfolio',
    params: { userId: 'u2', username: 'Paolo M.' },
  });
});

Deno.test('YOUR row or avatar opens your Portfolio tab, never your own team view', () => {
  assertEquals(teamHref({ userId: 'u1', name: 'Roberto B.', isYou: true }), PORTFOLIO_TAB_HREF);
  assertEquals(PORTFOLIO_TAB_HREF, '/(tabs)/portfolio');
  // Even with no id at all: it is still you.
  assertEquals(teamHref({ userId: null, name: 'Roberto B.', isYou: true }), PORTFOLIO_TAB_HREF);
});

Deno.test('a row with no manager id is not a button (null), never a link to nobody', () => {
  assertEquals(teamHref({ userId: '', name: 'X', isYou: false }), null);
  assertEquals(teamHref({ userId: undefined, name: 'X', isYou: false }), null);
});

Deno.test('VoiceOver: "View {name}\'s team"; yours: "View your portfolio"', () => {
  assertEquals(teamLinkLabel({ name: 'Paolo M.', isYou: false }), "View Paolo M.'s team");
  assertEquals(teamLinkLabel({ name: 'Roberto B.', isYou: true }), 'View your portfolio');
});

Deno.test('the deep link stays on the resume allow-list, with only its two params', () => {
  assertEquals(resolveResumeTarget('/player-portfolio?userId=u1&username=roberto_b&x=1'), '/player-portfolio?userId=u1&username=roberto_b');
});

Deno.test('nothing else links to the team view: exactly the standings row and the matchup header', () => {
  const linkers = Object.entries(SOURCES)
    .filter(([path, src]) => /player-portfolio/.test(src) && !path.startsWith('tests-deno'))
    .map(([path]) => path)
    .sort();
  // The route file, the route declaration, the link helper, the resume allow-list, and the
  // theme's route list; the screen files mention it in their own doc comments only.
  const callers = Object.entries(SOURCES)
    .filter(([, src]) => /teamHref\(/.test(src))
    .map(([path]) => path)
    .sort();
  // (league.tsx's call is the DEV capture hook that replays a row's push.)
  assertEquals(callers, [
    'app/(tabs)/league.tsx',
    'app/(tabs)/matchup.tsx',
    'components/game/StandingsTable.tsx',
    'components/home/StandingsCard.tsx',
    'lib/game/teamLink.ts',
  ]);
  for (const path of linkers) {
    assert(!/router\.(push|navigate|replace)\([^)]*player-portfolio/.test(SOURCES[path]), `${path} must not link to the team view directly`);
  }
});

Deno.test('wiring: League and Home rows, and the Matchup header, route through teamHref', () => {
  const table = SOURCES['components/game/StandingsTable.tsx'];
  assert(table.includes('teamHref({ userId: r.userId, name: r.name, isYou: r.isYou })'));
  assert(table.includes('onPress={href ? () => router.push(href) : undefined}'));
  const card = SOURCES['components/home/StandingsCard.tsx'];
  assert(card.includes('teamHref({ userId: r.userId, name: r.displayName, isYou: r.isYou })'));
  const m = SOURCES['app/(tabs)/matchup.tsx'];
  assert(m.includes('openYou={openTeam(user.id, youName, true)}'));
  assert(m.includes('hint: teamLinkLabel({ name, isYou })'));
  assert(m.includes('openOpponent={live.opp ? openTeam(live.opp.userId, live.opp.name, false) : undefined}'));
  // All matchups' compact boards stay inert (the ruling names the Matchup header only).
  const all = m.slice(m.indexOf('function AllMatchupsList('), m.indexOf('/** All matchups\' bye'));
  assert(!all.includes('openYou') && !all.includes('openOpponent'));
});

// ── 2. the edge states ───────────────────────────────────────────────────────────

const ledger: PortfolioLedger = {
  members: [
    { user_id: 'u1', display_name: 'Roberto B.', is_bot: false },
    { user_id: 'u2', display_name: 'Paolo M.', is_bot: false },
  ],
  symbol_names: { AAPL: 'Apple', KO: 'Coca-Cola', JPM: 'JPMorgan' },
  activity: [
    { kind: 'draft', user_id: 'u2', symbol: 'AAPL', action: 'buy', quantity: 1, round: 1, pick_number: 1, occurred_at: '2026-09-28T14:00:00Z', total_value: 100, price: 100 },
    { kind: 'draft', user_id: 'u2', symbol: 'JPM', action: 'buy', quantity: 1, round: 2, pick_number: 4, occurred_at: '2026-09-28T14:02:00Z', total_value: 200, price: 200 },
    // A manager who LEFT: activity remains, membership does not (get_portfolio_ledger lists current members only).
    { kind: 'draft', user_id: 'gone', symbol: 'KO', action: 'buy', quantity: 1, round: 1, pick_number: 2, occurred_at: '2026-09-28T14:01:00Z', total_value: 60, price: 60 },
    // A post-draft net buy by u2.
    { kind: 'trade', user_id: 'u2', symbol: 'KO', action: 'buy', quantity: 2, round: null, pick_number: null, occurred_at: '2026-10-07T15:00:00Z', total_value: 130, price: 65 },
  ],
};
const BASE = { stakeMode: 'budget_cap' as const, notionalPerSlot: null, numRounds: 2, prices: { AAPL: 110, JPM: 190, KO: 66 }, prevCloses: { AAPL: 108, JPM: 195, KO: 65 } };

Deno.test('a member who left has no team view: null, which the screen shows as "didn\'t load"', () => {
  assertEquals(playerPortfolio({ ledger, userId: 'gone', ...BASE }), null);
});

Deno.test('a member of another league (absent from this ledger) is null, never an empty team', () => {
  assertEquals(playerPortfolio({ ledger, userId: 'someone-else', ...BASE }), null);
  // What a non-member's get_portfolio_ledger returns (the RPC's empty shape): no team for anyone.
  const empty: PortfolioLedger = { activity: [], symbol_names: {}, members: [] };
  assertEquals(playerPortfolio({ ledger: empty, userId: 'u2', ...BASE }), null);
});

Deno.test('the screen never goes blank: every non-ready state is LoadFailure or the skeleton, and an empty id fails visibly', () => {
  const screen = SOURCES['components/money/PlayerPortfolioScreen.tsx'];
  assert(screen.includes("data.status === 'loading'"));
  assert(screen.includes("data.status === 'error' || !data.portfolio"));
  assert(screen.includes('<LoadFailure title={COPY.teamLoadTitle(knownName)}'));
  assert(screen.includes('onRetry={retry}'));
  // The old "Your portfolio didn't load" had the wrong subject for someone else's team (audit S-7).
  assert(!screen.includes('portfolioLoadTitle'));
  // No manager id: an error with Try again, not a spinner that never ends.
  const hook = SOURCES['lib/money/usePlayerPortfolioData.ts'];
  assert(hook.includes('if (!userId) {\n      setState({ status: \'error\''));
});

Deno.test('the load-failure copy names whose team, with a safe fallback', () => {
  assertEquals(COPY.teamLoadTitle('Paolo M.'), "Paolo M.'s team didn't load");
  assertEquals(COPY.teamLoadTitle(null), "This team didn't load");
  assertEquals(COPY.teamLoading('Paolo M.'), "Loading Paolo M.'s team");
  assertEquals(COPY.teamLoading(null), 'Loading this team');
});

// ── 3. the stake basis ───────────────────────────────────────────────────────────

Deno.test("the season-gain % is on teamValue's stake: it includes money put in after the draft", () => {
  const p = playerPortfolio({ ledger, userId: 'u2', ...BASE })!;
  const tv = teamValue({
    stakeMode: BASE.stakeMode,
    notionalPerSlot: null,
    numRounds: 2,
    drafts: [{ symbol: 'AAPL', entryPrice: 100, quantity: 1 }, { symbol: 'JPM', entryPrice: 200, quantity: 1 }],
    trades: [{ symbol: 'KO', action: 'buy', quantity: 2, price: 65 }],
    price: (s) => (BASE.prices as Record<string, number>)[s] ?? null,
  });
  // 100 + 200 drafted, plus 130 put in after the draft: the stake grows with the net buy.
  assertEquals(tv.stake, 430);
  const gain = tv.value - tv.stake;
  const pct = (gain / tv.stake) * 100;
  assertEquals(p.view.gainPctText, formatPercent(pct, { sign: 'always' }));
  // Not the draft-only basis (300): that would read a different percent.
  assert(p.view.gainPctText !== formatPercent((gain / 300) * 100, { sign: 'always' }));
});

Deno.test('wiring: the team view builds from playerPortfolio → portfolioSummary (the one stake), not its own math', () => {
  assert(SOURCES['lib/money/playerPortfolio.ts'].includes('stake: summary.stake'));
  const screen = SOURCES['components/money/PlayerPortfolioScreen.tsx'];
  assert(!/teamValue|seasonGain|portfolioSummary/.test(screen.replace(/\/\*[\s\S]*?\*\//g, '')), 'the screen only renders the view');
});

// ── 4. the member's week inputs ──────────────────────────────────────────────────

Deno.test("a member's snapshot rows become the card's week lots (mid-week entries flagged)", () => {
  assertEquals(
    memberSnapshots([{ symbol: 'AAPL', quantity: 1, week_start_price: 100, entered_mid_week: false }, { symbol: 'KO', quantity: 2, week_start_price: 65, entered_mid_week: true }]),
    [{ symbol: 'AAPL', quantity: 1, weekStartPrice: 100, enteredMidWeek: false }, { symbol: 'KO', quantity: 2, weekStartPrice: 65, enteredMidWeek: true }],
  );
});

Deno.test("a member's week trades: theirs only, inside the scoring window, inclusive", () => {
  const acts = [
    ...ledger.activity,
    { kind: 'trade' as const, user_id: 'u1', symbol: 'AAPL', action: 'buy', quantity: 1, round: null, pick_number: null, occurred_at: '2026-10-07T15:30:00Z', total_value: 1, price: 1 },
    { kind: 'trade' as const, user_id: 'u2', symbol: 'AAPL', action: 'sell', quantity: 1, round: null, pick_number: null, occurred_at: '2026-10-09T20:00:00Z', total_value: 1, price: 111 },
    { kind: 'trade' as const, user_id: 'u2', symbol: 'JPM', action: 'sell', quantity: 1, round: null, pick_number: null, occurred_at: '2026-10-12T13:31:00Z', total_value: 1, price: 190 },
  ];
  const t = memberTrades(acts, 'u2', '2026-10-05T13:30:00Z', '2026-10-09T20:00:00Z');
  assertEquals(t.map((x) => `${x.action} ${x.symbol}`), ['buy KO', 'sell AAPL']);
  assertEquals(t[0].createdAt.toISOString(), '2026-10-07T15:00:00.000Z');
  // Draft picks are never "trades".
  assert(!t.some((x) => x.symbol === 'JPM'));
});

Deno.test('the week read is the member\'s own rows, count-guarded, through the member-gated table', () => {
  const hook = SOURCES['lib/game/useMemberSnapshots.ts'];
  assert(hook.includes(".from('week_snapshots')"));
  assert(hook.includes(".eq('user_id', userId)"));
  assert(hook.includes('checkRowsComplete'));
  assert(hook.includes('{ count: \'exact\' }'));
});

// ── 5. read-only, Portfolio rules, accessibility ─────────────────────────────────

Deno.test('read-only: no trade action, no sparkline, no chart; rows open the player card', () => {
  const raw = SOURCES['components/money/PlayerPortfolioScreen.tsx'];
  const screen = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/Sparkline|<Chart|RangePills|stockSheet|useStockSheet|Buy a stock|buyAStock|onSell|tradeHistory|trade-history/.test(screen));
  assert(screen.includes('<PlayerCard'));
  assert(screen.includes('save: null'), 'no Save: the app has no watchlist yet');
  assert(screen.includes('<HoldingRow'));
  assert(screen.includes('backgroundColor: colors.moneyBg'));
});

Deno.test("a stock whose card can't be whole is a plain row (HoldingRow without onPress), never a dead tap", () => {
  const screen = SOURCES['components/money/PlayerPortfolioScreen.tsx'];
  assert(screen.includes('onPress={canOpen(r.symbol) ? () => { setSelected(r.symbol); setShown(r.symbol); } : undefined}'));
  const row = SOURCES['components/money/HoldingRow.tsx'];
  assert(row.includes('{onPress ? ('));
  assert(row.includes('accessibilityHint="Opens its player card"'));
});

Deno.test('a manager row is a button with a hint, a 44pt target at the largest sizes, and keeps its figures in the label', () => {
  const row = SOURCES['components/sp/gn/ManagerRow.tsx'];
  assert(row.includes('accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={hint}'));
  assert(row.includes('minHeight: 56') && row.includes('minHeight: 44'));
  assert(SOURCES['components/game/StandingsTable.tsx'].includes('hint={href ? teamLinkLabel({ name: r.name, isYou: r.isYou }) : undefined}'));
  assert(SOURCES['components/home/StandingsCard.tsx'].includes('hint={href ? teamLinkLabel({ name: r.displayName, isYou: r.isYou }) : undefined}'));
});

Deno.test('the Matchup header: each WHOLE half is one button (label = its reading, hint = the Planner\'s words), the line stays text', () => {
  const sb = SOURCES['components/sp/gn/Scoreboard.tsx'];
  assert(sb.includes('accessible={!interactive}'));
  // The half's own box is the button, with press feedback only (its shading/ring/layout are the plain half's).
  assert(sb.includes('<PressableScale testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={open.hint} onPress={open.onPress} style={style}>'));
  assert(sb.includes("label={`${team.name}${you ? ', you' : ''}, ${totalText}`}"));
  // Inert (All matchups' compact boards) keeps the single combined label.
  assert(sb.includes('accessibilityLabel={interactive ? undefined : label}'));
  // The lead line stays separate text, read once the card is split.
  assert(sb.includes("importantForAccessibility={interactive ? 'auto' : 'no'}"));
});

Deno.test('a bye half is inert (a plain View with no hint), and the compact All-matchups boards pass no handlers', () => {
  const sb = SOURCES['components/sp/gn/Scoreboard.tsx'];
  const bye = sb.slice(sb.indexOf('{bye || !opponent ? ('), sb.indexOf('<Half side="opp" team={opponent}'));
  assert(bye.includes('<View style={[styles.half, styles.byeHalf]} testID="scoreboard-bye">'));
  assert(!/PressableScale|open/.test(bye));
  const m = SOURCES['app/(tabs)/matchup.tsx'];
  // The bye scoreboard opens ONLY yours; the opponent half does not exist.
  assert(m.includes("bye={{ label: BYE_HALF, line: COPY.byeNoResult }} openYou={openTeam(user.id, youName, true)} />"));
  const all = m.slice(m.indexOf('function AllMatchupsList('), m.indexOf("/** All matchups' bye"));
  assert(!all.includes('openYou') && !all.includes('openOpponent'));
  assert(all.includes('size="compact"'));
});

Deno.test("Home's Standings: the HEADER is the Standings link (hit slop to 44pt, the header's box untouched), each row opens its team", () => {
  const card = SOURCES['components/home/StandingsCard.tsx'];
  const header = card.slice(card.indexOf('<PressableScale'), card.indexOf('</PressableScale>'));
  assert(header.includes('onPress={() => router.push(STANDINGS_HREF)}'));
  assert(header.includes('accessibilityHint="Opens Standings"'));
  assert(header.includes('hitSlop={HEADER_HIT_SLOP}'));
  assert(card.includes('const HEADER_HIT_SLOP = { top: 11, bottom: 11 } as const;'));
  // "Don't change minHeight or padding; the header must not move": no minHeight on the header style.
  const headerStyle = card.slice(card.indexOf('  header: {'), card.indexOf('  title: {'));
  assert(!headerStyle.includes('minHeight'));
  // Rows go to teams, never to Standings: the Standings push appears once (the header).
  // (The other push is the DEV capture hook replaying the header's tap.)
  assertEquals((card.match(/onPress=\{\(\) => router\.push\(STANDINGS_HREF\)\}/g) ?? []).length, 1);
  // Every row (bots included) opens its team: no row-kind exception in the wiring.
  assert(!/isBot/.test(card.slice(card.indexOf('const href = teamHref'), card.indexOf('</Animated.View>'))));
});

Deno.test('hints on rows are the Planner\'s words and the labels keep their content', () => {
  const row = SOURCES['components/sp/gn/ManagerRow.tsx'];
  assert(row.includes('accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={hint}'));
  assertEquals(teamLinkLabel({ name: 'Paolo M.', isYou: false }), "View Paolo M.'s team");
  assertEquals(teamLinkLabel({ name: 'Roberto B.', isYou: true }), 'View your portfolio');
  // A name ending in "s" still takes "'s".
  assertEquals(teamLinkLabel({ name: 'Chris', isYou: false }), "View Chris's team");
  assertEquals(COPY.teamLoadTitle('Chris'), "Chris's team didn't load");
});

Deno.test('a crafted link cannot put text in the title: sanitised, capped, and shown only while loading', () => {
  assertEquals(linkedName('Paolo M.'), 'Paolo M.');
  assertEquals(linkedName('  ‮evil\u0007  '), 'evil');
  assertEquals(linkedName('x'.repeat(100))?.length, 40);
  assertEquals(linkedName('‏\n'), null);
  assertEquals(linkedName(null), null);
  const screen = SOURCES['components/money/PlayerPortfolioScreen.tsx'];
  assert(screen.includes("(data.status === 'loading' ? linkedName(username) : null)"));
});

Deno.test('a forged id fires no member reads: the snapshot and slot reads wait for the ledger to confirm the member', () => {
  const screen = SOURCES['components/money/PlayerPortfolioScreen.tsx'];
  assert(screen.includes("const confirmed = data.status === 'ready' && !!data.portfolio;"));
  assert(screen.includes('MONEY_FIXTURE || !raw || !confirmed ? null : leagueId'));
  assert(screen.includes('MONEY_FIXTURE || !confirmed ? null : leagueId'));
});

Deno.test("the week read checks the resolved { error } (rowsOrThrow), never treating a failed read as no rows", () => {
  const hook = SOURCES['lib/game/useMemberSnapshots.ts'];
  assert(hook.includes("rowsOrThrow(res as RowsResult<MemberSnapshotRow & { user_id: string }>, 'week_snapshots')"));
  assert(hook.includes("setState({ status: 'error', rows: [] });"));
});

Deno.test("the Matchup header's opponent half opens their team in every state that has one (live, final, pre-season)", () => {
  const m = SOURCES['app/(tabs)/matchup.tsx'];
  assert((m.match(/openOpponent=\{live\.opp \? openTeam\(live\.opp\.userId, live\.opp\.name, false\) : undefined\}/g) ?? []).length >= 2);
});
