/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';

import { color, type, TypeVariant } from '@/constants/tokens';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <Text> (Phase 2 foundation). SOURCE OF TRUTH: DESIGN_DIRECTION §9.
// `variant` covers every `type.*` token; the default colour comes from the
// ambient <Surface> (money vs game), so a component never has to remember
// which text colour is legal on the surface it happens to be nested in.

export type TextTone = 'primary' | 'secondary' | 'disabled';

export interface TextProps extends RNTextProps {
  variant: TypeVariant;
  tone?: TextTone;
  /** Explicit colour escape hatch — rare; prefer `tone`. */
  color?: string;
  /** Per §2: money/scores never wrap. Defaults to true for score.* variants. */
  numberOfLines?: number;
}

// Score variants render digits that must never wrap onto a second line —
// a wrapped scoreboard number is worse than a clipped one.
const NEVER_WRAP: ReadonlySet<TypeVariant> = new Set(['score.xl', 'score.lg', 'score.md', 'display']);

function tonePrimary(onGame: boolean): string {
  return onGame ? color.text.onGame.primary : color.text.primary;
}
function toneSecondary(onGame: boolean): string {
  return onGame ? color.text.onGame.secondary : color.text.secondary;
}

export function Text({
  variant,
  tone = 'primary',
  color: colorOverride,
  style,
  numberOfLines,
  maxFontSizeMultiplier,
  ...rest
}: TextProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';
  const typeStyle = type[variant];

  let resolvedColor: string;
  if (colorOverride) {
    resolvedColor = colorOverride;
  } else if (tone === 'disabled') {
    // Disabled is never information-bearing (§9) — same value on both surfaces.
    resolvedColor = color.text.disabled;
  } else if (tone === 'secondary') {
    resolvedColor = toneSecondary(onGame);
  } else {
    resolvedColor = tonePrimary(onGame);
  }

  const resolvedNumberOfLines = numberOfLines ?? (NEVER_WRAP.has(variant) ? 1 : undefined);
  const resolvedMaxFontSizeMultiplier = maxFontSizeMultiplier ?? typeStyle.maxScale;

  return (
    <RNText
      style={[
        styles.base,
        {
          fontFamily: typeStyle.fontFamily,
          fontSize: typeStyle.fontSize,
          lineHeight: typeStyle.lineHeight,
          color: resolvedColor,
          letterSpacing: typeStyle.letterSpacing,
          textTransform: typeStyle.textTransform,
        },
        typeStyle.tabularNums ? styles.tabularNums : null,
        style,
      ]}
      numberOfLines={resolvedNumberOfLines}
      maxFontSizeMultiplier={resolvedMaxFontSizeMultiplier}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
