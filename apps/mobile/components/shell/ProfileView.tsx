/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { radius, space, type } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { Avatar } from '@/components/sp/Avatar';
import { FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme, type ThemePreference } from '@/components/sp/ThemeProvider';

// Phase 3b-1 — Profile (spec row 11, board "Profile"). It left the tab bar;
// the Home avatar opens it. Username (→ the Pick-a-username validation in
// edit mode), email once, Change password, Appearance, Sign out (danger
// text), and the real app version from app.json (Constants.expoConfig) —
// the old screen hard-coded "Version 1.0.0". Account created / Last sign in
// / the emoji avatar picker / "Open Web App" are dropped (Design Lead,
// approved).

const APPEARANCE_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export interface ProfileViewProps {
  username: string | null;
  email: string | null;
  onUsername: () => void;
  onChangePassword: () => void;
  onAppearance: () => void;
  onSignOut: () => void;
}

export function ProfileView({ username, email, onUsername, onChangePassword, onAppearance, onSignOut }: ProfileViewProps) {
  const { colors, preference, elevation } = useTheme();
  const version = Constants.expoConfig?.version ?? '';
  const cardStyle = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation.card];

  return (
    <>
      <View style={styles.identity}>
        <Avatar name={username ?? email ?? ''} size={84} />
        {username ? (
          <Text variant="title" accessibilityRole="header">
            {username}
          </Text>
        ) : null}
      </View>

      <View style={cardStyle}>
        <Row label="Username" value={username ?? ''} onPress={onUsername} first />
        <Row label="Email" value={email ?? ''} />
        <Row label="Change password" onPress={onChangePassword} />
        <Row label="Appearance" value={APPEARANCE_LABEL[preference]} onPress={onAppearance} />
      </View>

      <View style={cardStyle}>
        <Row label="Sign out" onPress={onSignOut} danger first />
      </View>

      <Text variant="caption" tone="secondary" style={styles.version}>
        {`${brand.name} ${version}`}
      </Text>
    </>
  );
}

function Row({ label, value, onPress, danger = false, first = false }: { label: string; value?: string; onPress?: () => void; danger?: boolean; first?: boolean }) {
  const { colors } = useTheme();
  // At accessibility sizes the value moves under its label (full width, wrapping)
  // instead of being squeezed into an ellipsis beside it — nothing truncates.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;
  const text = (
    <View style={stacked ? styles.rowTextStacked : styles.rowTextInline}>
      <Text variant="body" color={danger ? colors.danger : colors.text} style={styles.rowLabel}>
        {label}
      </Text>
      {value ? (
        <Text variant="body" tone="secondary" numberOfLines={stacked ? undefined : 1} style={stacked ? null : styles.rowValue}>
          {value}
        </Text>
      ) : null}
    </View>
  );
  const content = (
    <>
      {text}
      {onPress && !danger ? <Ionicons name="chevron-forward" size={16} color={colors.text2} /> : null}
    </>
  );
  const rowStyle = [styles.row, first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line }];
  if (!onPress) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={value ? `${label}, ${value}` : label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} style={rowStyle}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    gap: space[3],
    paddingTop: space[2],
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space[5],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: 50,
    paddingVertical: space[4],
  },
  rowTextInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  rowTextStacked: {
    flex: 1,
    gap: space[1],
  },
  rowLabel: {
    fontFamily: type.headline.fontFamily,
  },
  rowValue: {
    flex: 1,
    textAlign: 'right',
  },
  version: {
    textAlign: 'center',
  },
});
