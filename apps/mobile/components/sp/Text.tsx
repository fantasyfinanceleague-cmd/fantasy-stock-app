/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Text as RNText, TextProps as RNTextProps, StyleSheet, type TextStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { resolveFontFamily } from './logic/fontWeight';

import { type, TypeVariant } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Text> (§9A, "One design, two themes", 2026-09-29). `variant`
// covers every `type.*` token; the default colour comes from the active
// theme (useTheme()), not a surface kind — a component never has to
// remember which text colour is legal where, because there's only one
// legal set at a time now.

export type TextTone = 'primary' | 'secondary' | 'disabled';

export interface TextProps extends RNTextProps {
  variant: TypeVariant;
  tone?: TextTone;
  /** Explicit colour escape hatch — rare; prefer `tone`. */
  color?: string;
  /** Per §2: money/scores never wrap. Defaults to true for score.* variants. */
  numberOfLines?: number;
  /** A UI-thread style (Reanimated's useAnimatedStyle), applied last: a colour that must
   * change in the same frame as an animation (the draft room's your-turn flash). Given
   * one, the text renders as Animated.Text; without one, nothing changes. */
  animatedStyle?: AnimatedStyle<TextStyle>;
}

// Score variants render digits that must never wrap onto a second line —
// a wrapped scoreboard number is worse than a clipped one.
const NEVER_WRAP: ReadonlySet<TypeVariant> = new Set(['hero', 'money', 'ticker', 'ticker.card', 'ticker.tile', 'score.xl', 'score.sm', 'score.lg', 'score.md', 'display']);

export function Text({
  variant,
  tone = 'primary',
  color: colorOverride,
  style,
  numberOfLines,
  maxFontSizeMultiplier,
  animatedStyle,
  children,
  ...rest
}: TextProps) {
  const { colors } = useTheme();
  const typeStyle = type[variant];

  let resolvedColor: string;
  if (colorOverride) {
    resolvedColor = colorOverride;
  } else if (tone === 'disabled') {
    // §9A: text3 is disabled/decorative ONLY, never information-bearing.
    resolvedColor = colors.text3;
  } else if (tone === 'secondary') {
    resolvedColor = colors.text2;
  } else {
    resolvedColor = colors.text;
  }

  const resolvedNumberOfLines = numberOfLines ?? (NEVER_WRAP.has(variant) ? 1 : undefined);

  // An uppercase variant (`tag`) uppercases plain-string children here rather than through
  // textTransform: iOS measures the SOURCE case, so the wider capitals clipped the last glyph
  // ("FINAL" → "FINA") once §9C widened the tag's tracking. Other children keep textTransform.
  const upperInJs = typeStyle.textTransform === 'uppercase' && typeof children === 'string';
  const content = upperInJs ? (children as string).toUpperCase() : children;
  const resolvedMaxFontSizeMultiplier = maxFontSizeMultiplier ?? typeStyle.maxScale;

  // A caller's fontWeight picks the matching Archivo face (iOS ignores fontWeight on a
  // single-weight family: logic/fontWeight.ts); the weight itself is then cleared.
  const callerWeight = (StyleSheet.flatten(style) as TextStyle | undefined)?.fontWeight;
  const fontFamily = resolveFontFamily(typeStyle.fontFamily, callerWeight);
  const baseStyle = [
    styles.base,
    {
      fontFamily,
      fontSize: typeStyle.fontSize,
      lineHeight: typeStyle.lineHeight,
      color: resolvedColor,
      letterSpacing: typeStyle.letterSpacing,
      textTransform: upperInJs ? undefined : typeStyle.textTransform,
    },
    typeStyle.tabularNums ? styles.tabularNums : null,
    style,
    callerWeight !== undefined && fontFamily !== typeStyle.fontFamily ? styles.weightInFace : null,
  ];

  if (animatedStyle) {
    return (
      <Animated.Text
        style={[baseStyle, animatedStyle]}
        numberOfLines={resolvedNumberOfLines}
        maxFontSizeMultiplier={resolvedMaxFontSizeMultiplier}
        {...rest}
      >
        {content}
      </Animated.Text>
    );
  }
  return (
    <RNText
      style={baseStyle}
      numberOfLines={resolvedNumberOfLines}
      maxFontSizeMultiplier={resolvedMaxFontSizeMultiplier}
      {...rest}
    >
      {content}
    </RNText>
  );
}

const styles = StyleSheet.create({
  base: {
    includeFontPadding: false,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
  // The weight is in the face now (resolveFontFamily); a leftover fontWeight on a named
  // face can make iOS fall back to the system font.
  weightInFace: {
    fontWeight: 'normal',
  },
});
