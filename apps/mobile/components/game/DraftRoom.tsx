/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View, StyleSheet } from 'react-native';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { radius, space } from '@/constants/tokens';
import SymbolSearchField from '@/components/SymbolSearchField';
import { supabase } from '@/lib/supabase';
import { seamInvoke } from '@/lib/game/seamCalls';
import type { ShapedSearchResult } from '@/lib/symbolSearch';
import { useDraftRoom } from '@/lib/game/useDraftRoom';
import { useTurnChime } from '@/lib/game/useTurnChime';
import { QueueEditor } from './QueueEditor';
import { DRAFT_ROOM_LOAD_FAILED, QUEUE_LOAD_FAILED } from '@/lib/game/draftQueueRead';
import { managerAtPick, boardHeader, boardRows } from '@/lib/game/draftBoard';
import { PICK_SENDING, YOUR_ROSTER, afterPickLine, budgetLeft, isAutoPick, myDraftedSoFar, pickClockLabel, pickRowView, pickRefusalView, AUTO_PICK_WAITING_FOR_PRICES, picksUntilYouLine, rosterCaption, roundPickLine, snakeThenPick, liveClock } from '@/lib/game/draftRoom';
import { TeamSoFarGrid } from '@/components/home/TeamSoFarGrid';
import { DraftRoomSkeleton } from '@/components/game/LoadingSkeletons';
import { DraftComplete } from '@/components/game/DraftComplete';
import { FINALIZE_GRACE_MS, myRosterPicks, shouldHandOffToFinalize, weekOneIsBye, weekOneLine, weekOneRealStart } from '@/lib/game/draftComplete';
import { useWeekOne } from '@/lib/game/useWeekOne';
import type { MarketCalendarSession } from '@/lib/time/marketWeek';
import { picksUntilTurn } from '@/lib/home/draftTurn';
import { readFunctionRefusal } from '@/lib/functionRefusal';
import { ownPickClockQuiet, setForegroundQuiet } from '@/lib/foregroundQuiet';
import { useIsFocused } from '@react-navigation/native';
import { turnState } from '@/lib/game/draftRefusals';
import { TURN_SIGNAL_START, flashSteps, flashTextAtStepStart, nextLastTenBuzz, nextTurnSignal } from '@/lib/game/yourTurn';

export interface DraftRoomProps {
  leagueId: string;
  myUserId: string;
  rounds: number;
  /** The stalled-turn card's line differs for the commissioner (board "Draft paused"). */
  isCommissioner?: boolean;
  /** leagues.stake_mode / budget_amount / notional_per_slot: the roster strip's
   * caption ("· $2,000 per slot", or "· $1,240 left" in a budget-cap league). */
  stakeMode?: string | null;
  budgetAmount?: number | null;
  notionalPerSlot?: number | null;
  /** The market calendar (LeagueContext): Week 1's real open for the ending. */
  marketCalendar?: MarketCalendarSession[];
  /** The last pick landed: the host keeps the room (its ending) on screen after the server finishes the draft. */
  onEnding?: () => void;
  /** "See your Week 1 matchup", or on a bye "See Week 1's matchups" (`all`: open All matchups). */
  onSeeMatchup?: (opts: { all: boolean }) => void;
}

/** The draft room (3c, key screen 4): the clock, the snake board, the pick log,
 * search and the one-tap Draft, and the auto-pick backstop. A legacy SKIP row is
 * a plain row with a dash. Nothing is shown as a pick that the server did not
 * record. */
export function DraftRoom({ leagueId, myUserId, rounds, isCommissioner = false, stakeMode = null, budgetAmount = null, notionalPerSlot = null, marketCalendar = [], onEnding, onSeeMatchup }: DraftRoomProps) {
  const { colors } = useTheme();
  const room = useDraftRoom(leagueId);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<{ line: string; next: string | null; checking?: boolean } | null>(null);
  const owned = useMemo(() => new Set(Array.from(room.picks.values()).map((p) => p.symbol.toUpperCase())), [room.picks]);

  const m = room.order.length;
  const totalPicks = m * rounds;
  const onClockPick = room.pickCount + 1;
  const onClockManager = m > 0 ? managerAtPick(onClockPick, room.order) : null;
  const isMyTurn = onClockManager === myUserId;
  const round = m > 0 ? Math.floor((onClockPick - 1) / m) + 1 : 0;
  const nameOf = (id: string | null) => (id && room.names[id]?.name) || '';
  const draftDone = m > 0 && room.pickCount >= totalPicks;
  // UX rule 11: no foreground banners while YOUR pick clock runs (the room shows it).
  // Only while the room is ON SCREEN (your-turn spec): tabs stay mounted, so mounted isn't on screen.
  const roomOnScreen = useIsFocused();
  const quiet = ownPickClockQuiet(isMyTurn, room.clock.kind, roomOnScreen);

  // The clock ticks between reads (liveClock): the reading counted down from when it
  // arrived. Display only: the auto-pick backstop below still keys on the server's reading.
  const [readAt, setReadAt] = useState(() => Date.now());
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = Date.now();
    setReadAt(t);
    setNowMs(t);
  }, [room.clock]);
  const ticking = room.clock.kind === 'on_clock' || room.clock.kind === 'last10';
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const shownClock = liveClock(room.clock, nowMs - readAt);
  useEffect(() => {
    setForegroundQuiet('own_pick_clock', quiet);
    return () => setForegroundQuiet('own_pick_clock', false);
  }, [quiet]);

  // Your turn, unmissable (lib/game/yourTurn; the Design Lead's spec). The signal keys on
  // the server's reading (room.clock), once per turn; the first reading only records, so a
  // re-opened room doesn't replay it. The haptic and the chime fire whenever the app is in
  // front; the flash only while the room is on screen, and never with Reduce Motion.
  const { reduced } = useMotion();
  const playChime = useTurnChime();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setAppActive(next === 'active'));
    return () => sub.remove();
  }, []);
  const myTurnPick = room.status === 'ready' && !draftDone && isMyTurn && (room.clock.kind === 'on_clock' || room.clock.kind === 'last10') ? onClockPick : null;
  const turnSignal = useRef(TURN_SIGNAL_START);
  const flash = useSharedValue(0);
  const [flashLit, setFlashLit] = useState(false);
  useEffect(() => () => cancelAnimation(flash), [flash]);
  useEffect(() => {
    if (room.status !== 'ready') return;
    const next = nextTurnSignal(turnSignal.current, { myTurnPick, appActive });
    turnSignal.current = next.state;
    if (!next.fire) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    playChime();
    const steps = roomOnScreen ? flashSteps(reduced) : [];
    if (steps.length === 0) return;
    // The text follows the animation's own steps (flashTextAtStepStart): each step's end
    // applies the next step's switch, and the last step's end returns the text to rest.
    const atStart = flashTextAtStepStart(steps);
    if (atStart[0] !== null) setFlashLit(atStart[0]);
    flash.value = 0;
    const [first, ...rest] = steps.map((st, i) => {
      const lit = i + 1 < steps.length ? atStart[i + 1] : false;
      return withTiming(st.to, { duration: st.ms }, () => {
        'worklet';
        if (lit !== null) runOnJS(setFlashLit)(lit);
      });
    });
    flash.value = withSequence(first, ...rest);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on the turn reading only; focus and Reduce Motion are read at that moment
  }, [myTurnPick, appActive, room.status]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  // The last 10 s: one more Warning haptic, once per turn (no sound, no second flash).
  const lastTenBuzzed = useRef<number | null>(null);
  useEffect(() => {
    const r = nextLastTenBuzz(lastTenBuzzed.current, { myTurnPick, secondsLeft: shownClock.secondsLeft, appActive });
    lastTenBuzzed.current = r.buzzedPick;
    if (r.buzz) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [myTurnPick, shownClock.secondsLeft, appActive]);

  // UX rule 9: "Checking…" clears once the re-read board arrives (it speaks for itself).
  useEffect(() => {
    setRefusal((cur) => (cur?.checking ? null : cur));
  }, [room.picks]);

  // U-06: the board's roster strip (Home's grid), "1 of 6 · $2,000 per slot" or, in a budget-cap league, what's left.
  const mine = myDraftedSoFar(room.picks, room.order, myUserId);
  const caption = rosterCaption(mine.symbols.length, rounds, { stakeMode, notionalPerSlot, budgetLeft: budgetLeft(budgetAmount, mine.prices) });
  // UX rule 10: how far away your next pick is (the snake, from Home's draftTurn).
  const picksAway = m > 0 && myUserId ? picksUntilTurn(room.order, room.pickCount, rounds, myUserId) : -1;

  // The auto-pick backstop (D3): past the deadline, the server is asked once, with
  // 0–3 s of jitter, to make the overdue pick. The server's deadline check and
  // idempotence decide; the room only shows what the server recorded.
  const autoAsked = useRef<number | null>(null);
  const [stalledAt, setStalledAt] = useState<number | null>(null);
  const [waitingForPrices, setWaitingForPrices] = useState<number | null>(null);
  const { refresh, clock } = room;
  useEffect(() => {
    if (clock.kind !== 'auto_picking' || m === 0) return;
    if (autoAsked.current === onClockPick) return;
    autoAsked.current = onClockPick;
    const jitter = Math.floor(Math.random() * 3000);
    const t = setTimeout(() => {
      void seamInvoke('validate-and-record-pick', { body: { league_id: leagueId, action: 'auto_pick', pick_number: onClockPick } })
        .then(async ({ data, error }) => {
          // A stalled turn (auto-pick found no legal stock) is shown as waiting, never as a pick.
          // readFunctionRefusal: the reason survives a non-2xx too (error.context's body).
          const r = await readFunctionRefusal(data, error);
          if (!r.transport && (r.reason === 'stalled' || r.body.reason === 'stalled')) setStalledAt(onClockPick);
          // The audit's Rule 8 table: auto-pick is waiting for prices (shown in the clock card).
          setWaitingForPrices(!r.transport && (r.reason === 'price_unavailable' || r.body.reason === 'price_unavailable') ? onClockPick : null);
        })
        .finally(() => refresh());
    }, jitter);
    return () => clearTimeout(t);
  }, [clock.kind, onClockPick, m, leagueId, refresh]);

  // The draft's ending (U-10). The last pick's realtime insert reaches the room
  // before the server's finalize (in that pick's own request) flips draft_status,
  // so the room re-reads after a grace window and hands off to the legacy
  // finalize heal (PR #20) only if the draft is STILL full and not completed.
  const handedOff = useRef(false);
  const stuck = draftDone && room.draftStatus === 'in_progress';
  const [fullSince, setFullSince] = useState<number | null>(null);
  useEffect(() => {
    setFullSince((t) => (stuck ? (t ?? Date.now()) : null));
  }, [stuck]);
  useEffect(() => {
    if (fullSince === null || handedOff.current) return;
    const t = setTimeout(refresh, Math.max(0, fullSince + FINALIZE_GRACE_MS - Date.now()));
    return () => clearTimeout(t);
  }, [fullSince, refresh]);
  useEffect(() => {
    if (stuck && !handedOff.current && shouldHandOffToFinalize(fullSince, Date.now())) {
      handedOff.current = true;
      router.push('/(tabs)/draft');
    }
  }, [stuck, fullSince, room.picks]);
  useEffect(() => {
    if (draftDone) onEnding?.();
  }, [draftDone, onEnding]);
  const finished = room.draftStatus === 'completed';
  const weekOne = useWeekOne(leagueId, myUserId, draftDone && finished);

  const onSelect = (r: ShapedSearchResult) => {
    if (!r.selectable) return;
    setSelected(r.symbol.toUpperCase());
    setSearch(r.symbol.toUpperCase());
    setRefusal(null);
  };

  const draft = async () => {
    if (!selected || !isMyTurn || pending) return;
    setPending(true);
    setRefusal(null);
    const { data, error } = await seamInvoke('validate-and-record-pick', { body: { league_id: leagueId, symbol: selected } });
    setPending(false);
    // readFunctionRefusal: a 2xx { ok:false, reason } AND a non-2xx body (rate_limited 429,
    // not_a_member 403 …, read from error.context) both reach their own line.
    const r = await readFunctionRefusal(data, error);
    if (r.transport || r.reason !== null) {
      // The audit's Rule 8 table (pickRefusalView): a server fault or no answer is
      // "Couldn't confirm your pick. Checking…" and a re-read (U-04: never "can't
      // be made"); a refusal gets its own line, and on your turn the shared next step.
      const v = pickRefusalView(r.transport ? null : r.reason, r.transport ? null : r.status, {
        stock: selected,
        manager: nameOf(onClockManager),
        isMyTurn,
      });
      setRefusal({ line: v.line, next: v.next, checking: v.checking });
      if (v.refresh) room.refresh();
      return;
    }
    // U-09: the clock card's "You took …" line comes from the re-read board (what
    // the server recorded), not from this answer.
    setSelected(null);
    setSearch('');
    room.refresh();
  };

  if (room.status === 'error') {
    return (
      <Card style={styles.card}>
        <Text variant="callout">{DRAFT_ROOM_LOAD_FAILED}</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={room.refresh} />
      </Card>
    );
  }
  // UX rule 9: loading shows the room's shape; a loaded room with no order draws nothing.
  if (room.status === 'loading') return <DraftRoomSkeleton />;
  if (m === 0) return null; // honest: nothing to draw until the order is read
  if (draftDone) {
    return (
      <DraftComplete
        roster={myRosterPicks(room.picks, room.order, myUserId)}
        caption={caption}
        finished={finished}
        weekLine={weekOneLine(weekOneRealStart(weekOne?.weekStart, marketCalendar), weekOne?.opponentId ? nameOf(weekOne.opponentId) : null, weekOneIsBye(weekOne))}
        bye={weekOneIsBye(weekOne)}
        onSeeMatchup={() => onSeeMatchup?.({ all: weekOneIsBye(weekOne) })}
      />
    );
  }

  const rows = boardRows(room.order, rounds, room.picks, onClockPick);
  const log = Array.from(room.picks.entries()).sort((a, b) => b[0] - a[0]).slice(0, 8);
  const stalled = stalledAt === onClockPick ? turnState({ reason: 'stalled', pickNumber: onClockPick, managerName: nameOf(onClockManager), isCommissioner }) : null;
  const lastMine = mine.symbols.length > 0 ? mine.symbols[mine.symbols.length - 1] : null;
  const lastMineAuto = mine.sources.length > 0 && isAutoPick(mine.sources[mine.sources.length - 1]);
  // Your turn, really yours (not stalled, not the auto-pick running): the screen's one emphasis (G-2).
  const onTheClock = isMyTurn && !stalled && shownClock.kind !== 'auto_picking';
  // The flash: EVERY line on the card is navy (on-live) while the gold is up (the spec's
  // "text in navy"); the clock and the title also switch their own colours below.
  const flashInk = onTheClock && flashLit ? colors.onLive : undefined;
  const headline = stalled ? (stalled.label ?? '') : shownClock.kind === 'auto_picking' ? 'Auto-picking…' : isMyTurn ? "You're on the clock" : `${nameOf(onClockManager)} is up`;

  return (
    <View style={styles.stack}>
      {/* Your turn at rest (the spec): warn-tint over the surface, a 2 pt live border, the
          44 pt clock, and "You're on the clock" as the largest text on screen. The flash is
          a live-gold layer over the tint, under the text; it never takes a touch. */}
      <Card style={[styles.card, onTheClock ? [styles.yourTurnCard, { borderColor: colors.live }] : null]}>
        {onTheClock ? <View testID="your-turn-tint" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.warnTint }]} /> : null}
        {onTheClock ? <Animated.View testID="your-turn-flash" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.live }, flashStyle]} /> : null}
        {stalled?.tag ? <Text variant="tag" color={colors.liveText}>{stalled.tag}</Text> : null}
        <View style={styles.clockRow}>
          {shownClock.kind === 'last10' ? <LiveDot size={8} /> : null}
          {/* G-2 (rule 6): on your turn the clock is score type; loss in the last 10 s either way. */}
          <Text
            variant={onTheClock ? 'score.lg' : 'headline'}
            style={[onTheClock ? styles.yourTurnClock : null, { color: onTheClock && flashLit ? colors.onLive : shownClock.kind === 'last10' ? colors.loss : colors.text }]}
          >
            {pickClockLabel(shownClock)}
          </Text>
        </View>
        {onTheClock ? (
          <Text variant="display" style={styles.yourTurnTitle} color={flashLit ? colors.onLive : colors.liveText} accessibilityRole="header">{headline}</Text>
        ) : (
          <Text variant="callout">{headline}</Text>
        )}
        <Text variant="callout" tone={isMyTurn ? undefined : 'secondary'} color={flashInk}>{roundPickLine(round, rounds, onClockPick, snakeThenPick(room.order, onClockPick, totalPicks))}</Text>
        {/* The board's "After the pick" state (U-09): once you have a recorded pick and are waiting. */}
        {!isMyTurn && lastMine && afterPickLine(lastMine, picksAway, lastMineAuto) ? (
          <Text variant="caption" color={colors.youText} accessibilityLiveRegion="polite">{afterPickLine(lastMine, picksAway, lastMineAuto)}</Text>
        ) : null}
        {!isMyTurn && !lastMine && picksUntilYouLine(picksAway) ? (
          <Text variant="callout" tone="secondary">{picksUntilYouLine(picksAway)}</Text>
        ) : null}
        <Text variant="caption" tone="secondary" color={flashInk}>{`${room.pickSeconds}-second picks`}</Text>
        {stalled?.line ? <Text variant="caption" tone="secondary">{stalled.line}</Text> : null}
        {waitingForPrices === onClockPick && !stalled ? <Text variant="caption" tone="secondary" color={flashInk}>{AUTO_PICK_WAITING_FOR_PRICES}</Text> : null}
      </Card>

      <Card style={styles.card}>
        {/* G-1 (rule 7): each column is a manager; yours in team blue. */}
        <View style={styles.boardRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {boardHeader(room.order, room.names, myUserId).map((h) => (
            <Text
              key={h.manager}
              variant="tag"
              color={h.you ? colors.youText : colors.text2}
              style={[styles.headCell, h.you ? styles.bold : null]}
              numberOfLines={1}
            >
              {h.initials}
            </Text>
          ))}
        </View>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.boardRow}>
            {row.map((cell) => {
              const made = cell.symbol !== null ? pickRowView({ symbol: cell.symbol, source: cell.source ?? 'manual' }) : null;
              const auto = made?.auto === true;
              // G-1: your picks in `you` (border + tint); the pick on the clock keeps its accent outline.
              const mine = cell.manager === myUserId;
              const cellStyle = [
                styles.cell,
                mine ? { borderColor: colors.you, backgroundColor: colors.youTint } : null,
                // G-11 (ruled): the clock's own colour, live, at 2 pt in both themes; in Light
                // accent === you, so an accent outline vanished in your own column.
                cell.onClock ? { borderColor: colors.live, borderWidth: 2 } : null,
              ];
              const who = mine ? 'your pick' : null;
              return (
                <View key={cell.pick} style={cellStyle} accessible accessibilityLabel={[`Round ${cell.round}, pick ${cell.pick}`, who, made ? made.symbolLabel : 'open'].filter(Boolean).join(', ')}>
                  <Text variant="caption" tone={mine ? undefined : 'secondary'} color={mine ? colors.youText : undefined}>{cell.pick}</Text>
                  <Text variant="callout">{made ? made.symbolCell : ''}</Text>
                  {auto ? <Text variant="tag" tone="secondary">Auto</Text> : null}
                </View>
              );
            })}
          </View>
        ))}
      </Card>

      {isMyTurn ? (
        <Card style={[styles.card, styles.searchCard]}>
          <SymbolSearchField
            value={search}
            onChangeText={(t) => {
              setSearch(t);
              setSelected(null);
            }}
            onSelect={onSelect}
            selectedSymbol={selected ?? ''}
            ownedSymbols={owned}
          />
          <Button label={pending ? PICK_SENDING : 'Draft'} onPress={draft} disabled={!selected || pending} />
          {refusal ? (
            <View accessibilityLiveRegion="polite" style={styles.refusal}>
              <Text variant="callout">{refusal.line}</Text>
              {refusal.next ? <Text variant="caption" tone="secondary">{refusal.next}</Text> : null}
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Under the search results (board key screen 4). */}
      <TeamSoFarGrid title={YOUR_ROSTER} caption={caption} symbols={mine.symbols} numRounds={rounds} />

      <Card style={styles.card}>
        <Text variant="tag" tone="secondary">Latest picks</Text>
        {log.map(([pick, p]) => {
          // G-4: your own auto-pick reads "from your queue".
          const row = pickRowView({ symbol: p.symbol, source: p.source }, managerAtPick(pick, room.order) === myUserId);
          return (
            <View key={pick} style={styles.logRow}>
              <Text variant="caption" tone="secondary" style={styles.logPick}>{pick}</Text>
              <Text variant="callout">{row.symbolCell}</Text>
              {row.label ? <Text variant="caption" tone="secondary">{`· ${row.label}`}</Text> : null}
            </View>
          );
        })}
      </Card>

      {/* Never seeded from a failed read (draftQueueRead.ts): the save replaces the whole list. */}
      {room.queue.status === 'ready' ? (
        <QueueEditor leagueId={leagueId} initial={room.queue.queue} onSaved={room.refresh} />
      ) : null}
      {room.queue.status === 'error' ? (
        <Card style={styles.card}>
          <Text variant="callout">{QUEUE_LOAD_FAILED}</Text>
          <Button label="Try again" variant="secondary" size="sm" onPress={room.refresh} />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both; DraftCountdownCard's).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  // Your turn at rest: the 2 pt live border (colour set inline); the clock at 44 pt in score
  // type; the title at 30 pt in ExtraBold (no 900 normal-width face is loaded; flagged).
  yourTurnCard: { borderWidth: 2 },
  yourTurnClock: { fontSize: 44, lineHeight: 42 },
  yourTurnTitle: { fontSize: 30, lineHeight: 34 },
  // The sp Card clips (overflow hidden), which cut the search's dropdown off at the card edge;
  // a search card lets it overflow, above the cards that follow it.
  searchCard: { overflow: 'visible', zIndex: 10 },
  stack: { gap: space[3] },
  refusal: { gap: space[1] },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  boardRow: { flexDirection: 'row', gap: space[1] },
  headCell: { flex: 1, textAlign: 'center' },
  bold: { fontWeight: '700' },
  cell: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: 'transparent', borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: space[1] },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[1] },
  logPick: { minWidth: 24, textAlign: 'right' },
});
