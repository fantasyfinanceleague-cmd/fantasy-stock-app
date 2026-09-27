/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { color, radius, space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <EmptyState> (Phase 2 foundation). SOURCE OF TRUTH: the Phase 2
// brief's build list — "the ONE empty-state pattern: icon, title, one line,
// one action." Every empty state in the app (no leagues, no matchup this
// week, no trades yet) renders through this component rather than each
// screen inventing its own layout, so the pattern actually stays singular.
//
// Amended 2026-09-26 (Design Lead, "the JUL 17 lesson"): the icon sits in a
// soft circular backdrop, and it's a RENDER PROP — `icon` is a component
// that receives its resolved size/colour — never an emoji string. Emoji
// render per-OS (that's the "JUL 17" incident this rule exists to prevent),
// while an icon FONT glyph (Ionicons, or any vector icon) renders the same
// everywhere.

const ICON_SIZE = 28;
const CIRCLE_SIZE = 64;

export interface EmptyStateIconProps {
  size: number;
  color: string;
}

export interface EmptyStateProps {
  /** A component, not a string — e.g. `(p) => <Ionicons name="trophy-outline" {...p} />`. Never an emoji. */
  icon: (props: EmptyStateIconProps) => ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';
  const iconColor = onGame ? color.text.onGame.secondary : color.text.secondary;
  const circleColor = onGame ? color.surface.game.raised : color.surface.money.sunken;

  return (
    <View style={styles.container}>
      <View style={[styles.iconCircle, { backgroundColor: circleColor }]}>
        <Icon size={ICON_SIZE} color={iconColor} />
      </View>
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
  iconCircle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
