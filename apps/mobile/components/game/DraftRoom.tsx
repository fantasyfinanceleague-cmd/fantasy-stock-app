/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { useTheme } from '@/components/sp/ThemeProvider';
import { space } from '@/constants/tokens';
import SymbolSearchField from '@/components/SymbolSearchField';
import { supabase } from '@/lib/supabase';
import { seamInvoke } from '@/lib/game/seamCalls';
import type { ShapedSearchResult } from '@/lib/symbolSearch';
import { useDraftRoom } from '@/lib/game/useDraftRoom';
import { QueueEditor } from './QueueEditor';
import { DRAFT_ROOM_LOAD_FAILED, QUEUE_LOAD_FAILED } from '@/lib/game/draftQueueRead';
import { managerAtPick, boardRows } from '@/lib/game/draftBoard';
import { pickClockLabel, pickRowView, pickRefusalLine, pickRefusalNextStep, picksUntilYouLine, roundPickLine } from '@/lib/game/draftRoom';
import { picksUntilTurn } from '@/lib/home/draftTurn';
import { readFunctionRefusal } from '@/lib/functionRefusal';
import { turnState } from '@/lib/game/draftRefusals';

export interface DraftRoomProps {
  leagueId: string;
  myUserId: string;
  rounds: number;
  /** The stalled-turn card's line differs for the commissioner (board "Draft paused"). */
  isCommissioner?: boolean;
}

/** The draft room (3c, key screen 4): the clock, the snake board, the pick log,
 * search and the one-tap Draft, and the auto-pick backstop. A legacy SKIP row is
 * a plain row with a dash. Nothing is shown as a pick that the server did not
 * record. */
export function DraftRoom({ leagueId, myUserId, rounds, isCommissioner = false }: DraftRoomProps) {
  const { colors } = useTheme();
  const room = useDraftRoom(leagueId);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<{ line: string; next: string | null } | null>(null);
  const owned = useMemo(() => new Set(Array.from(room.picks.values()).map((p) => p.symbol.toUpperCase())), [room.picks]);

  const m = room.order.length;
  const totalPicks = m * rounds;
  const onClockPick = room.pickCount + 1;
  const onClockManager = m > 0 ? managerAtPick(onClockPick, room.order) : null;
  const isMyTurn = onClockManager === myUserId;
  const round = m > 0 ? Math.floor((onClockPick - 1) / m) + 1 : 0;
  const nameOf = (id: string | null) => (id && room.names[id]?.name) || '';
  const draftDone = m > 0 && room.pickCount >= totalPicks;
  // UX rule 10: how far away your next pick is (the snake, from Home's draftTurn).
  const picksAway = m > 0 && myUserId ? picksUntilTurn(room.order, room.pickCount, rounds, myUserId) : -1;

  // The auto-pick backstop (D3): past the deadline, the server is asked once, with
  // 0–3 s of jitter, to make the overdue pick. The server's deadline check and
  // idempotence decide; the room only shows what the server recorded.
  const autoAsked = useRef<number | null>(null);
  const [stalledAt, setStalledAt] = useState<number | null>(null);
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
        })
        .finally(() => refresh());
    }, jitter);
    return () => clearTimeout(t);
  }, [clock.kind, onClockPick, m, leagueId, refresh]);

  // Every pick is in, but the draft is not yet marked complete: the legacy route
  // runs the finalize heal (PR #20), so the room hands off to it, untouched.
  const handedOff = useRef(false);
  useEffect(() => {
    if (draftDone && room.draftStatus === 'in_progress' && !handedOff.current) {
      handedOff.current = true;
      router.push('/(tabs)/draft');
    }
  }, [draftDone, room.draftStatus]);

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
      // The board's "Pick refused" copy, with the stock the player tried; the
      // never-skips refusals add the next step (the clock keeps running).
      const reason = r.transport ? 'unknown' : r.reason ?? 'unknown';
      setRefusal({ line: pickRefusalLine(reason, { stock: selected }), next: pickRefusalNextStep(reason) });
      return;
    }
    setSelected(null);
    setSearch('');
    room.refresh();
  };

  if (room.status === 'error') {
    return (
      <Card>
        <Text variant="callout">{DRAFT_ROOM_LOAD_FAILED}</Text>
        <Button label="Try again" variant="secondary" size="sm" onPress={room.refresh} />
      </Card>
    );
  }
  if (room.status === 'loading' || m === 0) return null; // honest: nothing to draw until the order is read

  const rows = boardRows(room.order, rounds, room.picks, onClockPick);
  const log = Array.from(room.picks.entries()).sort((a, b) => b[0] - a[0]).slice(0, 8);
  const stalled = stalledAt === onClockPick ? turnState({ reason: 'stalled', pickNumber: onClockPick, managerName: nameOf(onClockManager), isCommissioner }) : null;
  const headline = stalled ? (stalled.label ?? '') : room.clock.kind === 'auto_picking' ? 'Auto-picking…' : isMyTurn ? "You're on the clock" : `${nameOf(onClockManager)} is up`;

  return (
    <View style={styles.stack}>
      <Card>
        {stalled?.tag ? <Text variant="tag" color={colors.liveText}>{stalled.tag}</Text> : null}
        <View style={styles.clockRow}>
          {room.clock.kind === 'last10' ? <LiveDot size={8} /> : null}
          <Text variant="headline" style={{ color: room.clock.kind === 'last10' ? colors.loss : colors.text }}>
            {pickClockLabel(room.clock)}
          </Text>
        </View>
        <Text variant="callout" style={isMyTurn ? { fontWeight: '700' } : undefined}>{headline}</Text>
        <Text variant="callout">{roundPickLine(round, rounds, onClockPick)}</Text>
        {!isMyTurn && picksUntilYouLine(picksAway) ? (
          <Text variant="callout" tone="secondary">{picksUntilYouLine(picksAway)}</Text>
        ) : null}
        <Text variant="caption" tone="secondary">{`${room.pickSeconds}-second picks`}</Text>
        {stalled?.line ? <Text variant="caption" tone="secondary">{stalled.line}</Text> : null}
      </Card>

      <Card>
        {rows.map((row, ri) => (
          <View key={ri} style={styles.boardRow}>
            {row.map((cell) => {
              const made = cell.symbol !== null ? pickRowView({ symbol: cell.symbol, source: cell.source ?? 'manual' }) : null;
              const auto = made?.auto === true;
              return (
                <View key={cell.pick} style={[styles.cell, cell.onClock ? { borderColor: colors.accent } : null]} accessible accessibilityLabel={made ? `Round ${cell.round}, pick ${cell.pick}, ${made.symbolLabel}` : `Round ${cell.round}, pick ${cell.pick}, open`}>
                  <Text variant="caption" tone="secondary">{cell.pick}</Text>
                  <Text variant="callout">{made ? made.symbolCell : ''}</Text>
                  {auto ? <Text variant="tag" tone="secondary">Auto</Text> : null}
                </View>
              );
            })}
          </View>
        ))}
      </Card>

      {isMyTurn ? (
        <Card>
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
          <Button label="Draft" onPress={draft} disabled={!selected || pending} />
          {refusal ? (
            <View accessibilityLiveRegion="polite" style={styles.refusal}>
              <Text variant="callout">{refusal.line}</Text>
              {refusal.next ? <Text variant="caption" tone="secondary">{refusal.next}</Text> : null}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Text variant="tag" tone="secondary">Latest picks</Text>
        {log.map(([pick, p]) => {
          const row = pickRowView({ symbol: p.symbol, source: p.source });
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
      {!draftDone && room.queue.status === 'ready' ? (
        <QueueEditor leagueId={leagueId} initial={room.queue.queue} onSaved={room.refresh} />
      ) : null}
      {!draftDone && room.queue.status === 'error' ? (
        <Card>
          <Text variant="callout">{QUEUE_LOAD_FAILED}</Text>
          <Button label="Try again" variant="secondary" size="sm" onPress={room.refresh} />
        </Card>
      ) : null}
      {draftDone ? <Text variant="caption" tone="secondary">Finishing the draft…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  refusal: { gap: space[1] },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  boardRow: { flexDirection: 'row', gap: space[1] },
  cell: { flex: 1, minHeight: 44, borderWidth: 1, borderColor: 'transparent', borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: space[1] },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[1] },
  logPick: { minWidth: 24, textAlign: 'right' },
});
