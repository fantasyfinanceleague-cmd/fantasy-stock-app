/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { color, radius, space } from '@/constants/tokens';
import { PressableScale, PressableScaleProps } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <Button> (Phase 2 foundation). SOURCE OF TRUTH: §9.
// Amended 2026-09-26 after ui/foundation-web found the primary button
// invisible on stadium navy (`action.primary.bg` equals
// `color.surface.game.base`): every action colour now resolves per surface
// through <Surface>, not per call site. On a game surface, primary INVERTS
// to a white "broadcast chip"; secondary becomes a transparent fill with a
// light outline; ghost becomes white text. Destructive is unchanged on
// either surface — `color.status.danger` has no `.onGame` variant in §9,
// and red-on-navy already contrasts fine.
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
  const { kind } = useSurface();
  const { fontScale } = useWindowDimensions();
  const onGame = kind === 'game';
  const stretched = fullWidth && fontScale >= FULL_WIDTH_FONT_SCALE;

  let backgroundColor: string | undefined;
  let textColor: string;
  let borderColor: string | undefined;
  let borderWidth = 0;

  switch (variant) {
    case 'primary':
      backgroundColor = onGame ? color.action.primary.onGame.bg : color.action.primary.bg;
      textColor = onGame ? color.action.primary.onGame.fg : color.action.primary.fg;
      break;
    case 'destructive':
      // No `.onGame` variant in §9 — red-on-navy already contrasts fine.
      backgroundColor = color.status.danger;
      textColor = color.action.primary.fg;
      break;
    case 'secondary':
      backgroundColor = onGame ? undefined : color.action.secondary.bg;
      borderColor = onGame ? color.action.secondary.onGame.border : color.action.secondary.border;
      textColor = onGame ? color.action.secondary.onGame.fg : color.action.secondary.fg;
      borderWidth = 1;
      break;
    case 'ghost':
    default:
      backgroundColor = undefined;
      textColor = onGame ? color.action.ghost.onGame.fg : color.action.ghost.fg;
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
