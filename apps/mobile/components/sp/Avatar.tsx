/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Image, StyleSheet, View } from 'react-native';

import { color } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';

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

  if (uri) {
    return <Image source={{ uri }} style={[styles.image, dimension]} accessibilityLabel={name} />;
  }

  return (
    <View style={[styles.fallback, dimension]} accessibilityLabel={name}>
      <Text variant="callout" color={color.action.primary.fg}>
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
});
