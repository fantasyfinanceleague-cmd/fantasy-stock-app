/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { isEmptyStateCarded } from '@/components/sp/logic/emptyState';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

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
  /**
   * Phase 3b-1: an optional second action (the board's "Check your email"
   * and "Home with no leagues" both have two). Any EmptyState with an action
   * is carded, and its actions are full-width and stacked, primary first.
   */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export function EmptyState({ icon: Icon, title, message, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }: EmptyStateProps) {
  const { colors } = useTheme();
  const iconColor = colors.text2;
  const circleColor = colors.sunken;

  // Design Lead ruling (Phase 3b-1): WITH actions it is carded — the board's
  // `Empty`: a card padded 28/20, full-width actions inside; informational
  // ones (no action) stay flat on the screen.
  const carded = isEmptyStateCarded(actionLabel, !!onAction);
  const hasPair = !!(actionLabel && onAction && secondaryActionLabel && onSecondaryAction);

  const content = (
    <>
      <View style={[styles.iconCircle, { backgroundColor: circleColor }]}>
        <Icon size={ICON_SIZE} color={iconColor} />
      </View>
      <Text variant="title" style={styles.title}>
        {title}
      </Text>
      <Text variant="body" tone="secondary" style={styles.message}>
        {message}
      </Text>
      {carded ? (
        <View style={[styles.action, styles.actionStretched, styles.actionPair]}>
          <Button label={actionLabel!} onPress={onAction} />
          {hasPair ? <Button label={secondaryActionLabel!} onPress={onSecondaryAction} variant="secondary" /> : null}
        </View>
      ) : null}
    </>
  );

  if (carded) {
    return <Card style={styles.card}>{content}</Card>;
  }
  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[8],
    gap: space[3],
  },
  card: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: space[6],
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
  actionStretched: {
    alignSelf: 'stretch',
  },
  actionPair: {
    gap: space[4],
  },
});
