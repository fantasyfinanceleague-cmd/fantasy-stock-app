/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { matchupSegmentFromParam } from '@/lib/game/draftComplete';
import { View, StyleSheet } from 'react-native';
import { Icon } from '@/components/sp/Icon';

import { space } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Text } from '@/components/sp/Text';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { GroupHead, PlayerCard, RosterRow, Scoreboard, type PlayerCardOwnership } from '@/components/sp/gn';
import { LINE_MAX_SCALE } from '@/components/sp/gn/Scoreboard';
import { Card } from '@/components/sp/Card';
import { Avatar } from '@/components/sp/Avatar';
import { YOUR_NAME_WEIGHT } from '@/lib/game/managerRow';
import { useRevealOnce, type RevealState } from '@/lib/game/useRevealOnce';
import { useAllMatchups } from '@/lib/game/useAllMatchups';
import { useFinalLineups, type FinalLineupsState } from '@/lib/game/useFinalLineups';
import type { AllMatchupRow } from '@/lib/game/allMatchups';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { FinalBanner } from '@/components/game/FinalBanner';
import { buildFinalBanner } from '@/lib/game/finalBanner';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useMatchup, type MatchupDerived } from '@/lib/game/useMatchup';
import { COPY } from '@/lib/game/gameCopy';
import { COPY as MONEY_COPY } from '@/lib/money/moneyCopy';
import { AllMatchupsSkeleton, MatchupSkeleton, RosterRowsSkeleton } from '@/components/game/LoadingSkeletons';
import { LoadFailure } from '@/components/money/LoadFailure';
import { unpricedNote } from '@/lib/plCoverage';
import { preSeasonStartsLabel, byeToRoundLabel, eliminatedLabel, playoffPendingLine } from '@/lib/home/homeCopy';
import { useAuth } from '@/lib/useAuth';
import type { LineupRow } from '@/lib/game/lineupLedger';
import type { HomeRawInputs } from '@/lib/home/useHomeLeague';
import { toLiveSnapshots, toLiveTrades } from '@/lib/home/buildHomeViewModel';
import { resolveWeekWindow } from '@/lib/time/marketWeek';
import { cardSlotPill, closesBefore, lastWeekClose, orderBarsAt, weekSessions } from '@/lib/game/matchupRoster';
import { buildRosterView, type RosterSideInput } from '@/lib/game/matchupRosterView';
import { useRosterData, type RosterData } from '@/lib/game/useRosterData';
import { openingOf, playerCardData } from '@/lib/game/playerCardModel';
import { fixtureSeasonBars } from '@/lib/game/matchupFixture';
import { SEAM_ON } from '@/lib/game/devSeam';
import { useStockChartData } from '@/lib/money/useStockChartData';
import { useStockSheet } from '@/components/money/MoneyHost';
import { decideTradeGate } from '@/lib/money/tradeGate';
import { marketOpensLabel } from '@/lib/money/marketOpensLabel';

// Matchup (W4, Game Night). Giorgio, 2026-10-12: "a fantasy-football matchup, nothing
// else" — the Scoreboard (names, avatars, the two totals, "{leader} leads by $X"; YOUR half
// shaded, never the leader's), then the mirrored roster: your stocks left, theirs right,
// best first by week gain (slotted leagues grouped under their slot, best first within),
// the centre column empty, no row lit for its winner, no race chart. The ORDER reads each
// stock's gain at the last market close and holds through the next day (matchupRoster.ts);
// the numbers on the rows are live and sum to the score. Tapping any stock, yours or
// theirs, opens its player card as a sheet. FINAL: the FinalBanner over the same rows, from
// the posted week's own per-stock rows (shown only when they reconcile to the cent).
export default function MatchupScreen() {
  const { activeLeagueId, activeLeague, refresh } = useLeagueContext();
  const { colors } = useTheme();
  const m = useMatchup(activeLeagueId);
  // G3: the Friday reveal plays once per matchup-week, once the result is posted.
  const revealFinal = m.derived?.view.kind === 'final' && m.derived.final !== null;
  const reveal = useRevealOnce(activeLeagueId, m.derived?.week ?? null, revealFinal);
  // "My matchup" / "All matchups" are the board's labels (key screen 2); the switch stays
  // as navigation (Giorgio, 2026-10-12, item 9).
  const [segment, setSegment] = useState<'mine' | 'all'>('mine');
  // The draft's ending on a Week 1 bye opens All matchups (?segment=all). The tab
  // stays mounted, so the route param is applied when it changes, not only at mount.
  const { segment: segmentParam } = useLocalSearchParams<{ segment?: string }>();
  useEffect(() => {
    const s = matchupSegmentFromParam(segmentParam);
    if (s) setSegment(s);
  }, [segmentParam]);
  const all = useAllMatchups(activeLeagueId, m.derived?.week ?? null, m.names, segment === 'all');
  const { user } = useAuth();
  // The final lineup: the posted week's own per-stock rows, shown only when they reconcile.
  const fv = m.derived;
  const finalSides = fv && fv.view.kind === 'final' && fv.final && fv.live.opp && user && fv.weekStart && fv.weekEnd
    ? { mine: user.id, theirs: fv.live.opp.userId, myGain: fv.final.me, theirGain: fv.final.opp, windowStart: fv.weekStart, windowEnd: fv.weekEnd }
    : null;
  const finalLines = useFinalLineups(activeLeagueId, fv?.week ?? null, finalSides, finalSides !== null);
  const roster = useRosterData(activeLeagueId, user?.id ?? null, fv?.live.opp?.userId ?? null);
  // The order may change only when you arrive or pull to refresh, never under a poll while
  // you're looking (Design Lead, 2026-10-12, on Giorgio's "AFTER TRADING ENDS"): a newly
  // settled close is admitted only if it settled before this moment (orderAsOf).
  const [orderAsOf, setOrderAsOf] = useState(() => new Date());
  useFocusEffect(useCallback(() => {
    setOrderAsOf(new Date());
  }, []));
  const onRefresh = useCallback(async () => {
    setOrderAsOf(new Date());
    await refresh();
  }, [refresh]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="Matchup" showAvatar />
      <BarsRefresh onRefresh={onRefresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[5] }}>
        {m.derived ? (
          <SegmentedControl
            options={[{ label: 'My matchup', value: 'mine' }, { label: 'All matchups', value: 'all' }]}
            value={segment}
            onChange={(v) => setSegment(v === 'all' ? 'all' : 'mine')}
          />
        ) : null}
        {segment === 'all' ? (
          <AllMatchupsList key={activeLeagueId ?? 'none'} state={all} myUserId={user?.id ?? ''} />
        ) : (
          // S-4: keyed by league, so a league switch mounts a fresh scoreboard and roster
          // instead of rolling league A's into league B's (Home's H5, HomeLeagueTransition).
          <MatchupBody key={activeLeagueId ?? 'none'} status={m.status} derived={m.derived} phase={m.phase} onRefresh={m.refresh} raw={m.raw} reveal={reveal} finalLines={finalLines} roster={roster} orderAsOf={orderAsOf} />
        )}
      </BarsRefresh>
    </View>
  );
}

function AllMatchupsList({ state, myUserId }: { state: { status: string; rows: AllMatchupRow[]; retry: () => void }; myUserId: string }) {
  // S-6: loading shows the games' shape (never a blank tab); a failed load says so and offers Try again.
  if (state.status === 'loading' || state.status === 'idle') return <AllMatchupsSkeleton />;
  if (state.status === 'error') {
    return <LoadFailure title={COPY.allMatchupsLoadFailed} message={MONEY_COPY.loadRetryMessage} onRetry={state.retry} />;
  }
  return (
    <View style={styles.stack}>
      {state.rows.map((r, i) => (!r.b ? (
        // A bye has no opponent and no result: the team and the app's bye line, never a
        // nameless opponent or a "leads by" (b: null — allMatchups' bye row).
        <ByeGame key={`${r.a.userId}-${i}`} name={r.a.name} mine={r.a.userId === myUserId} />
      ) : (
        // Your game shades your half (you're side a, allMatchups puts you first); every
        // other game is two plain halves — there's no "you" to shade.
        <Scoreboard
          key={`${r.a.userId}-${i}`}
          size="compact"
          mine={r.a.userId === myUserId}
          final={r.final}
          you={{ name: r.a.name, gain: r.a.gain }}
          opponent={{ name: r.b.name, gain: r.b.gain }}
        />
      )))}
    </View>
  );
}

/** All matchups' bye: the team (yours shaded, as on its Scoreboard) and COPY.byeNoResult. */
function ByeGame({ name, mine }: { name: string; mine: boolean }) {
  const { colors } = useTheme();
  return (
    <Card style={[styles.bye, mine ? { backgroundColor: colors.youTint } : null]} accessible accessibilityLabel={`${name}, ${COPY.byeNoResult}`}>
      <Avatar name={name} size={32} tone={mine ? 'you' : 'opp'} ring={mine} />
      <Text variant="callout" numberOfLines={1} style={[styles.byeName, mine ? styles.byeNameMine : null]}>{name}</Text>
      <Text variant="caption" tone="secondary" numberOfLines={1}>{COPY.byeNoResult}</Text>
    </Card>
  );
}

interface BodyProps {
  status: 'loading' | 'ready' | 'error' | 'no-league';
  derived: MatchupDerived | null;
  phase: import('@/lib/home/homePhase').PhaseResult | null;
  onRefresh: () => Promise<void>;
  raw: HomeRawInputs | null;
  /** The one-time reveal: the banner mounts only once it is decided (useRevealOnce). */
  reveal: RevealState;
  finalLines: FinalLineupsState;
  roster: RosterData;
  orderAsOf: Date;
}

function MatchupBody({ status, derived, phase, onRefresh, raw, reveal, finalLines, roster, orderAsOf }: BodyProps) {
  const { user } = useAuth();
  if (status === 'error') {
    return (
      <PhasePlaceholder title="Matchup" icon={() => <Icon name="alert" size="title" tone="text2" />} heading="Couldn't load this matchup" message="Pull down to try again." onRefresh={onRefresh} />
    );
  }
  if (status === 'no-league') return null;
  // S-6: the scoreboard's and roster's shape while loading, never a made-up number.
  if (status === 'loading' || !derived || !user) return <MatchupSkeleton />;

  const { view, live, final, week } = derived;
  const youName = live.me.name;

  if (view.kind === 'not_started') {
    return <PhasePlaceholder title="Matchup" icon={() => <Icon name="trophy" size="title" tone="text2" />} heading="Not started yet" message="Your matchups start when the draft is done." onRefresh={onRefresh} />;
  }

  if (view.kind === 'pre_season') {
    // Before the season: the pairing with both totals at $0.00, and when it starts.
    return (
      <View style={styles.stack}>
        <Scoreboard you={{ name: youName, gain: 0 }} opponent={{ name: live.opp?.name ?? '', gain: 0 }} showLine={false} />
        <Text variant="callout" tone="secondary" style={styles.center}>{preSeasonStartsLabel(phase && phase.kind === 'pre_season' ? phase.seasonStartsAt : null)}</Text>
      </View>
    );
  }

  if (view.kind === 'bye') {
    return <Text variant="callout" tone="secondary">{COPY.byeNoResult}</Text>;
  }

  if (view.kind === 'playoff_bye' || view.kind === 'playoff_pending' || view.kind === 'eliminated' || view.kind === 'missed_playoffs') {
    const line =
      view.kind === 'playoff_bye' ? byeToRoundLabel(view.round)
      : view.kind === 'playoff_pending' ? playoffPendingLine(view.round)
      : view.kind === 'eliminated' ? eliminatedLabel(view.round)
      : "You didn't make the playoffs.";
    return <Text variant="callout" tone="secondary">{line}</Text>;
  }

  if (view.kind === 'complete') return null;

  if (view.kind === 'scoring' || (view.kind === 'final' && final === null)) {
    return <Text variant="callout" tone="secondary">{COPY.scoringLabel}</Text>;
  }

  const isFinal = view.kind === 'final';
  const mine = isFinal && final ? final.me : live.me.gain;
  const theirs = isFinal && final ? final.opp : live.opp?.gain ?? 0;
  const note = isFinal ? null : unpricedNote(live.me.unpriced.length);

  return (
    <View style={styles.stack}>
      {/* Mounted only once the reveal is decided: FinalBanner takes its start pose on mount. */}
      {isFinal && final && reveal.decided ? (
        <FinalBanner
          play={reveal.play}
          model={buildFinalBanner({
            week,
            me: final.me,
            opp: final.opp,
            youName,
            oppName: live.opp?.name ?? '',
            record: derived.myRecord,
            isPlayoff: phase?.kind === 'scored' ? phase.isPlayoff : false,
          })}
        />
      ) : null}
      <Scoreboard you={{ name: youName, gain: mine }} opponent={{ name: live.opp?.name ?? '', gain: theirs }} final={isFinal} />
      {/* Capped like the leads-by line: the totals stay loudest at XL. */}
      {note ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={LINE_MAX_SCALE}>{note}</Text> : null}
      {live.opp && raw ? (
        isFinal ? (
          finalLines.status === 'error' ? (
            <LoadFailure title="Couldn't load this matchup" message={MONEY_COPY.loadRetryMessage} onRetry={finalLines.retry} />
          ) : finalLines.status !== 'ready' ? (
            <RosterRowsSkeleton />
          ) : finalLines.mine?.ok && finalLines.theirs?.ok && finalLines.mine.rows && finalLines.theirs.rows ? (
            <Roster derived={derived} raw={raw} roster={roster} myRows={finalLines.mine.rows} theirRows={finalLines.theirs.rows} final seamResumesAt={null} orderAsOf={orderAsOf} />
          ) : null
        ) : (
          <Roster derived={derived} raw={raw} roster={roster} myRows={live.me.lineup} theirRows={live.opp.lineup} final={false} seamResumesAt={phase?.kind === 'live_closed' ? phase.resumesAt : null} orderAsOf={orderAsOf} />
        )
      ) : null}
    </View>
  );
}

/** The roster and the player card it opens. */
function Roster({ derived, raw, roster, myRows, theirRows, final, seamResumesAt, orderAsOf }: {
  derived: MatchupDerived;
  /** The last focus or pull-to-refresh: no close that settled after it may reorder. */
  orderAsOf: Date;
  /** Capture seam only: the Home fixture's next open (the shell fixture has no market row). */
  seamResumesAt: string | null;
  raw: HomeRawInputs;
  roster: RosterData;
  myRows: LineupRow[];
  theirRows: LineupRow[];
  final: boolean;
}) {
  const { user } = useAuth();
  const { market } = useLeagueContext();
  const stockSheet = useStockSheet();
  const opp = derived.live.opp!;
  const me = user!.id;
  const [selected, setSelected] = useState<{ side: 'me' | 'opp'; symbol: string } | null>(null);
  // The card stays mounted while it leaves, with the stock it was showing.
  const [shown, setShown] = useState<{ side: 'me' | 'opp'; symbol: string } | null>(null);
  const pendingSell = useRef<{ symbol: string; name: string } | null>(null);
  const seasonBars = useStockChartData(shown?.symbol ?? '', !!shown && !SEAM_ON);

  const cw = raw.data.current_week;
  const sides = useMemo(() => {
    const mineIn: RosterSideInput = { userId: me, lineup: myRows, snapshots: toLiveSnapshots(cw.my_snapshots), trades: toLiveTrades(cw.my_trades) };
    const theirIn: RosterSideInput = { userId: opp.userId, lineup: theirRows, snapshots: toLiveSnapshots(cw.opponent_snapshots), trades: toLiveTrades(cw.opponent_trades) };
    return { me: mineIn, opp: theirIn };
  }, [me, opp.userId, myRows, theirRows, cw]);

  const now = raw.now;
  const sessions = useMemo(() => {
    const win = derived.weekEnd ? resolveWeekWindow(derived.weekEnd, raw.marketCalendar) : null;
    return win ? weekSessions(win.weekStart, win.weekEnd, raw.marketCalendar) : [];
  }, [derived.weekEnd, raw.marketCalendar]);
  // The order's clock: the week's closes so far, latest first. The roster orders by the
  // latest one SETTLED in the fetched bars (matchupRoster.orderingClose) — never a quote,
  // never a bar fetched before its close. A final week reads Friday's.
  const closes = useMemo(() => closesBefore(now, sessions), [now, sessions]);
  // The final rows' percent is measured at the week's last close.
  const close = useMemo(() => lastWeekClose(now, sessions), [now, sessions]);
  // A row's percent: live, or at the week's close once final.
  const closeOn = close?.date ?? '';
  const rowPrice = (symbol: string) => (final ? raw.bars[symbol]?.find((b) => b.date === closeOn)?.close ?? raw.quote(symbol) : raw.quote(symbol));

  const ready = roster.ledgerStatus === 'ready' && roster.slots.status === 'ready' && roster.ledger;
  const groups = useMemo(() => {
    if (!ready || !roster.ledger) return null;
    return buildRosterView({
      me: sides.me,
      opp: sides.opp,
      activity: roster.ledger.activity,
      names: roster.ledger.symbol_names,
      slots: roster.slots.slots,
      slotOf: roster.slots.bySide,
      closes,
      bars: raw.bars,
      // raw.now is stamped when the fetch (bars included) returns; the order never runs ahead
      // of the last focus or pull-to-refresh, so a poll can't reorder under your eyes.
      barsAt: orderBarsAt(raw.now, orderAsOf, SEAM_ON),
    });
  }, [ready, roster.ledger, roster.slots, sides, closes, raw, orderAsOf]);

  // The card's data for the stock it's showing (null: no opening event in the ledger).
  const card = useMemo(() => {
    if (!shown || !roster.ledger) return null;
    const side = shown.side === 'me' ? sides.me : sides.opp;
    const row = side.lineup.find((r) => r.symbol.toUpperCase() === shown.symbol);
    const price = rowPrice(shown.symbol);
    if (!row || price == null) return null;
    const data = playerCardData({
      symbol: shown.symbol,
      company: roster.ledger.symbol_names[shown.symbol] ?? '',
      userId: side.userId,
      activity: roster.ledger.activity,
      snapshots: side.snapshots,
      trades: side.trades,
      weekGain: row.cents / 100,
      price,
      bars: raw.bars[shown.symbol] ?? [],
      seasonBars: SEAM_ON ? fixtureSeasonBars(shown.symbol) : seasonBars.status === 'ready' ? seasonBars.bars : null,
      sessions,
      now,
    });
    if (!data) return null;
    const slotId = roster.slots.bySide[side.userId]?.[shown.symbol] ?? null;
    const pill = cardSlotPill(roster.slots.slots.find((s) => s.id === slotId) ?? null);
    return { data, pill };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, roster.ledger, roster.slots, sides, seasonBars, sessions, now, raw, final]);

  // Sell is live only while the market is open (the trade gate fails closed); the capture
  // seam plays the Home fixture's own market.
  const gate = decideTradeGate(new Date(), market);
  const marketOpen = SEAM_ON ? derived.view.kind === 'scoreboard' && !derived.view.closed : gate.open;
  const opens = marketOpensLabel(SEAM_ON ? seamResumesAt : market?.next_open_at ?? null);

  if (roster.ledgerStatus === 'error' || roster.slots.status === 'error') {
    return <LoadFailure title="Couldn't load this matchup" message={MONEY_COPY.loadRetryMessage} onRetry={roster.retry} />;
  }
  if (!groups) return <RosterRowsSkeleton />;

  const open = (side: 'me' | 'opp', symbol: string) => {
    setSelected({ side, symbol });
    setShown({ side, symbol });
  };
  // A half opens the card only when the card can be whole (the ledger names how the stock
  // was got, and it has a price); otherwise it isn't pressable at all — never a dead tap.
  const activity = roster.ledger?.activity ?? [];
  const openable = (side: 'me' | 'opp', symbol: string) =>
    openingOf(side === 'me' ? me : opp.userId, symbol, activity) !== null && rowPrice(symbol) != null;
  const half = (side: 'me' | 'opp', c: { symbol: string; company: string; weekGain: number; weekPct: number } | null) =>
    c ? { ticker: c.symbol, company: c.company, weekGain: c.weekGain, weekPct: c.weekPct, onPress: openable(side, c.symbol) ? () => open(side, c.symbol) : undefined } : null;

  let ownership: PlayerCardOwnership | null = null;
  if (card && shown) {
    if (shown.side === 'opp') {
      // No watchlist exists in the app yet, so there's nothing to save to: Save is not drawn.
      ownership = { owner: { name: opp.name }, save: null };
    } else if (card.data.held > 0) {
      ownership = {
        owner: 'you',
        onSell: () => {
          // The stock sheet (Sell selected for a held stock) opens once the card has left.
          pendingSell.current = { symbol: card.data.ticker, name: card.data.company };
          setSelected(null);
        },
      };
    } else {
      ownership = { owner: 'you', sold: true };
    }
  }

  return (
    <View style={styles.roster}>
      {groups.map((g, gi) => (
        <Fragment key={g.label ?? `group-${gi}`}>
          {g.label ? <GroupHead label={g.label} /> : null}
          {g.rows.map((r, ri) => (
            <RosterRow
              key={`${r.left?.symbol ?? '-'}|${r.right?.symbol ?? '-'}|${ri}`}
              left={half('me', r.left)}
              right={half('opp', r.right)}
              opponentName={opp.name}
            />
          ))}
        </Fragment>
      ))}
      {card && ownership ? (
        <PlayerCard
          {...card.data}
          {...ownership}
          {...(card.pill ?? {})}
          visible={selected !== null}
          onClose={() => setSelected(null)}
          onClosed={() => {
            setShown(null);
            const sell = pendingSell.current;
            pendingSell.current = null;
            if (sell) stockSheet.open(sell.symbol, { name: sell.name });
          }}
          marketOpen={marketOpen}
          opens={opens}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[5] },
  // The board: rows 6pt apart (8 on the 4pt scale), separated by space, never a line.
  roster: { gap: space[3] },
  center: { textAlign: 'center' },
  bye: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5], paddingVertical: space[4] },
  byeName: { flex: 1, minWidth: 0, fontWeight: '600' },
  byeNameMine: { fontWeight: YOUR_NAME_WEIGHT },
});
