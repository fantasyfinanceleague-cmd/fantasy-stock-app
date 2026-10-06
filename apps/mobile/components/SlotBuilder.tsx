/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
// SlotBuilder (mobile) — commissioner roster-slot editor (Phase 4 item 4,
// DR-001 draft constraint system). RN mirror of the web SlotBuilder: a slot =
// {count, price bracket?, category?}; no filters = flex. Feasibility is a
// WARNING, never a gate; partial enrichment shows a lower-bound caveat.
//
// 3c-2: rewritten on the sp primitives (no board frame; composed from the
// setup vocabulary). The props, the state and every rule are unchanged — the
// copy and input sanitising moved to lib/game/slotBuilderCopy.ts verbatim.
// Hard errors are field errors (danger text, instant, no icon, §9B): a slot's
// own errors inside its card, the capacity line under the list;
// availability warnings use the warn-tint note; the category opens a sheet.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import {
  type Category,
  type SlotDraft,
  countSlotMatches,
  fetchEnrichmentProgress,
  validateSlotConfig,
} from '@/lib/categoryData';
import {
  EMPTY_SLOT,
  SLOT_CHECK_FAILED,
  SLOT_PARTIAL_NOTE,
  categoryLabel,
  countInput,
  priceInput,
  SLOT_FIELD_LABELS,
  removeSlotLabel,
  slotFieldA11y,
  slotShort,
  slotShortfallCopy,
  slotTitle,
  splitSlotErrors,
} from '@/lib/game/slotBuilderCopy';
import { space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Field } from '@/components/shell/Field';
import { ChoiceRow, RowDivider, RowWrap, SettingRow, SetupCard, WarnNote } from '@/components/game/SetupRows';

interface SlotBuilderProps {
  slots: SlotDraft[];
  onChange: (slots: SlotDraft[]) => void;
  categories: Category[];
  leagueSize: number;
  numRounds: number;
  disabled?: boolean;
}

/** At accessibility sizes the three fields stack instead of squeezing side by side. */
const STACK_FONT_SCALE = 1.35;

export default function SlotBuilder({ slots, onChange, categories, leagueSize, numRounds, disabled }: SlotBuilderProps) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_FONT_SCALE;
  const [warnings, setWarnings] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [partialNote, setPartialNote] = useState(false);
  const [categoryPickerFor, setCategoryPickerFor] = useState<number | null>(null);

  const setSlot = (i: number, patch: Partial<SlotDraft>) => {
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const addSlot = () => onChange([...slots, { ...EMPTY_SLOT }]);
  const removeSlot = (i: number) => onChange(slots.filter((_, idx) => idx !== i));

  // HARD errors (count/capacity/bracket) — parents use the same validator to
  // disable Next/save; this component shows the reasons.
  const hardErrors = validateSlotConfig(slots, numRounds);
  // Each slot's own errors show inside its card; the capacity line under the list.
  const { bySlot, general } = splitSlotErrors(hardErrors);

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
        if (slotShort(matches, leagueSize, s.slotCount)) {
          found.push(slotShortfallCopy(i, matches, leagueSize, s.slotCount));
        }
      }
    } catch {
      found.push(SLOT_CHECK_FAILED);
    }
    setWarnings(found);
    setChecking(false);
  };

  useEffect(() => {
    setWarnings([]);
  }, [JSON.stringify(slots)]); // eslint-disable-line react-hooks/exhaustive-deps

  const picking = categoryPickerFor !== null ? slots[categoryPickerFor] : undefined;
  const pick = (categoryId: string) => {
    if (categoryPickerFor !== null) setSlot(categoryPickerFor, { categoryId });
    setCategoryPickerFor(null);
  };

  return (
    <View style={styles.stack}>
      {slots.map((s, i) => (
        <SetupCard key={i}>
          <View style={styles.slotHead}>
            <Text variant="headline" style={styles.grow}>
              {slotTitle(i)}
            </Text>
            <Pressable
              onPress={() => !disabled && removeSlot(i)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: !!disabled }}
              style={styles.remove}
            >
              <Icon name="close" size="headline" tone={disabled ? 'text3' : 'text2'} label={removeSlotLabel(i)} />
            </Pressable>
          </View>
          <View style={[styles.fields, stacked && styles.fieldsStacked, disabled && styles.dim]}>
            <View style={styles.field}>
              <Field
                label={SLOT_FIELD_LABELS.count}
                accessibilityLabel={slotFieldA11y(i, 'count')}
                value={s.slotCount}
                editable={!disabled}
                keyboardType="numeric"
                placeholder="1"
                onChangeText={(t) => setSlot(i, { slotCount: countInput(t) })}
              />
            </View>
            <View style={styles.field}>
              <Field
                label={SLOT_FIELD_LABELS.min}
                accessibilityLabel={slotFieldA11y(i, 'min')}
                value={s.priceMin}
                editable={!disabled}
                keyboardType="numeric"
                placeholder="any"
                onChangeText={(t) => setSlot(i, { priceMin: priceInput(t) })}
              />
            </View>
            <View style={styles.field}>
              <Field
                label={SLOT_FIELD_LABELS.max}
                accessibilityLabel={slotFieldA11y(i, 'max')}
                value={s.priceMax}
                editable={!disabled}
                keyboardType="numeric"
                placeholder="any"
                onChangeText={(t) => setSlot(i, { priceMax: priceInput(t) })}
              />
            </View>
          </View>
          {bySlot[i]?.length ? (
            <View accessibilityLiveRegion="polite" style={styles.slotErrors}>
              {bySlot[i].map((e, k) => (
                <Text key={k} variant="callout" color={colors.danger}>
                  {e}
                </Text>
              ))}
            </View>
          ) : null}
          <RowDivider />
          <SettingRow
            label="Category"
            value={categoryLabel(s.categoryId, categories)}
            onPress={() => !disabled && setCategoryPickerFor(i)}
            disabled={disabled}
          />
        </SetupCard>
      ))}

      {general.length > 0 ? (
        <View accessibilityLiveRegion="polite" style={styles.errors}>
          {general.map((e, i) => (
            <Text key={`h${i}`} variant="callout" color={colors.danger}>
              {e}
            </Text>
          ))}
        </View>
      ) : null}
      {warnings.map((w, i) => (
        <WarnNote key={i} title={w} />
      ))}
      {partialNote && slots.length > 0 ? (
        <Text variant="caption" tone="secondary">
          {SLOT_PARTIAL_NOTE}
        </Text>
      ) : null}

      <RowWrap>
        <Button label="Add slot" variant="secondary" size="sm" onPress={addSlot} disabled={disabled} />
        {slots.length > 0 ? (
          <Button
            label="Check availability"
            variant="secondary"
            size="sm"
            onPress={checkFeasibility}
            disabled={disabled}
            status={checking ? 'loading' : 'idle'}
          />
        ) : null}
      </RowWrap>

      <Sheet visible={categoryPickerFor !== null} onClose={() => setCategoryPickerFor(null)}>
        <ScrollView contentContainerStyle={styles.sheetBody}>
          <Text variant="title" accessibilityRole="header">
            Category
          </Text>
          <View>
            <ChoiceRow title="Any (flex)" selected={!picking?.categoryId} onPress={() => pick('')} />
            {categories
              .filter((c) => !c.is_misc)
              .map((c) => (
                <View key={c.id}>
                  <RowDivider />
                  <ChoiceRow title={c.name} selected={picking?.categoryId === c.id} onPress={() => pick(c.id)} />
                </View>
              ))}
          </View>
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[4],
  },
  slotHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: space[2],
  },
  grow: {
    flex: 1,
  },
  remove: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -space[3],
  },
  fields: {
    flexDirection: 'row',
    gap: space[3],
    paddingBottom: space[4],
  },
  fieldsStacked: {
    flexDirection: 'column',
  },
  dim: {
    opacity: 0.5,
  },
  field: {
    flex: 1,
  },
  errors: {
    gap: space[2],
  },
  slotErrors: {
    gap: space[1],
    paddingBottom: space[4],
  },
  sheetBody: {
    paddingHorizontal: space[6],
    paddingBottom: space[4],
    gap: space[3],
  },
});
