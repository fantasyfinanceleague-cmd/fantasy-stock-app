/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState, type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { useTheme } from '@/components/sp/ThemeProvider';
import { radius, space } from '@/constants/tokens';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import {
  ASK_CHANGE_NOTE, ASK_LINE, ASK_TAG, TRY_AGAIN, YOURE_OUT_CHIP, askQuestion, renewalAnswerOutcome, renewalAnswerRefusal,
} from '@/lib/game/renewal';

export type RenewalAnswer = 'in' | 'out';

export interface RenewalAskProps {
  leagueId: string;
  /** The commissioner's display name, for the question. */
  commissionerName: string;
  /** The answer so far: null (no reply yet) or 'out' (GS-14: "You're out", I'm out checked). */
  answered?: RenewalAnswer | null;
  /** A new answer was saved. */
  onAnswered: (response: RenewalAnswer) => void;
}

/** The ask (R3, the Season 1 player): "{name} is running it back. Are you in?"
 * [I'm out] [I'm in], with the note that the answer can change until the draft is set.
 * A player who said I'm out keeps it, answer marked (GS-14, board RibMemberPrompt 1b). */
export function RenewalAsk({ leagueId, commissionerName, answered = null, onAnswered }: RenewalAskProps) {
  return (
    <Card style={styles.card}>
      <RenewalAskBody leagueId={leagueId} commissionerName={commissionerName} answered={answered} onSaved={onAnswered} />
    </Card>
  );
}

export interface RenewalAskBodyProps {
  leagueId: string;
  commissionerName: string;
  answered: RenewalAnswer | null;
  onSaved: (response: RenewalAnswer) => void;
  /** The current answer tapped again: nothing to write (the Change sheet closes). */
  onSame?: () => void;
  /** Where the parts go. The default is one run (the card). The Change sheet passes its own, to scroll
   * the question and pin the choice, its refusal and the note under it (SheetBody). */
  layout?: (parts: { body: ReactNode; footer: ReactNode }) => ReactNode;
}

/** The ask's content, shared verbatim by the card (RenewalAsk) and the member list's
 * Change sheet (GS-10, RenewalChangeSheet): the board draws no separate sheet. */
export function RenewalAskBody({ leagueId, commissionerName, answered, onSaved, onSame, layout }: RenewalAskBodyProps) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={styles.header}>
        <Text variant="tag" tone="secondary">{ASK_TAG}</Text>
        {answered === 'out' ? (
          <View style={[styles.chip, { backgroundColor: colors.inset }]}>
            <Text variant="tag" tone="secondary">{YOURE_OUT_CHIP}</Text>
          </View>
        ) : null}
      </View>
      <Text variant="headline">{askQuestion(commissionerName)}</Text>
      <Text variant="callout" tone="secondary">{ASK_LINE}</Text>
    </>
  );
  // The action: the two answers, a refusal under them, and the note about changing the answer.
  const footer = (
    <>
      <RenewalChoice leagueId={leagueId} current={answered} onSaved={onSaved} onSame={onSame} />
      <Text variant="caption" tone="secondary">{ASK_CHANGE_NOTE}</Text>
    </>
  );
  return layout ? <>{layout({ body, footer })}</> : <>{body}{footer}</>;
}

/** I'm out / I'm in on respond_to_renewal, the current answer selected. A refusal shows in
 * place under the buttons, by reason (renewalAnswerRefusal); only the catch-all retries. */
function RenewalChoice({ leagueId, current, onSaved, onSame }: {
  leagueId: string;
  current: RenewalAnswer | null;
  onSaved: (response: RenewalAnswer) => void;
  onSame?: () => void;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<RenewalAnswer | null>(null);
  const [refusal, setRefusal] = useState<{ line: string; retry: boolean; response: RenewalAnswer } | null>(null);
  const answer = async (response: RenewalAnswer) => {
    if (busy) return;
    if (response === current) {
      onSame?.();
      return;
    }
    setBusy(response);
    setRefusal(null);
    const { data, error } = await seamRpc('respond_to_renewal', { p_league_id: leagueId, p_response: response });
    setBusy(null);
    const outcome = renewalAnswerOutcome(data, error);
    if (outcome.kind === 'refused') {
      setRefusal({ ...renewalAnswerRefusal(outcome.reason), response });
      return;
    }
    onSaved(response);
  };
  // The board draws two equal-width buttons (RibMemberPrompt; the P3 "compact pills" fix, W4).
  const choice = (response: RenewalAnswer, label: string, variant: 'primary' | 'secondary') => (
    <View style={styles.choice}>
      <Button
        label={label}
        variant={variant}
        fullWidth
        selected={response === current}
        status={busy === response ? 'loading' : 'idle'}
        disabled={busy !== null && busy !== response}
        onPress={() => void answer(response)}
      />
    </View>
  );
  return (
    <>
      <View style={styles.row}>
        {choice('out', "I'm out", 'secondary')}
        {choice('in', "I'm in", 'primary')}
      </View>
      {refusal ? (
        <View style={styles.refusal}>
          <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">{refusal.line}</Text>
          {refusal.retry ? (
            <View style={styles.retry}>
              <Button label={TRY_AGAIN} variant="secondary" size="sm" disabled={busy !== null} onPress={() => void answer(refusal.response)} />
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chip: { paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: 999 },
  row: { flexDirection: 'row', gap: space[3], marginVertical: space[2] },
  choice: { flex: 1 },
  refusal: { gap: space[2] },
  retry: { alignSelf: 'flex-start' },
});
