/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { initialFontSize } from '@/components/sp/logic/avatar';

// Stockpile — <Avatar> (§9A, "One design, two themes", 2026-09-29). Used for
// the Home header avatar button (Profile leaves the tab bar per
// DESIGN_DIRECTION §3 decision 4) and anywhere a member/opponent needs a
// face — a photo when we have a URI, otherwise their initial on a
// "you"-coloured circle (colors.you / colors.onAccent — the PAIRS list's own
// "Avatar initials" pair, board.jsx-verified 4.5:1 in both themes).

export interface AvatarProps {
  uri?: string | null;
  /** Display name — only its first character is shown when there's no photo. */
  name: string;
  size?: number;
}

const DEFAULT_SIZE = 36;

export function Avatar({ uri, name, size = DEFAULT_SIZE }: AvatarProps) {
  const { colors } = useTheme();
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  // Blue (colors.you) means "you" elsewhere in the app (§9A team colour), so
  // an avatar with no real initial to show shouldn't borrow that meaning for
  // someone unidentified — it gets a neutral fill instead (Design Lead,
  // 2026-09-29).
  const isUnknown = initial === '?';

  if (uri) {
    return <Image source={{ uri }} style={[{ backgroundColor: colors.sunken }, dimension]} accessibilityLabel={name} />;
  }

  // Design Lead, 2026-09-29 (DESIGN-CHANGES follow-up): the initial is a
  // GLYPH inside a fixed-diameter circle, not running text — scaling it with
  // Dynamic Type outgrows the circle and clips ("G"/"?" clipped in the xl-03
  // capture). Sized proportionally to the circle (components/sp/logic/avatar.ts,
  // so it stays legible at any `size` this component is ever given) and
  // rendered with allowFontScaling={false} so the system font setting can't
  // grow it past that either — two independent causes of the same clip.
  return (
    <View
      style={[styles.fallback, { backgroundColor: isUnknown ? colors.line : colors.you }, dimension]}
      accessibilityLabel={name}
    >
      <Text
        variant="callout"
        color={isUnknown ? colors.text2 : colors.onAccent}
        allowFontScaling={false}
        style={{ fontSize: initialFontSize(size), lineHeight: initialFontSize(size) }}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
