/**
 * TradeReviewPanel: the trade review, rendered (3e). The review IS the
 * confirmation (Design Lead ruling (b)): the whole outcome, then one primary
 * button that names the action. Everything shown comes from the review model
 * and reviewPresentation; this file only lays them out.
 *
 * Refusals and blockers sit in a warn-tint card with NO icon. Load failures
 * and field errors are text. Nothing here says "Confirm" or "OK".
 */
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { useMotion } from '@/components/sp/motion';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { COPY } from '@/lib/money/moneyCopy';
import type { ReviewPresentation } from '@/lib/money/reviewPresentation';
import type { TradeReview } from '@/lib/money/reviewModel';

export interface TradeReviewPanelProps {
  review: TradeReview;
  presentation: ReviewPresentation;
  onSubmit: () => void;
  onRetry: () => void;
  /** False while a submit is in flight: Edit is hidden, since leaving would drop the outcome. */
  canEdit: boolean;
  onBack: () => void;
  onDone: () => void;
}

const styles = StyleSheet.create({
  // The review sits inside the sheet: its own 20 pt gutter, as the sheet body has.
  stack: { gap: 12, paddingHorizontal: 20 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  // XL: the label may wrap; the value keeps its width (flexShrink 0) so it never truncates.
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 36, gap: 12 },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 0, textAlign: 'right' },
  card: { borderRadius: 12, padding: 14 },
  footerLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});

/**
 * M4, the trade success: the check draws over the slow duration, then the
 * screen moves on. Reduce Motion: the check simply appears.
 */
function DoneCheck() {
  const { reduced, duration, easing } = useMotion();
  const progress = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (!reduced) progress.value = withTiming(1, { duration: duration.slow, easing: easing.settle });
    // Mount-only: the check draws once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.8 + 0.2 * progress.value }],
  }));
  return (
    <Animated.View style={style} accessible={false}>
      <Icon name="check" size="medallion" tone="text" />
    </Animated.View>
  );
}

export function TradeReviewPanel({ review, presentation, onSubmit, onRetry, canEdit, onBack, onDone }: TradeReviewPanelProps) {
  const { colors } = useTheme();
  const p = presentation;

  return (
    <View style={styles.stack}>
      {canEdit ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onBack} hitSlop={8} style={styles.back}>
          <Text variant="callout" tone="primary">Edit</Text>
        </Pressable>
      ) : null}

      <Text variant="headline">{review.title}</Text>
      {review.headline ? <Text variant="title">{review.headline}</Text> : null}

      <View style={{ gap: 4 }}>
        {review.lines.map((l) => (
          <View key={l.label} style={styles.row} accessible accessibilityLabel={`${l.label}, ${l.value}`}>
            <Text variant="callout" tone="secondary" style={styles.rowLabel}>{l.label}</Text>
            <Text variant="callout" tone={l.tone === 'zero' ? 'secondary' : 'primary'} style={styles.rowValue}>{l.value}</Text>
          </View>
        ))}
      </View>

      {review.card ? (
        <View style={[styles.card, { backgroundColor: colors.sunken }]}>
          <Text variant="callout">{review.card}</Text>
        </View>
      ) : null}

      {p.footer === 'done' ? <DoneCheck /> : null}
      {p.message ? (
        p.messageTone === 'warn' ? (
          // Warn-tint card, NO icon (the Design Lead's ruling for refusals and blockers).
          <View style={[styles.card, { backgroundColor: colors.sunken }]}>
            <Text variant="callout" accessibilityRole="alert">{p.message}</Text>
          </View>
        ) : (
          <Text variant="callout" tone="secondary" accessibilityRole="alert">{p.message}</Text>
        )
      ) : null}

      {p.button ? (
        <Button
          label={p.button.label}
          variant={review.buttonRole === 'sell' ? 'destructive' : 'primary'}
          fullWidth
          disabled={!p.button.enabled}
          status={p.button.progress ? 'loading' : 'idle'}
          onPress={onSubmit}
        />
      ) : null}

      {p.footer === 'done' ? (
        <Button label="Done" variant="secondary" fullWidth onPress={onDone} />
      ) : null}
      {p.footer === 'try_again' ? (
        <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8} style={styles.footerLink}>
          <Text variant="callout" tone="primary">{COPY.tryAgain}</Text>
        </Pressable>
      ) : null}

      <Text variant="caption" tone="secondary">{review.caption}</Text>
    </View>
  );
}
