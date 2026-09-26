/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Text as RNText, StyleSheet } from 'react-native';

import { color, type, TypeVariant } from '@/constants/tokens';
import { useSurface } from '@/components/sp/Surface';
import { formatMoney, MoneySign } from '@/components/sp/logic/money';

// Stockpile — <Money> (Phase 2 foundation). SOURCE OF TRUTH: DESIGN_DIRECTION §9 / §2.
// Non-negotiables: tabular-nums, never wraps, U+2212 minus before the
// currency, zero is neutral (never green/red). All of that lives in
// components/sp/logic/money.ts; this component is presentation only.

export type MoneySize = 'score.xl' | 'score.lg' | 'score.md' | 'display' | 'title' | 'headline' | 'body' | 'callout' | 'caption';

export interface MoneyProps {
  value: number;
  size?: MoneySize;
  sign?: MoneySign;
  alignSign?: boolean;
  compact?: boolean;
  /** Colour the amount by gain/loss/zero (§9 color.data.*). Off by default —
   * most money on screen (holdings, prices) isn't a gain/loss figure. */
  colorBySign?: boolean;
  /** Floor for adjustsFontSizeToFit, as a fraction of the base size (0-1).
   * Keeps a long compact-off amount from shrinking to unreadable. */
  minFontScale?: number;
  testID?: string;
}

const DEFAULT_SIZE: MoneySize = 'body';
const DEFAULT_MIN_FONT_SCALE = 0.7;

export function Money({
  value,
  size = DEFAULT_SIZE,
  sign,
  alignSign,
  compact,
  colorBySign = false,
  minFontScale = DEFAULT_MIN_FONT_SCALE,
  testID,
}: MoneyProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';
  const typeStyle = type[size as TypeVariant];

  const text = formatMoney(value, { sign, alignSign, compact });

  let textColor: string;
  if (!colorBySign) {
    textColor = onGame ? color.text.onGame.primary : color.text.primary;
  } else if (value > 0) {
    textColor = onGame ? color.data.gain.onGame : color.data.gain.base;
  } else if (value < 0) {
    textColor = onGame ? color.data.loss.onGame : color.data.loss.base;
  } else {
    // Zero is neutral — never green, never red (§9 color.data.zero).
    textColor = color.data.zero;
  }

  return (
    <RNText
      testID={testID}
      style={[
        styles.base,
        {
          fontFamily: typeStyle.fontFamily,
          fontSize: typeStyle.fontSize,
          lineHeight: typeStyle.lineHeight,
          letterSpacing: typeStyle.letterSpacing,
          color: textColor,
        },
      ]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={minFontScale}
    >
      {text}
    </RNText>
  );
}

const styles = StyleSheet.create({
  base: {
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
});
