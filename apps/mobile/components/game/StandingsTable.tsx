/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { space } from '@/constants/tokens';
import { moveA11y, shouldPinYourRow, type StandingsRow } from '@/lib/game/standings';
import { useScrollFold } from '@/components/shell/scrollFold';

export interface StandingsTableProps {
  rows: StandingsRow[];
  /** Board copy under the table, verbatim. */
  caption: string;
  /** Medals (§9A) show ONLY when the season is complete. */
  seasonComplete: boolean;
  /** UX rule 7: your row while it should be pinned at the bottom (else null). */
  onPinChange?: (row: StandingsRow | null) => void;
}

/** The medal disc for ranks 1–3 (season complete only): a filled disc with the
 * rank numeral in on-medal. Never medal-coloured text (§9A). */
const MEDAL: Record<number, { fill: 'medalGold' | 'medalSilver' | 'medalBronze'; label: string }> = {
  1: { fill: 'medalGold', label: '1st place' },
  2: { fill: 'medalSilver', label: '2nd place' },
  3: { fill: 'medalBronze', label: '3rd place' },
};

/** One standings row (also the pinned copy of yours: the SAME component). */
export function StandingsRowView({ r, seasonComplete }: { r: StandingsRow; seasonComplete: boolean }) {
  const { colors } = useTheme();
  const medal = seasonComplete ? MEDAL[r.rank] : undefined;
  const move = moveA11y(r.move);
  return (
    <View style={[styles.row, r.isYou ? { backgroundColor: colors.youTint } : null]} accessible accessibilityLabel={`${medal ? `${medal.label}, ` : ''}${r.rank}, ${r.name}, ${r.record}, season gain ${formatMoney(r.seasonGain, { sign: 'always' })}${move ? `, ${move}` : ''}`}>
      {medal ? (
        <View style={[styles.disc, { backgroundColor: colors[medal.fill] }]}>
          <Text variant="caption" style={[styles.discNumeral, { color: colors.onMedal }]}>{r.rank}</Text>
        </View>
      ) : (
        <Text variant="callout" style={styles.rank}>{r.rank}</Text>
      )}
      <View style={styles.moveCell}>
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
      </View>
      <View style={styles.name}>
        <Text variant="callout" style={r.isYou ? { fontWeight: '700' } : undefined}>
          {r.name}{r.isYou ? <Text variant="callout" tone="secondary"> (you)</Text> : null}
        </Text>
        {r.isBot ? <Text variant="caption" tone="secondary">Bot</Text> : null}
      </View>
      <Text variant="caption" tone="secondary" style={styles.record}>{r.record}</Text>
      <Text variant="callout" style={styles.gain}>{formatMoney(r.seasonGain, { sign: 'always' })}</Text>
    </View>
  );
}

/** The broadcast table: rank, the move since last week, the name (+ Bot),
 * the record, and the season gain. A row with no known move shows no arrow.
 * UX rule 7: while your row is below the fold of the scroll view it sits in
 * (useScrollFold, from BarsRefresh) and the card is on screen, onPinChange gets
 * your row so the screen can pin a copy at the bottom; null when it shouldn't. */
export function StandingsTable({ rows, caption, seasonComplete, onPinChange }: StandingsTableProps) {
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
      <Card>
        {rows.map((r) => (
          <View key={r.userId} ref={r.isYou ? yourRef : undefined} collapsable={false}>
            <StandingsRowView r={r} seasonComplete={seasonComplete} />
          </View>
        ))}
        <Text variant="caption" tone="secondary" style={styles.caption}>{caption}</Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  rank: { minWidth: 24, textAlign: 'right' },
  disc: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  discNumeral: { fontSize: 11, fontWeight: '800' },
  moveCell: { minWidth: 30 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  name: { flex: 1 },
  record: { minWidth: 56, textAlign: 'right' },
  gain: { minWidth: 92, textAlign: 'right' },
  caption: { marginTop: space[2] },
});
