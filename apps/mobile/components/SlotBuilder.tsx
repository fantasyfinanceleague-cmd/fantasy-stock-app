// SlotBuilder (mobile) — commissioner roster-slot editor (Phase 4 item 4,
// DR-001 draft constraint system). RN mirror of the web SlotBuilder: a slot =
// {count, price bracket?, category?}; no filters = flex. Feasibility is a
// WARNING, never a gate; partial enrichment shows a lower-bound caveat.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import {
  type Category,
  type SlotDraft,
  countSlotMatches,
  fetchEnrichmentProgress,
  validateSlotConfig,
} from '@/lib/categoryData';

interface SlotBuilderProps {
  slots: SlotDraft[];
  onChange: (slots: SlotDraft[]) => void;
  categories: Category[];
  leagueSize: number;
  numRounds: number;
  disabled?: boolean;
}

export default function SlotBuilder({ slots, onChange, categories, leagueSize, numRounds, disabled }: SlotBuilderProps) {
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [partialNote, setPartialNote] = useState(false);
  const [categoryPickerFor, setCategoryPickerFor] = useState<number | null>(null);

  const setSlot = (i: number, patch: Partial<SlotDraft>) => {
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addSlot = () => onChange([...slots, { slotCount: 1, priceMin: '', priceMax: '', categoryId: '' }]);
  const removeSlot = (i: number) => onChange(slots.filter((_, idx) => idx !== i));

  // HARD errors (count/capacity/bracket) — parents use the same validator to
  // disable Next/save; this component shows the reasons.
  const hardErrors = validateSlotConfig(slots, numRounds);

  const categoryName = (id: string) =>
    id ? categories.find((c) => c.id === id)?.name ?? 'Unknown' : 'Any (flex)';

  const checkFeasibility = async () => {
    setChecking(true);
    const found: string[] = [];
    try {
      const progress = await fetchEnrichmentProgress();
      setPartialNote(progress.partial);
      // Per-slot availability counts query is_draftable / last_price /
      // gics_industry — ALL populated only by the enrichment cron. Below
      // coverage the counts are near-zero noise (not "lower bounds"), so
      // they are SUPPRESSED entirely; the hard capacity math above is local
      // and stays enforced.
      if (progress.partial) {
        setWarnings([]);
        setChecking(false);
        return;
      }
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const matches = await countSlotMatches({
          priceMin: s.priceMin === '' ? null : Number(s.priceMin),
          priceMax: s.priceMax === '' ? null : Number(s.priceMax),
          categoryId: s.categoryId || null,
        });
        const needed = leagueSize * (Number(s.slotCount) || 1);
        if (matches < needed) {
          found.push(
            `Slot ${i + 1}: only ${matches} draftable stock${matches === 1 ? '' : 's'} match — the league needs at least ${needed} (${leagueSize} teams × ${s.slotCount}).`,
          );
        }
      }
    } catch {
      found.push('Could not check availability — try again.');
    }
    setWarnings(found);
    setChecking(false);
  };

  useEffect(() => {
    setWarnings([]);
  }, [JSON.stringify(slots)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View>
      {slots.map((s, i) => (
        <View key={i} style={styles.slotCard}>
          <View style={styles.slotRow}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Count</Text>
              <TextInput
                style={styles.input}
                value={String(s.slotCount)}
                editable={!disabled}
                keyboardType="numeric"
                onChangeText={(t) => setSlot(i, { slotCount: Math.max(1, parseInt(t) || 1) })}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Min $</Text>
              <TextInput
                style={styles.input}
                value={s.priceMin}
                editable={!disabled}
                keyboardType="numeric"
                placeholder="any"
                placeholderTextColor={Colors.textDark}
                onChangeText={(t) => setSlot(i, { priceMin: t.replace(/[^0-9.]/g, '') })}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Max $</Text>
              <TextInput
                style={styles.input}
                value={s.priceMax}
                editable={!disabled}
                keyboardType="numeric"
                placeholder="any"
                placeholderTextColor={Colors.textDark}
                onChangeText={(t) => setSlot(i, { priceMax: t.replace(/[^0-9.]/g, '') })}
              />
            </View>
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => !disabled && removeSlot(i)}
              disabled={disabled}
            >
              <Ionicons name="close" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.categoryButton}
            onPress={() => !disabled && setCategoryPickerFor(categoryPickerFor === i ? null : i)}
            disabled={disabled}
          >
            <Text style={styles.categoryButtonText}>{categoryName(s.categoryId)}</Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textMuted} />
          </TouchableOpacity>

          {categoryPickerFor === i && (
            <View style={styles.categoryList}>
              <TouchableOpacity
                style={styles.categoryOption}
                onPress={() => { setSlot(i, { categoryId: '' }); setCategoryPickerFor(null); }}
              >
                <Text style={styles.categoryOptionText}>Any (flex)</Text>
              </TouchableOpacity>
              {categories.filter((c) => !c.is_misc).map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.categoryOption}
                  onPress={() => { setSlot(i, { categoryId: c.id }); setCategoryPickerFor(null); }}
                >
                  <Text style={styles.categoryOptionText}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      ))}

      {hardErrors.map((e, i) => (
        <Text key={`h${i}`} style={styles.hardError}>{e}</Text>
      ))}
      {warnings.map((w, i) => (
        <Text key={i} style={styles.warning}>{w}</Text>
      ))}
      {partialNote && slots.length > 0 && (
        <Text style={styles.note}>
          Stock data is still loading (takes ~2 days after launch) — per-slot availability
          checks are paused until it completes. Slot count math is still enforced.
        </Text>
      )}

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={addSlot} disabled={disabled}>
          <Text style={styles.actionBtnText}>+ Add slot</Text>
        </TouchableOpacity>
        {slots.length > 0 && (
          <TouchableOpacity style={styles.actionBtn} onPress={checkFeasibility} disabled={disabled || checking}>
            <Text style={styles.actionBtnText}>{checking ? 'Checking…' : 'Check availability'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slotCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  slotRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  field: { flex: 1 },
  fieldLabel: { fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  removeBtn: { padding: 8 },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryButtonText: { color: Colors.textPrimary, fontSize: 13 },
  categoryList: {
    marginTop: 4,
    backgroundColor: Colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  categoryOption: { paddingHorizontal: 12, paddingVertical: 10 },
  categoryOptionText: { color: Colors.textPrimary, fontSize: 13 },
  warning: {
    color: '#F59E0B',
    fontSize: 12,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    lineHeight: 16,
  },
  note: { color: Colors.textMuted, fontSize: 12, marginBottom: 6 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnText: { color: Colors.textPrimary, fontSize: 13 },
  hardError: {
    color: Colors.error,
    fontSize: 12,
    backgroundColor: Colors.errorBg,
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    lineHeight: 16,
  },
});
