/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { space, typeFontFamily } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { EARLIEST_NOTE, PICKER_HELPER, earliestDraftMs, pickerLine } from '@/lib/game/autoStart';
import { SET_DRAFT_TIME, SET_LATER, draftTimeSheet, shownDraftTime, type SheetAction } from '@/lib/game/draftTimeSheet';

// 3c-2 — the Draft time sheet (board #call-auto-start "Draft time sheet"; layout
// B on #call-ux-pass1, Giorgio's ruling): 15-minute steps; the earliest time is
// an hour out (up to the next quarter hour), and earlier times are greyed by the
// picker's minimum, so there's no error to show; the wheel and the line below
// it are in ET. The sheet HOLDS the time locally (lib/game/draftTimeSheet) and
// writes only on the full-width "Set draft time" at the bottom; × and a swipe
// close without saving. "Set later" is a 44 pt text button, only where a time
// is optional. On Android the system picker is its own dialog: a choice updates
// the held time, and tapping the time reopens it.

export interface DraftDateSheetProps {
  visible: boolean;
  /** The caller's current time (null: none). The sheet opens on it and never writes it back. */
  initial: Date | null;
  /** "Set draft time": the only write of a time. */
  onConfirm: (date: Date) => void;
  /** "Set later" (TBD). Omitted where a time is required (a postponed draft, Home's no-time card). */
  onSetLater?: () => void;
  /** Close the sheet (× or a swipe, which write nothing; and after either button). */
  onClose: () => void;
}

export function DraftDateSheet({ visible, initial, onConfirm, onSetLater, onClose }: DraftDateSheetProps) {
  const { colors, resolvedTheme } = useTheme();
  const [local, setLocal] = useState<Date | null>(null);
  const [androidPicking, setAndroidPicking] = useState(false);

  // Opening seeds the held time from the caller's; nothing is written.
  useEffect(() => {
    if (!visible) return;
    setLocal(draftTimeSheet(null, { type: 'open', current: initial, now: new Date() }).local);
    setAndroidPicking(Platform.OS !== 'ios');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per opening; `initial` changing while open must not reset the wheel.
  }, [visible]);

  const run = (a: SheetAction) => {
    const step = draftTimeSheet(local, a);
    setLocal(step.local);
    if (step.write.kind === 'time') onConfirm(step.write.date);
    if (step.write.kind === 'later') onSetLater?.();
    if (!step.open) onClose();
  };

  const nowMs = Date.now();
  const shown = shownDraftTime(local, nowMs).getTime();
  const line = pickerLine(shown, nowMs);
  const picker = (
    <DateTimePicker
      value={new Date(shown)}
      mode="datetime"
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      minuteInterval={15}
      minimumDate={new Date(earliestDraftMs(nowMs))}
      timeZoneName="America/New_York"
      themeVariant={resolvedTheme}
      onChange={(event, selectedDate) => {
        if (Platform.OS !== 'ios') setAndroidPicking(false);
        if (event.type === 'set' && selectedDate) run({ type: 'spin', date: selectedDate });
      }}
    />
  );
  const lineText = (
    <Text variant="callout">
      <Text variant="callout" style={styles.bold}>{line.value}</Text>
      {line.earliest ? <Text variant="callout" tone="secondary">{` ${EARLIEST_NOTE}`}</Text> : null}
    </Text>
  );

  return (
    <Sheet visible={visible} onClose={() => run({ type: 'dismiss' })}>
      <View style={styles.body}>
        <View style={styles.head}>
          <Text variant="title" accessibilityRole="header" style={styles.grow}>
            Draft time
          </Text>
          <Pressable onPress={() => run({ type: 'dismiss' })} accessibilityRole="button" accessibilityLabel="Close" style={styles.close} hitSlop={8}>
            <Icon name="close" size="headline" tone="text2" />
          </Pressable>
        </View>
        {visible && (Platform.OS === 'ios' || androidPicking) ? picker : null}
        {Platform.OS === 'ios' ? lineText : (
          <Pressable onPress={() => setAndroidPicking(true)} accessibilityRole="button" style={styles.tapTarget}>
            {lineText}
          </Pressable>
        )}
        <Text variant="caption" tone="secondary">
          {PICKER_HELPER}
        </Text>
        <Button label={SET_DRAFT_TIME} onPress={() => run({ type: 'confirm', nowMs: Date.now() })} fullWidth />
        {onSetLater ? (
          <Pressable onPress={() => run({ type: 'set_later' })} accessibilityRole="button" style={styles.textButton}>
            <Text variant="callout" color={colors.accent} style={styles.bold}>
              {SET_LATER}
            </Text>
          </Pressable>
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
  close: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tapTarget: {
    minHeight: 44,
    justifyContent: 'center',
  },
  textButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bold: {
    fontFamily: typeFontFamily.bold,
  },
});
