/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { useLeagueContext } from '@/lib/LeagueContext';

/** R1 (Home, season complete, the commissioner only): the "Run it back?" card under
 * the champion card. Members see the champion card without it. Runs renew_league and
 * moves to the new league's roster. */
export function RunItBackCard() {
  const { setActiveLeagueId, activeLeagueId, refresh } = useLeagueContext();
  const [busy, setBusy] = useState(false);
  const runItBack = async () => {
    if (!activeLeagueId || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('renew_league', { p_league_id: activeLeagueId });
    setBusy(false);
    const res = data as { status?: string; league_id?: string } | null;
    if (error || !res || (res.status !== 'renewed' && res.status !== 'already_renewed') || !res.league_id) {
      Alert.alert('Not started', 'The renewal did not start. Try again.');
      return;
    }
    setActiveLeagueId(res.league_id);
    await refresh();
    router.push('/(tabs)/league');
  };
  return (
    <Card>
      <Text variant="tag" tone="secondary">Season 2</Text>
      <Text variant="headline">Run it back?</Text>
      <Text variant="callout" tone="secondary">Everyone from Season 1 gets asked if they're in. Once you've heard from everyone, you set up the draft.</Text>
      <View style={styles.action}>
        <Button label="Run it back" onPress={() => void runItBack()} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: space[2] },
});
