/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';
import { Text } from '@/components/sp/Text';
import { formatMoney } from '@/components/sp/logic/money';
import { useRouter } from 'expo-router';
import { ManagerRow, MANAGER_ROW_GAP } from '@/components/sp/gn';
import { teamHref, teamLinkLabel } from '@/lib/game/teamLink';
import { space } from '@/constants/tokens';
import { shouldPinYourRow, type StandingsRow } from '@/lib/game/standings';
import { useScrollFold } from '@/components/shell/scrollFold';
import { useMedalDiscSize } from '@/components/game/MedalDisc';
import { gainColumnWidth, MOVE_CELL, RANK_CELL, RECORD_PT, ROW_GAP, ROW_PAD, figureWidth, managerListStacks, stackedRowTextCap } from '@/lib/game/leagueView';

// League › Standings in full on Game Night (§9C; the board's "League › Standings, in full";
// Giorgio, on 1.2.0's table: "not even good like divide like dividing the columns and rows").
// Each manager a `surface` tile (ManagerRow), 6pt apart, divided by space, never by rules;
// your row tinted and ringed, your name bold, no "(you)" (S-10). Over the tiles, the
// board's column head: "#", "Through Week N" (hidden at N = 0), "W–L", "Season gain".
// The order is the server's (league_standings_ranked); nothing here re-sorts it.

export interface StandingsTableProps {
  rows: StandingsRow[];
  /** Board copy under the table, verbatim. */
  caption: string;
  /** Medals (§9A) show ONLY when the season is complete. */
  seasonComplete: boolean;
  /** UX rule 7: your row while it should be pinned at the bottom (else null). */
  onPinChange?: (row: StandingsRow | null) => void;
  /** Final standings (GS-4): "Final standings" with "After the playoffs" on the right. */
  header?: { title: string; subtitle: string };
  /** The ▲/▼ column. Off for final standings: the board's frame has none (GS-4/GS-5). */
  showMove?: boolean;
  /** The column head's "Through Week N", or null while nothing is scored (leagueView). */
  throughLabel?: string | null;
  /** Nothing scored yet (Week 1 before its first close): no rank leads, so every rank is text2. */
  nothingScored?: boolean;
}

/** The list's one shape (every row stacks or none does) and its caps, for the table and the
 * pinned copy of your row alike. */
export interface StandingsLayout {
  stacked: boolean;
  gainWidth: number;
  textCap: number;
  recordWidth: number;
  rankWidth: number;
}

export function useStandingsLayout(rows: readonly { record: string; seasonGain: number }[], showMove: boolean, medals: boolean): StandingsLayout {
  const { width, fontScale } = useWindowDimensions();
  const disc = useMedalDiscSize();
  return useMemo(() => {
    const rowWidth = width - space[6] * 2;
    const rankWidth = medals ? Math.max(RANK_CELL, disc) : RANK_CELL;
    const figures = rows.map((r) => ({ record: r.record, gainText: formatMoney(r.seasonGain, { sign: 'always' }) }));
    const stacked = managerListStacks({ rowWidth, fontScale, move: showMove, rows: figures, leading: rankWidth });
    // One cap for the list: the smallest row's fitted gain, so every name is the same size.
    const textCap = Math.min(1.3, ...figures.map((f) => stackedRowTextCap({ gainText: f.gainText, fontScale, rowWidth, move: showMove, leading: rankWidth })));
    const recordWidth = Math.ceil(Math.max(0, ...rows.map((r) => figureWidth(r.record, RECORD_PT * Math.max(1, fontScale)))));
    return { stacked, textCap, recordWidth, rankWidth, gainWidth: gainColumnWidth(fontScale) };
  }, [rows, showMove, medals, width, fontScale, disc]);
}

/** One standings row (also the pinned copy of yours: the SAME component). */
export function StandingsRowView({ r, seasonComplete, showMove = true, layout, nothingScored = false }: { r: StandingsRow; seasonComplete: boolean; showMove?: boolean; layout: StandingsLayout; nothingScored?: boolean }) {
  const router = useRouter();
  // A manager's row opens their team (yours: your Portfolio), as in ESPN / Sleeper / Yahoo.
  const href = teamHref({ userId: r.userId, name: r.name, isYou: r.isYou });
  // VoiceOver hears the move as the row's own label says it (ManagerRow: "up 2" / "down 3").
  return (
    <ManagerRow
      onPress={href ? () => router.push(href) : undefined}
      hint={href ? teamLinkLabel({ name: r.name, isYou: r.isYou }) : undefined}
      rank={r.rank}
      delta={showMove ? r.move : null}
      showMove={showMove}
      name={r.name}
      isYou={r.isYou}
      record={r.record}
      seasonGain={r.seasonGain}
      medal={seasonComplete}
      // GS-4's "Champion" / "Runner-up" under the name; "Bot" for a test bot (as before).
      tag={r.tag ?? (r.isBot ? 'Bot' : null)}
      stacked={layout.stacked}
      textCap={layout.textCap}
      recordWidth={layout.recordWidth}
      gainWidth={layout.gainWidth}
      rankLeads={!nothingScored}
    />
  );
}

/** UX rule 7: while your row is below the fold of the scroll view it sits in
 * (useScrollFold, from BarsRefresh) and the list is on screen, onPinChange gets your row so
 * the screen can pin a copy at the bottom; null when it shouldn't. */
export function StandingsTable({ rows, caption, seasonComplete, onPinChange, header, showMove = true, throughLabel = null, nothingScored = false }: StandingsTableProps) {
  const fold = useScrollFold();
  const cardRef = useRef<View>(null);
  const yourRef = useRef<View>(null);
  const pinned = useRef<boolean>(false);
  const layout = useStandingsLayout(rows, showMove, seasonComplete);
  const you = rows.find((r) => r.isYou) ?? null;
  // The latest row for the callback; the effect re-subscribes only when your row changes.
  const youRef = useRef(you);
  youRef.current = you;
  const youKey = you ? `${you.userId}:${you.rank}:${rows.length}` : null;

  useEffect(() => {
    if (!fold || !onPinChange || !youKey) return;
    const check = () => {
      const vp = fold.viewport();
      if (!vp || !cardRef.current || !yourRef.current) return;
      cardRef.current.measureInWindow((_cx, cy, _cw, ch) => {
        yourRef.current?.measureInWindow((_rx, ry, _rw, rh) => {
          const pin = shouldPinYourRow({ rowTop: ry, rowBottom: ry + rh, cardTop: cy, cardBottom: cy + ch, viewTop: vp.top, viewBottom: vp.bottom });
          if (pin !== pinned.current) {
            pinned.current = pin;
            onPinChange(pin ? youRef.current : null);
          }
        });
      });
    };
    check();
    const off = fold.subscribe(check);
    return () => {
      off();
      if (pinned.current) {
        pinned.current = false;
        onPinChange(null);
      }
    };
  }, [fold, onPinChange, youKey]);

  return (
    <View ref={cardRef} collapsable={false} style={styles.block}>
      {header ? (
        <View style={styles.header}>
          <Text variant="headline" style={styles.headerTitle} accessibilityRole="header">{header.title}</Text>
          <Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6}>{header.subtitle}</Text>
        </View>
      ) : null}
      {/* The board's column head, on the rows' own grid. Decorative for VoiceOver: each row
          already reads its rank, record and season gain. */}
      <View style={styles.head} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <HeadLabel text="#" style={[{ width: layout.rankWidth }, seasonComplete ? styles.headRank : null]} />
        {showMove ? <View style={{ width: MOVE_CELL }} /> : null}
        {/* The label starts over the avatar column, so "Through Week 14" fits beside the
            W–L and Season gain heads (it truncated over the names alone, W4 capture). */}
        <Text variant="caption" tone="secondary" numberOfLines={1} maxFontSizeMultiplier={HEAD_MAX_SCALE} style={styles.headLabel}>{throughLabel ?? ''}</Text>
        {layout.stacked ? null : (
          <>
            <HeadLabel text="W–L" style={[styles.headRight, { minWidth: layout.recordWidth }]} />
            <HeadLabel text="Season gain" style={[styles.headRight, { minWidth: layout.gainWidth }]} />
          </>
        )}
      </View>
      <View style={styles.rows}>
        {rows.map((r) => (
          <View key={r.userId} ref={r.isYou ? yourRef : undefined} collapsable={false}>
            <StandingsRowView r={r} seasonComplete={seasonComplete} showMove={showMove} layout={layout} nothingScored={nothingScored} />
          </View>
        ))}
      </View>
      {/* Capped at 1.6× (19.2pt) so the line under the list never outgrows the rows' gains (19.5pt). */}
      <Text variant="caption" tone="secondary" maxFontSizeMultiplier={1.6} style={styles.caption}>{caption}</Text>
    </View>
  );
}

/** The column head's caps: the board's `.dr-tag` at NORMAL width (not the Expanded `tag`
 * face, which made "SEASON GAIN" wider than its column), the PlayerCard's label: caption
 * 12/800, uppercased in the string (§9C: never textTransform), one line. */
const HEAD_MAX_SCALE = 1.3;
function HeadLabel({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant="caption" tone="secondary" numberOfLines={1} maxFontSizeMultiplier={HEAD_MAX_SCALE} style={[styles.headCaps, style]}>
      {text.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  block: { gap: space[3] },
  // The board's .ks-section-h: the title left, the caption right, on one baseline; wraps at large text.
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: space[3] },
  headerTitle: { fontWeight: '700' },
  // The head sits on the tiles' grid: their 12pt padding and 8pt gaps.
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: ROW_GAP, paddingHorizontal: ROW_PAD },
  headRank: { textAlign: 'center' },
  headLabel: { flex: 1, minWidth: 0 },
  headCaps: { fontWeight: '800', letterSpacing: 0.48 },
  headRight: { textAlign: 'right' },
  // §9C ManagerRow: tiles 6pt apart.
  rows: { gap: MANAGER_ROW_GAP },
  caption: { marginTop: space[1] },
});
