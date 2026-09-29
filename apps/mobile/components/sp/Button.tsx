/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { PressableScale, PressableScaleProps } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <Button> (§9A, "One design, two themes", 2026-09-29). Every
// variant reads the active theme's tokens directly — no more onGame variant
// per colour, since there's no more game surface to invert for. `primary`
// is `primaryBg`/`primaryFg` (navy-on-white in Light, white-on-navy in
// Dark — this IS the old on-game inversion, just keyed by theme instead of
// by a caller-chosen surface kind). `destructive` uses `lossFill`/`onAccent`
// (the PAIRS list's own "Sell button label" pair, board.jsx-verified 4.5:1
// in both themes).
//
// Amended 2026-09-29 (Design Lead, DESIGN-CHANGES): a button label never
// truncates — this is a primitive-level rule, not a per-caller patch. The
// label wraps up to 2 lines with no ellipsis, and the button GROWS to fit
// (its height token becomes a floor, not a fixed height). `fullWidth` is an
// opt-in for a lone/primary action (e.g. EmptyState's CTA) that only takes
// effect at accessibility text sizes — below that threshold a button stays
// sized to its content, matching the existing look.
export const FULL_WIDTH_FONT_SCALE = 1.35;

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends Omit<PressableScaleProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Goes full-width, but only once fontScale reaches FULL_WIDTH_FONT_SCALE — a lone primary action (e.g. EmptyState's CTA), not a general layout prop. */
  fullWidth?: boolean;
}

// Both sizes clear the 44pt minimum tap target (Apple HIG / WCAG 2.5.5) as a
// floor — `minHeight`, not `height`, so a wrapped 2-line label can grow it.
const MIN_HEIGHT: Record<ButtonSize, number> = { md: 52, sm: 44 };
const PADDING_X: Record<ButtonSize, number> = { md: space[6], sm: space[5] };
const PADDING_Y: Record<ButtonSize, number> = { md: space[3], sm: space[2] };

export function Button({ label, variant = 'primary', size = 'md', fullWidth = false, disabled, ...rest }: ButtonProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stretched = fullWidth && fontScale >= FULL_WIDTH_FONT_SCALE;

  let backgroundColor: string | undefined;
  let textColor: string;
  let borderColor: string | undefined;
  let borderWidth = 0;

  switch (variant) {
    case 'primary':
      backgroundColor = colors.primaryBg;
      textColor = colors.primaryFg;
      break;
    case 'destructive':
      backgroundColor = colors.lossFill;
      textColor = colors.onAccent;
      break;
    case 'secondary':
      backgroundColor = colors.secondaryBg === 'transparent' ? undefined : colors.secondaryBg;
      borderColor = colors.secondaryBorder;
      textColor = colors.secondaryFg;
      borderWidth = 1;
      break;
    case 'ghost':
    default:
      backgroundColor = undefined;
      textColor = colors.text;
      break;
  }

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={[
        styles.base,
        {
          minHeight: MIN_HEIGHT[size],
          paddingHorizontal: PADDING_X[size],
          paddingVertical: PADDING_Y[size],
          borderRadius: radius.md,
          backgroundColor,
          borderWidth,
          borderColor,
          opacity: disabled ? 0.5 : 1,
          width: stretched ? '100%' : undefined,
        },
      ]}
      {...rest}
    >
      <View style={styles.content}>
        <Text
          variant={size === 'md' ? 'headline' : 'callout'}
          color={textColor}
          numberOfLines={2}
          ellipsizeMode="clip"
          style={styles.label}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
