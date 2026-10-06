/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { radius, space, typeFontFamily } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// 3c-2 — the lobby's countdown (board #call-auto-start AutoLobby, and the
// commissioner's "Draft room opens in" deadline in CommishBlocked): a raised,
// centred card with the tag, the clock (tabular, never wraps), and its lines;
// at 0:00 a spinner and "Starting the draft". The clock is NOT a live region
// (VoiceOver would read every second); the card reads as one label instead.
// Members' postponed card (MemberPostponed) and the no-date card use the same
// frame with a title in place of the clock.

export interface DraftCountdownCardProps {
  tag: string;
  /** The clock ("2d 06h 40m", "42:18"); omitted for the title variant. */
  clock?: string;
  /** In place of a clock (members' postponed card, no draft time). */
  title?: string;
  /** The room is open / starting: the tag in the live colour (board). */
  live?: boolean;
  /** With a spinner (the starting phase). */
  starting?: string | null;
  lines: string[];
  /** Secondary lines (muted). */
  notes?: string[];
}

export function DraftCountdownCard({ tag, clock, title, live = false, starting, lines, notes = [] }: DraftCountdownCardProps) {
  const { colors } = useTheme();
  const label = [tag, clock, title, starting, ...lines, ...notes].filter(Boolean).join('. ');
  return (
    <Card style={styles.card} accessible accessibilityLabel={label}>
      <Text variant="tag" color={live ? colors.liveText : colors.text2} style={styles.center}>
        {tag}
      </Text>
      {clock ? (
        <Text variant="score.lg" style={styles.center}>
          {clock}
        </Text>
      ) : null}
      {title ? (
        <Text variant="title" style={styles.center}>
          {title}
        </Text>
      ) : null}
      {starting ? (
        <View style={styles.starting}>
          <ActivityIndicator color={colors.text} />
          <Text variant="callout" style={styles.bold}>
            {starting}
          </Text>
        </View>
      ) : null}
      {lines.map((l) => (
        <Text key={l} variant="caption" style={styles.center}>
          {l}
        </Text>
      ))}
      {notes.map((l) => (
        <Text key={l} variant="caption" tone="secondary" style={styles.center}>
          {l}
        </Text>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[2],
    alignItems: 'center',
  },
  center: {
    textAlign: 'center',
  },
  starting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
  },
  bold: {
    fontFamily: typeFontFamily.bold,
  },
});
