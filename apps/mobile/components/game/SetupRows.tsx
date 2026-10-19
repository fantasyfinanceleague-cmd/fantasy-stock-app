/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode, useCallback, useState } from 'react';
import { LayoutChangeEvent, NativeSyntheticEvent, Pressable, StyleSheet, Switch, TextLayoutEventData, useWindowDimensions, View, ViewProps } from 'react-native';

import { radius, space, typeFontFamily } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { isStacked, nextBrokeAt } from '@/lib/game/labelBreaks';

// 3c-2 — the row vocabulary of the board's setup frames (DraftSettingsScreen,
// RibReview: a card of `ks-rows`, each a callout-weight key, a muted value and
// a chevron when it opens something). Game Night (W4): the card is the §9C Card (surface
// + rim), its rows divided by space, never by a line. Nothing here truncates: titles, values
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

/** Between rows inside a SetupCard: SPACE, never a line (Game Night §9C rule 2, "separation
 * by surface, never by rules"; W4 League). The name stays so every caller keeps its rhythm. */
export function RowDivider() {
  return <View style={styles.divider} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

/** A section's bold key, the board's `ks-callout` at weight 600. */
export function RowKey({ children, maxScale, onTextLayout }: { children: string; maxScale?: number; onTextLayout?: (e: NativeSyntheticEvent<TextLayoutEventData>) => void }) {
  return (
    <Text variant="callout" maxFontSizeMultiplier={maxScale} style={styles.key} onTextLayout={onTextLayout}>
      {children}
    </Text>
  );
}

/** Has this row's label broken inside a word? A row lays out as it always did (label beside its value and control); only
 * once its label breaks mid-word does it stack, so nothing moves at the sizes where every label fits. Reset when the
 * Dynamic Type size changes, so a smaller size lays out beside again. */
function useLabelBreaks() {
  const { fontScale } = useWindowDimensions();
  const [brokeAt, setBrokeAt] = useState<number | null>(null);
  const onTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      setBrokeAt((prev) => nextBrokeAt(prev, fontScale, { kind: 'lines', lines: e.nativeEvent.lines }));
    },
    [fontScale],
  );
  // A label squeezed to nothing reports no broken line (there was no room for one): its column's width says so.
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      setBrokeAt((prev) => nextBrokeAt(prev, fontScale, { kind: 'width', width: e.nativeEvent.layout.width }));
    },
    [fontScale],
  );
  return { broke: isStacked(brokeAt, fontScale), onTextLayout, onLayout };
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
  /** A Dynamic Type cap for the row's text, where the row sits on a screen whose figures
   * are capped (League: 1.5×, the gains' 19.5pt). Unset: the text scales freely (forms). */
  maxScale?: number;
}

/** Key, value, optional sub-line, and a chevron when it opens something. */
export function SettingRow({ label, value, sub, valueColor, onPress, disabled = false, accessibilityLabel, maxScale }: SettingRowProps) {
  // A static row without a help line always wraps: a value that cannot sit beside its label (an amount at XXXL, keepMoney)
  // drops UNDER it, so a label is never squeezed to nothing (W8 follow-up: Create league's summary lost "Name" and "Stakes").
  // Every other row (a chevron, or a help line, whose width is not the label's) keeps its one-line layout until its label
  // breaks inside a word, then stacks: the value and the chevron drop under the label (the label-no-midword round: a row
  // with a chevron broke "Commissioner" into "Commis / sioner" and lost "Draft time").
  const { broke, onTextLayout: onLabelLayout, onLayout: onLabelBox } = useLabelBreaks();
  const stack = (!onPress && !sub) || broke;
  // A value that runs to several lines reads LEFT (beside the label or stacked under it); a one-line value keeps the
  // right alignment it always had, which is the same pixel (left-aligned, it sits up to a pixel off the box's edge).
  const [valueLines, setValueLines] = useState(1);
  const chevron = <Icon name="chevronRight" size="callout" tone="text2" />;
  const valueText = value ? (
    <Text
      variant="callout"
      tone="secondary"
      color={valueColor}
      style={stack && valueLines > 1 ? [styles.value, styles.valueMulti] : styles.value}
      onTextLayout={stack ? (e) => setValueLines(e.nativeEvent.lines.length) : undefined}
    >
      {value}
    </Text>
  ) : null;
  const body = (
    <View style={[styles.settingRow, stack && styles.settingRowWrap, disabled && styles.dim]}>
      <View style={stack ? styles.growWrap : styles.grow} onLayout={onPress || sub ? onLabelBox : undefined}>
        <RowKey maxScale={maxScale} onTextLayout={onPress || sub ? onLabelLayout : undefined}>
          {label}
        </RowKey>
        {sub ? (
          <Text variant="caption" tone="secondary">
            {sub}
          </Text>
        ) : null}
      </View>
      {onPress && value && stack ? (
        // The chevron stays with its value once stacked: the pair wraps together, never a chevron alone on a line.
        <View style={styles.valueWithChevron}>
          {valueText}
          {chevron}
        </View>
      ) : (
        <>
          {valueText}
          {onPress ? stack ? <View style={styles.trailing}>{chevron}</View> : chevron : null}
        </>
      )}
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
  // Beside the label until the label breaks inside a word; then the switch drops under it (see SettingRow).
  const { broke, onTextLayout, onLayout } = useLabelBreaks();
  const sw = (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ false: colors.border, true: colors.accent }}
    />
  );
  return (
    <View style={[styles.settingRow, broke && styles.settingRowWrap, disabled && styles.dim]}>
      <View style={broke ? styles.growWrap : styles.grow} onLayout={onLayout}>
        <RowKey onTextLayout={onTextLayout}>{label}</RowKey>
        {sub ? (
          <Text variant="caption" tone="secondary">
            {sub}
          </Text>
        ) : null}
      </View>
      {broke ? <View style={styles.trailing}>{sw}</View> : sw}
    </View>
  );
}

/** The board's warn-tint card (ByeNotice, setup blockers): informational by
 * default (a note); `alert` when it explains why an action is refused. No icon
 * (§9B: refusals and blockers keep their warn-tint card, with no icon). Both lines read the
 * fill's own ink, `warnText` (§9C rule 4, as the money screens' WarnPanel; W4 Onboarding). */
export function WarnNote({ title, line, alert = false }: { title: string; line?: string; alert?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityRole={alert ? 'alert' : 'text'}
      style={[styles.warn, { backgroundColor: colors.warnTint, borderColor: colors.warnLine }]}
    >
      <Text variant="callout" color={colors.warnText} style={styles.key}>
        {title}
      </Text>
      {line ? <Text variant="caption" color={colors.warnText}>{line}</Text> : null}
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
    height: space[2],
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
  // Static rows: the label sizes to its content (flexBasis auto, not flex: 1's 0) so the row CAN wrap; the value
  // sits at the right edge beside the label, or drops UNDER it, at the left (space-between starts a lone item at the
  // start), like the Renewal review and the Join preview.
  settingRowWrap: {
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    // A wrapping row's lines hug the top (alignContent flex-start), where the one-line row centred in its minHeight:
    // keep a single line centred so nothing moves at normal size.
    alignContent: 'center',
    columnGap: space[3],
    rowGap: space[1],
  },
  // The label never shrinks: its basis is its own width, capped by the row's (a Text is measured at most the container
  // wide), so it only wraps BETWEEN words, and what does not fit beside it wraps to the next line instead.
  growWrap: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    gap: space[1],
  },
  // A control after the label (a chevron on its own, a switch): the right edge of whichever line it lands on.
  trailing: {
    marginLeft: 'auto',
  },
  // A value and its chevron: one wrap item, so the chevron is never left alone on a line. The value shrinks inside it
  // when it is longer than the line; otherwise the pair sits right after the label, as the one-line row always did.
  valueWithChevron: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: space[3],
    flexShrink: 1,
  },
  // The value's box shrink-wraps its text: on its own line it starts at the left, and several lines read left too.
  valueMulti: {
    textAlign: 'left',
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
