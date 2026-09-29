/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Text as RNText, StyleSheet } from 'react-native';

import { type, TypeVariant } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney, MoneySign } from '@/components/sp/logic/money';

// Stockpile — <Money> (§9A, "One design, two themes", 2026-09-29). SOURCE OF TRUTH: DESIGN_DIRECTION §9A / §2.
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
  const { colors } = useTheme();
  const typeStyle = type[size as TypeVariant];

  const text = formatMoney(value, { sign, alignSign, compact });

  let textColor: string;
  if (!colorBySign) {
    textColor = colors.text;
  } else if (value > 0) {
    textColor = colors.gain;
  } else if (value < 0) {
    textColor = colors.loss;
  } else {
    // Zero is neutral — never green, never red (§9A colors.zero).
    textColor = colors.zero;
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
