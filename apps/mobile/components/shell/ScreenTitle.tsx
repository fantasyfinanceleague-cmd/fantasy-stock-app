import { StyleProp, TextStyle } from 'react-native';

import { Text } from '@/components/sp/Text';

// Phase 3b-1 — a screen's heading ("Welcome back", "Pick a username", …) in
// the `display` style. sp/Text keeps `display` on ONE line by default,
// because it also sets big numbers that must never wrap; a heading must
// wrap instead, or at accessibility sizes it truncates ("Pick a usern…").
// numberOfLines 0 = unlimited. Always announced as a header.
export function ScreenTitle({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  return (
    <Text variant="display" numberOfLines={0} accessibilityRole="header" style={style}>
      {children}
    </Text>
  );
}
