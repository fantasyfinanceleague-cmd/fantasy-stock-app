/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { space, typeFontFamily } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { EARLIEST_NOTE, PICKER_HELPER, earliestDraftMs, pickerLine } from '@/lib/game/autoStart';

// 3c-2 — the Draft time sheet (board #call-auto-start "Draft time sheet"; one term, "draft time"):
// 15-minute steps; the earliest time is an hour out (up to the next quarter
// hour), and earlier times are greyed by the picker's minimum, so there's no
// error to show; the wheel and the line below it are in ET. The caller keeps
// its own date state: it SEEDS the value when it opens the sheet
// (seedDraftDate), so accepting the shown time without spinning commits it.
// On Android the system picker is its own dialog, so a change closes the sheet.

export interface DraftDateSheetProps {
  visible: boolean;
  value: Date | null;
  onChange: (date: Date) => void;
  /** "Set later" (TBD). Omitted where a time is required (a postponed draft's new time). */
  onSetLater?: () => void;
  /** A dismiss (the backdrop, a swipe), and Done when there's no onDone. */
  onClose: () => void;
  /** Done (the header action, the board's), when it commits (a postponed draft's new time). */
  onDone?: () => void;
}

export function DraftDateSheet({ visible, value, onChange, onSetLater, onClose, onDone }: DraftDateSheetProps) {
  const { colors, resolvedTheme } = useTheme();
  const nowMs = Date.now();
  const earliest = earliestDraftMs(nowMs);
  const shown = value && value.getTime() >= earliest ? value.getTime() : earliest;
  const line = pickerLine(shown, nowMs);

  // What's shown is what's saved (the 1.1.0 bug): if the caller's value is
  // missing or has fallen below the earliest time (the sheet sat open), the
  // shown time is written back to the caller's state.
  const stale = visible && (!value || value.getTime() < earliest);
  useEffect(() => {
    if (stale) onChange(new Date(shown));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the value goes stale; onChange is a fresh closure each render.
  }, [stale, shown]);

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text variant="title" accessibilityRole="header" style={styles.grow}>
            Draft time
          </Text>
          <Pressable onPress={onDone ?? onClose} accessibilityRole="button" style={styles.done} hitSlop={8}>
            <Text variant="callout" color={colors.accent} style={styles.bold}>
              Done
            </Text>
          </Pressable>
        </View>
        {visible ? (
          <DateTimePicker
            // The caller seeded the state when it opened the sheet, so the value
            // shown is the value saved. Never earlier than the earliest time.
            value={new Date(shown)}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minuteInterval={15}
            minimumDate={new Date(earliest)}
            timeZoneName="America/New_York"
            themeVariant={resolvedTheme}
            onChange={(_event, selectedDate) => {
              if (Platform.OS !== 'ios') onClose();
              if (selectedDate) onChange(selectedDate);
            }}
          />
        ) : null}
        <Text variant="callout">
          <Text variant="callout" style={styles.bold}>{line.value}</Text>
          {line.earliest ? <Text variant="callout" tone="secondary">{` ${EARLIEST_NOTE}`}</Text> : null}
        </Text>
        <Text variant="caption" tone="secondary">
          {PICKER_HELPER}
        </Text>
        {onSetLater ? (
          <Button
            label="Set later"
            variant="secondary"
            onPress={() => {
              onSetLater();
              onClose();
            }}
          />
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space[4],
    paddingHorizontal: space[6],
    paddingBottom: space[4],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: {
    flex: 1,
  },
  done: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  bold: {
    fontFamily: typeFontFamily.bold,
  },
});
