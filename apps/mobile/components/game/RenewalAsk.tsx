/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';

export interface RenewalAskProps {
  leagueId: string;
  /** The commissioner's display name, for the question. */
  commissionerName: string;
  onAnswered: () => void;
}

/** The ask (R3, the Season 1 player): "{name} is running it back. Are you in?"
 * [I'm out] [I'm in], with the note that the answer can change until the draft is set. */
export function RenewalAsk({ leagueId, commissionerName, onAnswered }: RenewalAskProps) {
  const [busy, setBusy] = useState(false);
  const answer = async (response: 'in' | 'out') => {
    if (busy) return;
    setBusy(true);
    const { data, error } = await seamRpc('respond_to_renewal', { p_league_id: leagueId, p_response: response });
    setBusy(false);
    if (error || !data || (data as { status?: string }).status === 'refused') {
      Alert.alert('Not saved', 'Your answer did not go through. Try again.');
      return;
    }
    onAnswered();
  };
  return (
    <Card>
      <Text variant="tag" tone="secondary">Season 2</Text>
      <Text variant="headline">{`${commissionerName} is running it back. Are you in?`}</Text>
      <Text variant="callout" tone="secondary">Same league, new season. The draft is set once everyone has replied.</Text>
      <View style={styles.row}>
        <Button label="I'm out" variant="secondary" onPress={() => void answer('out')} disabled={busy} />
        <Button label="I'm in" onPress={() => void answer('in')} disabled={busy} />
      </View>
      <Text variant="caption" tone="secondary">You can change your answer until the draft is set.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2], marginVertical: space[2] },
});
