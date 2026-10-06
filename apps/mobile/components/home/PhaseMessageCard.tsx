/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Button } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';

// Stockpile — <PhaseMessageCard> (Phase 3b-2). The plain-message states
// that replace the this-week card: before the season (5), a bye (9), and
// the playoff bye / eliminated variants of state 10. Each is one or two
// lines of copy, no score, no tug — the board's own minimalism for these
// states.

export interface PhaseMessageCardProps {
  lines: string[];
  actionLabel?: string;
  onAction?: () => void;
}

export function PhaseMessageCard({ lines, actionLabel, onAction }: PhaseMessageCardProps) {
  return (
    <Card style={styles.card}>
      {lines.map((line, i) => (
        <Text key={i} variant={i === 0 ? 'headline' : 'callout'} tone={i === 0 ? 'primary' : 'secondary'}>
          {line}
        </Text>
      ))}
      {actionLabel && onAction ? (
        <View style={styles.actionRow}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space[6],
    gap: space[2],
    borderRadius: 14,
    alignItems: 'flex-start',
  },
  actionRow: {
    marginTop: space[3],
  },
});
