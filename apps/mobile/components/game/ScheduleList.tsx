/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { useLargeText } from '@/components/sp/useLargeText';
import { Text } from '@/components/sp/Text';
import { keepMoney } from '@/lib/game/keepDots';
import { Avatar } from '@/components/sp/Avatar';
import { useTheme } from '@/components/sp/ThemeProvider';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { formatMoney } from '@/components/sp/logic/money';
import { chipLook, toneOf } from '@/components/sp/logic/gameNight';
import { MANAGER_ROW_GAP } from '@/components/sp/gn';
import { radius, space } from '@/constants/tokens';
import type { ScheduleRow } from '@/lib/game/schedule';

/** Every line of a row stops at the score's own cap (score.sm, 1.3×): the result stays the
 * row's loudest text at every size (the checklist's "The standout stays loudest"; at XL the
 * uncapped name drew at ~35pt over a 19.5pt score, W4 capture). */
const ROW_TEXT_CAP = 1.3;

export interface ScheduleListProps {
  rows: ScheduleRow[];
  /** The playoff line under the list (lib/playoffs playoffLine), or null. */
  playoffLine: string | null;
}

/** League › Schedule (board frame, D4 = keep), on Game Night: each week its own `surface`
 * tile, 6pt apart like the standings (separation by space, §9C rule 2). The week, the
 * opponent's avatar and name, and the result with your score once it posts (the letter by
 * result, the score by sign); this week the §9C live chip ("Live", its dot drawn); the
 * week after, "Next". Every row here is your game, so none is shaded (B shades YOUR side
 * where you face someone; here that would be every row). A bye is neutral: never W or L. */
export function ScheduleList({ rows, playoffLine }: ScheduleListProps) {
  const { colors } = useTheme();
  // Large text: the result goes on its own line under the week (it was clipped off the card).
  const largeText = useLargeText();
  const live = chipLook('live', colors);
  return (
    <View style={styles.stack}>
      <View style={styles.rows}>
        {rows.map((r) => (
          <View key={r.week} style={[styles.row, largeText ? styles.rowWrap : null, { backgroundColor: colors.surface }]} accessible accessibilityLabel={label(r)}>
            <Text variant="tag" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_CAP} style={styles.week}>{`W${r.week}`}</Text>
            {r.bye || !r.opponent ? null : <Avatar name={r.opponent} size={24} tone="neutral" />}
            <Text variant="body" numberOfLines={2} maxFontSizeMultiplier={ROW_TEXT_CAP} tone={r.state === 'future' || r.state === 'next' ? 'secondary' : undefined} style={[styles.opponent, r.state === 'live' ? styles.bold : null]}>
              {r.bye ? 'Bye' : r.opponent === null ? '' : `vs ${r.opponent}`}
            </Text>
            <View style={[styles.result, largeText ? styles.resultLine : null]}>
              {r.bye ? (
                <Text variant="callout" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_CAP}>{r.gain === null ? '' : keepMoney(formatMoney(r.gain, { sign: 'always' }))}</Text>
              ) : r.state === 'live' ? (
                <View style={[styles.chip, { backgroundColor: live.fill }]}>
                  <LiveDot size={7} />
                  <Text variant="tag" style={{ color: live.ink }}>Live</Text>
                </View>
              ) : r.state === 'next' ? (
                <Text variant="callout" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_CAP}>Next</Text>
              ) : r.gain !== null ? (
                <View style={styles.score}>
                  <Text variant="score.sm" color={r.tie ? colors.text2 : r.won ? colors.gain : colors.loss}>{r.tie ? 'T' : r.won ? 'W' : 'L'}</Text>
                  <Text variant="score.sm" color={colors[toneOf(r.gain)]} style={styles.gain}>{keepMoney(formatMoney(r.gain, { sign: 'always' }))}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>
      {playoffLine ? <Text variant="caption" tone="secondary" maxFontSizeMultiplier={ROW_TEXT_CAP}>Then the playoffs: {playoffLine}.</Text> : null}
    </View>
  );
}

function label(r: ScheduleRow): string {
  const what = r.bye ? 'Bye' : r.opponent ? `against ${r.opponent}` : '';
  if (r.state === 'live') return `Week ${r.week}, ${what}, live`;
  if (r.state === 'next') return `Week ${r.week}, ${what}, next`;
  if (r.bye) return `Week ${r.week}, bye, no result`;
  if (r.gain === null) return `Week ${r.week}, ${what}`;
  return `Week ${r.week}, ${what}, ${r.tie ? 'tie' : r.won ? 'won' : 'lost'}, ${formatMoney(r.gain, { sign: 'always' })}`;
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  // §9C: tiles 6pt apart, the ManagerRow's tile (radius 12, 12pt padding, 56pt tall).
  rows: { gap: MANAGER_ROW_GAP },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingVertical: space[4], paddingHorizontal: space[4], borderRadius: radius.row },
  week: { minWidth: 30 },
  bold: { fontWeight: '700' },
  result: { marginLeft: 'auto', alignItems: 'flex-end' },
  rowWrap: { flexWrap: 'wrap' },
  opponent: { flexShrink: 1 },
  resultLine: { width: '100%' },
  score: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  gain: { textAlign: 'right' },
  // §9C Chip: accentTint + liveText, the dot drawn (Home's This week chip).
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill },
});
