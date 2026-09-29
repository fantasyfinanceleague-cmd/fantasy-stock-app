/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View, ViewProps } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { radius } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Card> (§9A, "One design, two themes", 2026-09-29). Replaces
// <Surface kind="money" | "game">: there's only one card now, coloured by
// the active theme, not a caller-chosen surface kind.
//
// `variant="scoreboard"` is how a scoreboard now stands out WITHOUT an
// inverted dark card (§9A, "Emphasis without an inverted surface"): a faint
// accent wash at the top plus a hairline border, on top of the theme's own
// surface colour, same as every other card. The wash is a real gradient
// (expo-linear-gradient — already a dependency, no new native module) fading
// `colors.accentWash` to transparent, matching themes.css's flat
// low-opacity tint faded rather than solid-blocked, so it reads as a glow
// rather than a stripe.

export type CardVariant = 'default' | 'scoreboard';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
}

export function Card({ variant = 'default', style, children, ...rest }: CardProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.base, { backgroundColor: colors.surface }, style]} {...rest}>
      {variant === 'scoreboard' ? (
        <>
          <LinearGradient
            colors={[colors.accentWash, 'transparent']}
            style={[styles.wash, { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }]}
            pointerEvents="none"
          />
          <View style={[styles.hairline, { borderColor: colors.border }]} pointerEvents="none" />
        </>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
  wash: {
    ...StyleSheet.absoluteFillObject,
    height: '50%',
  },
  hairline: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
  },
});
