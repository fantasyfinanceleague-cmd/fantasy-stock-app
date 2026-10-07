/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { useTheme } from '@/components/sp/ThemeProvider';
import { radius, space } from '@/constants/tokens';
import SymbolSearchField from '@/components/SymbolSearchField';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import type { ShapedSearchResult } from '@/lib/symbolSearch';
import { normalizeQueue, moveItem, removeItem, addSymbol, queueRefusalLine, QUEUE_MAX } from '@/lib/game/draftQueue';

export interface QueueEditorProps {
  leagueId: string;
  initial: string[];
  onSaved: () => void;
}

/** The draft queue (3c): the stocks auto-pick takes first. Move, remove and add, then
 * save. The save is the server's set_draft_queue, and the server's refusal decides. */
export function QueueEditor({ leagueId, initial, onSaved }: QueueEditorProps) {
  const { colors } = useTheme();
  const [queue, setQueue] = useState<string[]>(() => normalizeQueue(initial));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const dirty = queue.join(',') !== normalizeQueue(initial).join(',');

  const onSelect = (r: ShapedSearchResult) => {
    if (!r.selectable) return;
    setQueue((q) => addSymbol(q, r.symbol));
    setSearch('');
  };

  const save = async () => {
    setSaving(true);
    const { data, error } = await seamRpc('set_draft_queue', { p_league_id: leagueId, p_symbols: queue });
    setSaving(false);
    const res = data as { ok?: boolean; reason?: string; symbols?: unknown } | null;
    if (error || !res || res.ok !== true) {
      Alert.alert('Not saved', queueRefusalLine(String(res?.reason ?? 'unknown'), res?.symbols));
      return;
    }
    onSaved();
  };

  return (
    <Card style={[styles.card, styles.searchCard]}>
      <Text variant="tag" tone="secondary">{`Your queue · ${queue.length} of ${QUEUE_MAX}`}</Text>
      <Text variant="caption" tone="secondary">If you step away, we'll auto-pick from your queue when your time runs out. You can come back any time.</Text>
      {queue.map((sym, i) => (
        <View key={sym} style={styles.row}>
          <Text variant="callout" style={styles.sym}>{sym}</Text>
          <Pressable onPress={() => setQueue((q) => moveItem(q, i, -1))} disabled={i === 0} accessibilityRole="button" accessibilityLabel={`Move ${sym} up`} style={styles.hit}>
            <Icon name="chevronUp" size="callout" tone={i === 0 ? 'text3' : 'text2'} />
          </Pressable>
          <Pressable onPress={() => setQueue((q) => moveItem(q, i, 1))} disabled={i === queue.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${sym} down`} style={styles.hit}>
            <Icon name="chevronDown" size="callout" tone={i === queue.length - 1 ? 'text3' : 'text2'} />
          </Pressable>
          <Pressable onPress={() => setQueue((q) => removeItem(q, i))} accessibilityRole="button" accessibilityLabel={`Remove ${sym} from your queue`} style={styles.hit}>
            <Icon name="close" size="callout" tone="text2" />
          </Pressable>
        </View>
      ))}
      {queue.length < QUEUE_MAX ? (
        <SymbolSearchField value={search} onChangeText={setSearch} onSelect={onSelect} selectedSymbol="" ownedSymbols={new Set()} />
      ) : null}
      <View style={styles.save}>
        <Button label="Save queue" onPress={() => void save()} disabled={!dirty || saving} />
      </View>
      <Text variant="caption" tone="secondary" style={{ color: colors.text2 }}>{dirty ? 'Not saved yet.' : ''}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both; DraftCountdownCard's).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  // The sp Card clips (overflow hidden), which cut the search's dropdown off at the card edge;
  // a search card lets it overflow, above the cards that follow it.
  searchCard: { overflow: 'visible', zIndex: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[1], minHeight: 44 },
  sym: { flex: 1, fontWeight: '600' },
  // Each icon button reaches 44 pt (the craft floor).
  hit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  save: { marginTop: space[2] },
});
