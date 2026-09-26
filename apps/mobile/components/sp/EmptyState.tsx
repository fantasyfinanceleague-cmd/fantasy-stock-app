/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <EmptyState> (Phase 2 foundation). SOURCE OF TRUTH: the Phase 2
// brief's build list — "the ONE empty-state pattern: icon, title, one line,
// one action." Every empty state in the app (no leagues, no matchup this
// week, no trades yet) renders through this component rather than each
// screen inventing its own layout, so the pattern actually stays singular.

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';
  const iconColor = onGame ? color.text.onGame.secondary : color.text.secondary;

  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={40} color={iconColor} />
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
      <Text variant="body" tone="secondary" style={styles.message}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} size="sm" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[8],
    gap: space[3],
  },
  title: {
    textAlign: 'center',
    marginTop: space[3],
  },
  message: {
    textAlign: 'center',
  },
  action: {
    marginTop: space[5],
  },
});
