/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { radius, space } from '@/constants/tokens';
import { moveA11y, shouldPinYourRow, type StandingsRow } from '@/lib/game/standings';
import { useScrollFold } from '@/components/shell/scrollFold';
import { yourNameStyle, yourRowTint, youA11y } from '@/lib/game/managerRow';
import { isLargeText } from '@/components/sp/logic/largeText';
import { MEDAL, MedalDisc, useMedalDiscSize } from '@/components/game/MedalDisc';

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
}

/** One standings row (also the pinned copy of yours: the SAME component). */
export function StandingsRowView({ r, seasonComplete, showMove = true }: { r: StandingsRow; seasonComplete: boolean; showMove?: boolean }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  // Large text: the name gets the row's width and the record and gain go under it (one
  // line, the name squeezed to a letter per line, capture pass 2026-10-08).
  const stacked = isLargeText(fontScale);
  const disc = useMedalDiscSize();
  const medal = seasonComplete ? MEDAL[r.rank] : undefined;
  const move = moveA11y(r.move);
  const stats = (
    <>
      <Text variant="caption" tone="secondary" style={stacked ? null : styles.record}>{r.record}</Text>
      <Text variant="callout" style={[stacked ? null : styles.gain, { color: r.seasonGain > 0 ? colors.gain : r.seasonGain < 0 ? colors.loss : colors.text }]}>{formatMoney(r.seasonGain, { sign: 'always' })}</Text>
    </>
  );
  return (
    <View style={[styles.row, yourRowTint(r.isYou, colors.youTint, 0)]} accessible accessibilityLabel={`${medal ? `${medal.label}, ` : ''}${r.rank}, ${r.name}${youA11y(r.isYou)}${r.tag ? `, ${r.tag}` : ''}, ${r.record}, season gain ${formatMoney(r.seasonGain, { sign: 'always' })}${move ? `, ${move}` : ''}`}>
      {/* G-6: one fixed-width rank cell, so medal rows 1–3 line up with 4 onwards. */}
      <View style={[styles.rankCell, { width: Math.max(28, disc + 8) }]}>
        {medal ? (
          <MedalDisc place={r.rank} size={disc} />
        ) : (
          <Text variant="callout" style={styles.rank}>{r.rank}</Text>
        )}
      </View>
      {showMove ? <View style={styles.moveCell}>
        {r.move === null ? null : r.move > 0 ? (
          <View style={styles.moveRow}>
            <Icon name="chevronUp" size="caption" tone="gain" />
            <Text variant="caption" style={{ color: colors.gain }}>{r.move}</Text>
          </View>
        ) : r.move < 0 ? (
          <View style={styles.moveRow}>
            <Icon name="chevronDown" size="caption" tone="loss" />
            <Text variant="caption" style={{ color: colors.loss }}>{Math.abs(r.move)}</Text>
          </View>
        ) : (
          <Text variant="caption" tone="secondary">–</Text>
        )}
      </View> : null}
      <View style={styles.name}>
        <Text variant="callout" style={yourNameStyle(r.isYou)}>{r.name}</Text>
        {r.tag ? <Text variant="caption" tone="secondary">{r.tag}</Text> : null}
        {r.isBot ? <Text variant="caption" tone="secondary">Bot</Text> : null}
        {stacked ? <View style={styles.statsLine}>{stats}</View> : null}
      </View>
      {stacked ? null : stats}
    </View>
  );
}

/** The broadcast table: rank, the move since last week, the name (+ Bot),
 * the record, and the season gain. A row with no known move shows no arrow.
 * UX rule 7: while your row is below the fold of the scroll view it sits in
 * (useScrollFold, from BarsRefresh) and the card is on screen, onPinChange gets
 * your row so the screen can pin a copy at the bottom; null when it shouldn't. */
export function StandingsTable({ rows, caption, seasonComplete, onPinChange, header, showMove = true }: StandingsTableProps) {
  const fold = useScrollFold();
  const cardRef = useRef<View>(null);
  const yourRef = useRef<View>(null);
  const pinned = useRef<boolean>(false);
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
    <View ref={cardRef} collapsable={false}>
      {/* G-12: the sp Card has no padding or radius of its own (as for the room's cards). */}
      <Card style={styles.card}>
        {header ? (
          <View style={styles.header}>
            <Text variant="headline" style={styles.headerTitle} accessibilityRole="header">{header.title}</Text>
            <Text variant="caption" tone="secondary">{header.subtitle}</Text>
          </View>
        ) : null}
        {rows.map((r) => (
          <View key={r.userId} ref={r.isYou ? yourRef : undefined} collapsable={false}>
            <StandingsRowView r={r} seasonComplete={seasonComplete} showMove={showMove} />
          </View>
        ))}
        <Text variant="caption" tone="secondary" style={styles.caption}>{caption}</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space[5] },
  // The board's .ks-section-h: the title left, the caption right, on one baseline; wraps at large text.
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: space[3], marginBottom: space[2] },
  headerTitle: { fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  rankCell: { width: 28, alignItems: 'center' },
  rank: { textAlign: 'center' },
  moveCell: { minWidth: 30 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  name: { flex: 1, minWidth: 0 },
  statsLine: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space[2] },
  record: { minWidth: 56, textAlign: 'right' },
  gain: { minWidth: 92, textAlign: 'right' },
  caption: { marginTop: space[2] },
});
