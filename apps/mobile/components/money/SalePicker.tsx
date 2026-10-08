/**
 * SalePicker: "Which sale pays for this?" (3e, board #money). A per-slot buy is
 * paid from one sale's proceeds; this lists the server's sources, one radio row
 * each, and commits the chosen one. Rows come from salePicker.pickerRows; this
 * file only lays them out.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { formatMoney } from '@/components/sp/logic/money';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import type { PreviewSource } from '@/lib/money/buyingPower';
import { COPY } from '@/lib/money/moneyCopy';
import { pickerRows } from '@/lib/money/salePicker';

export interface SalePickerProps {
  sources: PreviewSource[];
  chosenId: string | null;
  symbol: string;
  onChoose: (tradeId: string) => void;
  onUse: () => void;
  onClose: () => void;
}

const styles = StyleSheet.create({
  stack: { gap: 12, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  card: { borderRadius: 12, overflow: 'hidden' },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  radio: { width: 20, height: 20, borderRadius: 10 },
  rowLead: { flex: 1 },
});

/** The radio: a filled ring when chosen, a hairline ring otherwise. */
function Radio({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.radio,
        { borderWidth: selected ? 6 : 2, borderColor: selected ? colors.accent : colors.border },
      ]}
    />
  );
}

export function SalePicker({ sources, chosenId, symbol, onChoose, onUse, onClose }: SalePickerProps) {
  const { colors } = useTheme();
  const rows = pickerRows(sources, chosenId);
  const chosen = rows.some((r) => r.selected);

  return (
    <View style={styles.stack}>
      <View style={styles.header}>
        <Text variant="title">{COPY.whichSalePays}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.close}>
          <Icon name="close" size="body" tone="text2" />
        </Pressable>
      </View>

      <Text variant="callout" tone="secondary">{COPY.pickerCaption}</Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
        {rows.map((r) => (
          <Pressable
            key={r.tradeId}
            accessibilityRole="radio"
            accessibilityState={{ checked: r.selected }}
            accessibilityLabel={`${r.label}, ${formatMoney(r.amount)}`}
            onPress={() => onChoose(r.tradeId)}
            style={styles.row}
          >
            <Radio selected={r.selected} />
            <View style={styles.rowLead}>
              <Text variant="callout">{r.label}</Text>
            </View>
            <Text variant="callout">{formatMoney(r.amount)}</Text>
          </Pressable>
        ))}
      </View>

      <Button label={COPY.useSaleButton(symbol)} variant="primary" fullWidth disabled={!chosen} onPress={onUse} />
    </View>
  );
}
