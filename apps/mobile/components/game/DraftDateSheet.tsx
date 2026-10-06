/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Platform, StyleSheet, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

import { space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';

// 3c-2 — the board draws the Draft date as a row ("Draft date · Sat, Oct 3 ·
// 7:00 PM ET ›"); this is what the row opens (no frame: composed). The caller
// keeps its own date state and handlers exactly as before; this sheet only
// hosts the picker. On Android the system picker is its own dialog, so a
// change closes the sheet, as the old inline picker closed itself.

export interface DraftDateSheetProps {
  visible: boolean;
  value: Date | null;
  onChange: (date: Date) => void;
  /** "Set later": the old "TBD - Set later" choice. */
  onSetLater: () => void;
  onClose: () => void;
}

export function DraftDateSheet({ visible, value, onChange, onSetLater, onClose }: DraftDateSheetProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">
          Draft date
        </Text>
        {visible ? (
          <DateTimePicker
            value={value || new Date()}
            mode="datetime"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            themeVariant={resolvedTheme}
            onChange={(_event, selectedDate) => {
              if (Platform.OS !== 'ios') onClose();
              if (selectedDate) onChange(selectedDate);
            }}
            minimumDate={new Date()}
          />
        ) : null}
        <View style={styles.actions}>
          <Button label="Done" onPress={onClose} />
          <Button
            label="Set later"
            variant="secondary"
            onPress={() => {
              onSetLater();
              onClose();
            }}
          />
        </View>
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
  actions: {
    gap: space[3],
  },
});
