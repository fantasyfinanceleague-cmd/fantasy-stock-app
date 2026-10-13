/**
 * TradeReviewPanel: the trade review, rendered (3e). The review IS the
 * confirmation (Design Lead ruling (b)): the whole outcome, then one primary
 * button that names the action. Everything shown comes from the review model
 * and reviewPresentation; this file only lays them out.
 *
 * Refusals and blockers sit in a warn-tint card with NO icon. Load failures
 * and field errors are text. Nothing here says "Confirm" or "OK".
 *
 * W4 (Game Night, §9C): the lines sit in an `inset` panel (radius 14), values tabular at 800;
 * a refusal is the WarnPanel (`warnTint`, its own `warnText` ink); every button is a pill;
 * Edit is a text button in the accent with a 44pt target. The confirmation is the drawn check,
 * "Bought NVDA" / "Sold NVDA" as the headline, and Done.
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
import { setForegroundQuiet } from '@/lib/foregroundQuiet';
import { WarnPanel } from '@/components/money/WarnPanel';
import { radius, space } from '@/constants/tokens';
import type { ReviewPresentation } from '@/lib/money/reviewPresentation';
import type { TradeReview } from '@/lib/money/reviewModel';

/** The next step a refusal names. Each one is a button, never a dead end (Design Lead rule 8). */
export type NextStep = 'back_to_picker' | 'pick_stock' | 'sell_first' | 'sign_in';

const NEXT_LABEL: Record<NextStep, string> = {
  back_to_picker: COPY.pickAnotherSale,
  pick_stock: COPY.pickAnotherStock,
  sell_first: COPY.goToPortfolio,
  sign_in: COPY.signIn,
};

export interface TradeReviewPanelProps {
  review: TradeReview;
  presentation: ReviewPresentation;
  onSubmit: () => void;
  onRetry: () => void;
  /** False while a submit is in flight: Edit is hidden, since leaving would drop the outcome. */
  canEdit: boolean;
  /** The refusal's next step, pressed. */
  onNextStep: (step: NextStep) => void;
  onBack: () => void;
  onDone: () => void;
}

const styles = StyleSheet.create({
  // The review sits inside the sheet: its own 20 pt gutter, as the sheet body has.
  stack: { gap: space[5], paddingHorizontal: space[6], paddingBottom: space[7] },
  back: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  // XL: the label may wrap; the value keeps its width (flexShrink 0) so it never truncates.
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', minHeight: 28, gap: space[4] },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 0, textAlign: 'right', fontWeight: '800', fontVariant: ['tabular-nums'] },
  panel: { borderRadius: radius.lg, paddingVertical: space[4], paddingHorizontal: 14, gap: space[3] },
  title: { fontWeight: '800' },
  done: { alignItems: 'center', gap: space[3] },
  footerLink: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  bold: { fontWeight: '700' },
  center: { textAlign: 'center' },
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

export function TradeReviewPanel({ review, presentation, onSubmit, onRetry, canEdit, onNextStep, onBack, onDone }: TradeReviewPanelProps) {
  const { colors } = useTheme();
  const p = presentation;

  // C-1 (U-14, Design Lead gate): no foreground banner over an open trade
  // review. The panel is conditionally mounted (StockSheetBody only renders
  // it while open.review is set), so mount/unmount already tracks the
  // review's full open-to-closed lifetime -- on close, Back and Done both
  // unmount it the same way, and quiet never survives a crash or a fast
  // re-entry since it's set fresh on mount.
  useEffect(() => {
    setForegroundQuiet('trade_review', true);
    return () => setForegroundQuiet('trade_review', false);
  }, []);
  const nextStep = p.footer === 'back_to_picker' || p.footer === 'pick_stock' || p.footer === 'sell_first' || p.footer === 'sign_in' ? p.footer : null;

  const done = p.footer === 'done';
  return (
    <View style={styles.stack}>
      {canEdit && !done ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onBack} hitSlop={4} style={styles.back}>
          <Text variant="callout" color={colors.accent} style={styles.bold}>Edit</Text>
        </Pressable>
      ) : null}

      {done ? (
        // The confirmation: the check draws, then what happened, in the sheet's headline size.
        <View style={styles.done}>
          <DoneCheck />
          <Text variant="title" accessibilityRole="header" style={[styles.title, styles.center]}>{p.message}</Text>
        </View>
      ) : (
        <>
          <Text variant="headline" accessibilityRole="header" style={styles.title}>{review.title}</Text>
          {review.headline ? <Text variant="title" style={styles.title}>{review.headline}</Text> : null}
        </>
      )}

      <View style={[styles.panel, { backgroundColor: colors.inset }]}>
        {review.lines.map((l) => (
          <View key={l.label} style={styles.row} accessible accessibilityLabel={`${l.label}, ${l.value}`}>
            <Text variant="callout" tone="secondary" style={styles.rowLabel}>{l.label}</Text>
            <Text variant="callout" tone={l.tone === 'zero' ? 'secondary' : 'primary'} style={styles.rowValue}>{l.value}</Text>
          </View>
        ))}
        {review.card ? <Text variant="callout" style={styles.bold}>{review.card}</Text> : null}
      </View>

      {p.message && !done ? (
        p.messageTone === 'warn' ? (
          // The warn panel, NO icon (the Design Lead's ruling for refusals and blockers).
          <WarnPanel text={p.message} />
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
          testID="trade-review-submit"
        />
      ) : null}

      {done ? (
        <Button label="Done" variant="primary" fullWidth onPress={onDone} testID="trade-review-done" />
      ) : null}
      {nextStep ? (
        <Button label={NEXT_LABEL[nextStep]} variant="primary" fullWidth onPress={() => onNextStep(nextStep)} />
      ) : null}
      {p.footer === 'try_again' ? (
        <Button label={COPY.tryAgain} variant="secondary" fullWidth onPress={onRetry} />
      ) : null}

      <Text variant="caption" tone="secondary" style={styles.center}>{review.caption}</Text>
    </View>
  );
}
