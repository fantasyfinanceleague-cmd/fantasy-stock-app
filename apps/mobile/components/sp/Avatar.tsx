/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Image, StyleSheet, View } from 'react-native';

import { color } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { initialFontSize } from '@/components/sp/logic/avatar';

// Stockpile — <Avatar> (Phase 2 foundation). Used for the Home header avatar
// button (Profile leaves the tab bar per DESIGN_DIRECTION §3 decision 4) and
// anywhere a member/opponent needs a face — a photo when we have a URI,
// otherwise their initial on a brand-tinted circle.

export interface AvatarProps {
  uri?: string | null;
  /** Display name — only its first character is shown when there's no photo. */
  name: string;
  size?: number;
}

const DEFAULT_SIZE = 36;

export function Avatar({ uri, name, size = DEFAULT_SIZE }: AvatarProps) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  // Blue (`color.brand`) means "you" elsewhere in the app (§9 team colour),
  // so an avatar with no real initial to show shouldn't borrow that meaning
  // for someone unidentified — it gets a neutral fill instead (Design Lead,
  // 2026-09-29).
  const isUnknown = initial === '?';

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, dimension]} accessibilityLabel={name} />;
  }

  // Design Lead, 2026-09-29 (DESIGN-CHANGES follow-up): the initial is a
  // GLYPH inside a fixed-diameter circle, not running text — scaling it with
  // Dynamic Type outgrows the circle and clips ("G"/"?" clipped in the xl-03
  // capture). Sized proportionally to the circle (components/sp/logic/avatar.ts,
  // so it stays legible at any `size` this component is ever given) and
  // rendered with allowFontScaling={false} so the system font setting can't
  // grow it past that either — two independent causes of the same clip.
  return (
    <View style={[styles.fallback, isUnknown ? styles.fallbackNeutral : null, dimension]} accessibilityLabel={name}>
      <Text
        variant="callout"
        color={isUnknown ? color.text.secondary : color.action.primary.fg}
        allowFontScaling={false}
        style={{ fontSize: initialFontSize(size), lineHeight: initialFontSize(size) }}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: color.surface.money.sunken,
  },
  fallback: {
    backgroundColor: color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackNeutral: {
    backgroundColor: color.surface.game.line,
  },
});
