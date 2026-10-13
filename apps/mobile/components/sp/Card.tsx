/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View, ViewProps } from 'react-native';

import { radius } from '@/constants/tokens';
import { RIM_WIDTH } from '@/constants/tokens/elevation';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Card>, Game Night (§9C, 2026-10-12): `surface` + a 1pt `rim`, no shadow,
// in both themes. Depth comes from lightness steps of one hue (rule 1): the page `bg`,
// the card `surface`, panels inside it on `inset`.
//
// The rim is an overlay drawn UNDER the children (like the board's `box-shadow: inset 0 0 0
// 1px var(--d-rim)`, which paints above the background and below the content), so it adds
// no layout: a child that fills to the card's edge (the Scoreboard's shaded half, yours)
// covers it, as on the board. It follows the card's own radius (14 by default; a caller's borderRadius wins).
//
// `variant="scoreboard"` is kept for the screens that pass it (W4 moves them to the Game
// Night Scoreboard); under §9C it draws the same card — your shaded half, not a wash on the
// card, is what marks the scoreboard now.

export type CardVariant = 'default' | 'scoreboard';

export interface CardProps extends ViewProps {
  variant?: CardVariant;
}

export function Card({ variant: _variant = 'default', style, children, ...rest }: CardProps) {
  const { colors } = useTheme();
  const cornerRadius = StyleSheet.flatten(style)?.borderRadius ?? radius.lg;

  return (
    <View style={[styles.base, { backgroundColor: colors.surface }, style]} {...rest}>
      <View
        testID="card-rim"
        pointerEvents="none"
        style={[styles.rim, { borderColor: colors.rim, borderRadius: cornerRadius }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: RIM_WIDTH,
  },
});
