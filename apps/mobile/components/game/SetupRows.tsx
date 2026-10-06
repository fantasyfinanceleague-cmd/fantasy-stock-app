/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View, ViewProps } from 'react-native';

import { radius, space, typeFontFamily } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// 3c-2 — the row vocabulary of the board's setup frames (DraftSettingsScreen,
// RibReview: a card of `ks-rows`, each a callout-weight key, a muted value and
// a chevron when it opens something). Nothing here truncates: titles, values
// and help lines wrap at every Dynamic Type size (§9B). Every pressable row is
// at least 44 pt tall.

/** A setup card: the board's `ks-card` (surface, 14 pt corners). */
export function SetupCard({ style, children, ...rest }: ViewProps) {
  return (
    <Card style={[styles.card, style]} {...rest}>
      {children}
    </Card>
  );
}

/** The hairline between rows inside a SetupCard. */
export function RowDivider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.line }]} />;
}

/** A section's bold key, the board's `ks-callout` at weight 600. */
export function RowKey({ children }: { children: string }) {
  return (
    <Text variant="callout" style={styles.key}>
      {children}
    </Text>
  );
}

export interface SettingRowProps {
  label: string;
  value?: string;
  sub?: string;
  /** Colours the value (e.g. warnText for a TBD draft date). */
  valueColor?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Overrides the VoiceOver label (default: label, value). */
  accessibilityLabel?: string;
}

/** Key, value, optional sub-line, and a chevron when it opens something. */
export function SettingRow({ label, value, sub, valueColor, onPress, disabled = false, accessibilityLabel }: SettingRowProps) {
  const body = (
    <View style={[styles.settingRow, disabled && styles.dim]}>
      <View style={styles.grow}>
        <RowKey>{label}</RowKey>
        {sub ? (
          <Text variant="caption" tone="secondary">
            {sub}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" tone="secondary" color={valueColor} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chevronRight" size="callout" tone="text2" /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      accessibilityState={{ disabled }}
    >
      {body}
    </Pressable>
  );
}

export interface ChoiceRowProps {
  title: string;
  help?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

/** One option of a single choice (a radio): the title, a help line, and a
 * check on the selected one (the League sheet's selection mark). */
export function ChoiceRow({ title, help, selected, onPress, disabled = false }: ChoiceRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={[styles.choiceRow, disabled && styles.dim]}
    >
      <View style={styles.grow}>
        <Text variant="callout" style={styles.key}>
          {title}
        </Text>
        {help ? (
          <Text variant="caption" tone="secondary">
            {help}
          </Text>
        ) : null}
      </View>
      <View style={styles.check}>{selected ? <Icon name="check" size="headline" tone="accent" /> : null}</View>
    </Pressable>
  );
}

export interface SwitchRowProps {
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

/** A label, an optional help line, and a Switch. */
export function SwitchRow({ label, sub, value, onValueChange, disabled = false }: SwitchRowProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.settingRow, disabled && styles.dim]}>
      <View style={styles.grow}>
        <RowKey>{label}</RowKey>
        {sub ? (
          <Text variant="caption" tone="secondary">
            {sub}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.border, true: colors.accent }}
      />
    </View>
  );
}

/** The board's warn-tint card (ByeNotice, setup blockers): informational by
 * default (a note); `alert` when it explains why an action is refused. No icon
 * (§9B: refusals and blockers keep their warn-tint card, with no icon). */
export function WarnNote({ title, line, alert = false }: { title: string; line?: string; alert?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole={alert ? 'alert' : 'text'}
      style={[styles.warn, { backgroundColor: colors.warnTint, borderColor: colors.warnLine }]}
    >
      <Text variant="callout" style={styles.key}>
        {title}
      </Text>
      {line ? <Text variant="caption">{line}</Text> : null}
    </View>
  );
}

/** A neutral note with the lock icon (League settings while locked; Design
 * Lead ruling): informational, not a warning, so `sunken`, not the warn tint. */
export function LockNote({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={[styles.lock, { backgroundColor: colors.sunken }]}>
      <Icon name="lock" size="callout" tone="text2" />
      <Text variant="callout" tone="secondary" style={styles.grow}>
        {text}
      </Text>
    </View>
  );
}

/** Children in a row container with a gap (for chips, buttons). */
export function RowWrap({ children }: { children: ReactNode }) {
  return <View style={styles.wrap}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
    paddingVertical: space[2],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  key: {
    fontFamily: typeFontFamily.semiBold,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 44,
    paddingVertical: space[4],
  },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 44,
    paddingVertical: space[4],
  },
  grow: {
    flex: 1,
    gap: space[1],
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  check: {
    width: 24,
    alignItems: 'center',
  },
  dim: {
    opacity: 0.5,
  },
  warn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[1],
  },
  lock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
});
