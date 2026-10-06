/**
 * TradeReviewPanel: the trade review, rendered (3e). The review IS the
 * confirmation (Design Lead ruling (b)): the whole outcome, then one primary
 * button that names the action. Everything shown comes from the review model
 * and reviewPresentation; this file only lays them out.
 *
 * Refusals and blockers sit in a warn-tint card with NO icon. Load failures
 * and field errors are text. Nothing here says "Confirm" or "OK".
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/sp/Button';
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
  onBack: () => void;
  onDone: () => void;
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  back: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 },
  card: { borderRadius: 12, padding: 14 },
  footerLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
});

export function TradeReviewPanel({ review, presentation, onSubmit, onRetry, onBack, onDone }: TradeReviewPanelProps) {
  const { colors } = useTheme();
  const p = presentation;

  return (
    <View style={styles.stack}>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onBack} hitSlop={8} style={styles.back}>
        <Text variant="callout" tone="primary">Edit</Text>
      </Pressable>

      <Text variant="headline">{review.title}</Text>
      {review.headline ? <Text variant="title">{review.headline}</Text> : null}

      <View style={{ gap: 4 }}>
        {review.lines.map((l) => (
          <View key={l.label} style={styles.row}>
            <Text variant="callout" tone="secondary">{l.label}</Text>
            <Text variant="callout" tone={l.tone === 'zero' ? 'secondary' : 'primary'}>{l.value}</Text>
          </View>
        ))}
      </View>

      {review.card ? (
        <View style={[styles.card, { backgroundColor: colors.sunken }]}>
          <Text variant="callout">{review.card}</Text>
        </View>
      ) : null}

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
