/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { radius, space } from '@/constants/tokens';
import SymbolSearchField from '@/components/SymbolSearchField';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import type { ShapedSearchResult } from '@/lib/symbolSearch';
import { keepDots } from '@/lib/game/keepDots';
import { normalizeQueue, moveItem, removeItem, addSymbol, queueRefusalLine, QUEUE_MAX } from '@/lib/game/draftQueue';

export interface QueueEditorProps {
  leagueId: string;
  initial: string[];
  onSaved: () => void;
}

/** The draft queue (3c): the stocks auto-pick takes first. Move, remove and add, then
 * save. The save is the server's set_draft_queue, and the server's refusal decides. */
export function QueueEditor({ leagueId, initial, onSaved }: QueueEditorProps) {
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
      <Text variant="tag" tone="secondary">{keepDots(`Your queue · ${queue.length} of ${QUEUE_MAX}`)}</Text>
      <Text variant="caption" tone="secondary">If you step away, we'll auto-pick from your queue when your time runs out. You can come back any time.</Text>
      {/* Nothing tappable does nothing (W4): a move that can't happen isn't drawn (the first
          row has no up, the last no down); its 44 pt slot stays, so the columns hold still. */}
      {queue.map((sym, i) => (
        <View key={sym} style={styles.row}>
          <Text variant="caption" tone="secondary" style={styles.pos}>{i + 1}</Text>
          <Text variant="ticker" style={styles.sym}>{sym}</Text>
          {i > 0 ? (
            <Pressable onPress={() => setQueue((q) => moveItem(q, i, -1))} accessibilityRole="button" accessibilityLabel={`Move ${sym} up`} style={styles.hit}>
              <Icon name="chevronUp" size="callout" tone="text2" />
            </Pressable>
          ) : <View style={styles.hit} />}
          {i < queue.length - 1 ? (
            <Pressable onPress={() => setQueue((q) => moveItem(q, i, 1))} accessibilityRole="button" accessibilityLabel={`Move ${sym} down`} style={styles.hit}>
              <Icon name="chevronDown" size="callout" tone="text2" />
            </Pressable>
          ) : <View style={styles.hit} />}
          <Pressable onPress={() => setQueue((q) => removeItem(q, i))} accessibilityRole="button" accessibilityLabel={`Remove ${sym} from your queue`} style={styles.hit}>
            <Icon name="close" size="callout" tone="text2" />
          </Pressable>
        </View>
      ))}
      {queue.length < QUEUE_MAX ? (
        <SymbolSearchField value={search} onChangeText={setSearch} onSelect={onSelect} selectedSymbol="" ownedSymbols={new Set()} />
      ) : null}
      {/* Save appears with something to save, beside the line that says so; it's a secondary
          pill, so the room's one primary stays Draft (§9C: one accent, small). */}
      {dirty ? (
        <View style={styles.save}>
          <Button label="Save queue" variant="secondary" onPress={() => void save()} disabled={saving} status={saving ? 'loading' : 'idle'} fullWidth />
          <Text variant="caption" tone="secondary" style={styles.center}>Not saved yet.</Text>
        </View>
      ) : null}
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
  pos: { minWidth: 20, fontVariant: ['tabular-nums'] },
  sym: { flex: 1 },
  // Each icon button reaches 44 pt (the craft floor).
  hit: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  save: { marginTop: space[2], gap: space[2] },
  center: { textAlign: 'center' },
});
