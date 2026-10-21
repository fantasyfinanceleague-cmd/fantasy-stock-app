import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';

import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { DeleteAccountView } from '@/components/shell/DeleteAccountView';
import { useSession } from '@/lib/SessionProvider';
import { deleteAccount } from '@/lib/account/accountApi';
import { ALERT_BODY, ALERT_DELETE, ALERT_KEEP, ALERT_TITLE } from '@/lib/account/deleteCopy';
import { fixtureKind, fixtureLeagues, fixtureState } from '@/lib/account/deleteCapture';
import { applyOutcome, askConfirm, confirmDelete, keepAccount, setProof, type DeleteState } from '@/lib/account/deleteFlow';
import { loadDeleteLeagues } from '@/lib/account/deleteLeaguesApi';
import { useDeletedManagerLabel } from '@/lib/account/deletedLabelStore';
import { setDeletedNotice } from '@/lib/account/deletedNotice';
import { endSessionAfterDeletion } from '@/lib/account/endSession';
import { leagueLine, type DeleteLeagueInput } from '@/lib/account/leagueLines';
import { proofKindFor } from '@/lib/account/proofKind';
import { proveWithApple, proveWithGoogle } from '@/lib/auth/socialSignIn';
import type { SocialProofResult } from '@/lib/auth/socialOutcome';
import { DELETE_FIXTURE } from '@/lib/shell/captureDev';
import { SHELL_FIXTURE } from '@/lib/shell/devFixture';

// Account deletion (W4) — the delete screen's container (plan 2026-10-21; board "Decided"). It owns the state machine
// (lib/account/deleteFlow.ts) and the calls; components/shell/DeleteAccountView.tsx only draws.
//
//   proof in hand -> "Delete my account" opens the alert -> "Delete" is the ONLY thing that sends.
// The alert opens from the state (phase 'confirming'), never from the tap itself, so the screen cannot show it
// without the state machine having agreed, and "Keep my account" / a dismissal return to editing and send nothing.
export default function DeleteAccountScreen() {
  const { user, signOut } = useSession();
  const label = useDeletedManagerLabel();
  const meId = user?.id ?? '';
  const realKind = proofKindFor(user?.identities);
  const [state, setState] = useState<DeleteState>(() => fixtureState(DELETE_FIXTURE, realKind));
  const stateRef = useRef(state);
  stateRef.current = state;
  const [password, setPassword] = useState(() => (fixtureKind(DELETE_FIXTURE, realKind) === 'password' && DELETE_FIXTURE && DELETE_FIXTURE !== 'password' ? 'fixture-password' : ''));
  const [inputs, setInputs] = useState<DeleteLeagueInput[] | null>(null);

  useEffect(() => {
    if (!meId) return;
    if (DELETE_FIXTURE) {
      setInputs(fixtureLeagues(meId));
      return;
    }
    let live = true;
    void loadDeleteLeagues(meId, label).then((r) => {
      if (live) setInputs(r);
    });
    return () => {
      live = false;
    };
  }, [meId, label]);
  const leagues = useMemo(() => (inputs ? inputs.map((l) => leagueLine(l, meId, label, Date.now())) : null), [inputs, meId, label]);

  const onPassword = useCallback((v: string) => {
    setPassword(v);
    setState((s) => setProof(s, v.length > 0 ? { kind: 'password', password: v } : null, Date.now()));
  }, []);

  const onProof = useCallback((r: SocialProofResult) => {
    if (r.kind === 'proof') setState((s) => setProof(s, r.proof, Date.now()));
    // cancelled / unavailable / error: say nothing and leave the button dimmed (the proof line is the reason)
  }, []);
  const onApple = useCallback(() => void proveWithApple().then(onProof), [onProof]);
  const onGoogle = useCallback(() => void proveWithGoogle().then(onProof), [onProof]);

  // The button only ASKS. The alert is the state's.
  const onAsk = useCallback(() => setState((s) => askConfirm(s)), []);

  const send = useCallback(async () => {
    const { state: next, body, proofAt } = confirmDelete(stateRef.current);
    if (!body) return;
    setState(next);
    const outcome = await deleteAccount(body, proofAt);
    setState((s) => applyOutcome(s, outcome));
    if (outcome.kind !== 'deleted') return;
    // The server deleted the auth user: every device is signed out. Raise the line BEFORE the local clear so Sign in
    // shows it from its first render; the auth guard then lands the signed-out stack (Sign in) by itself.
    setDeletedNotice(true);
    if (SHELL_FIXTURE) await signOut();
    else await endSessionAfterDeletion();
  }, [signOut]);

  // Open the native alert exactly when the state says so.
  const phase = state.phase;
  useEffect(() => {
    if (phase !== 'confirming') return;
    Alert.alert(
      ALERT_TITLE,
      ALERT_BODY,
      [
        { text: ALERT_KEEP, style: 'cancel', onPress: () => setState((s) => keepAccount(s)) },
        { text: ALERT_DELETE, style: 'destructive', onPress: () => void send() },
      ],
      { cancelable: true, onDismiss: () => setState((s) => keepAccount(s)) },
    );
  }, [phase, send]);

  // DEV capture only: 'alert' presses the real button once, so the native alert is the real one.
  useEffect(() => {
    if (DELETE_FIXTURE === 'alert') onAsk();
  }, [onAsk]);

  return (
    <AuthScaffold back={{ label: 'Profile', onPress: () => (router.canGoBack() ? router.back() : router.replace('/profile')) }}>
      <DeleteAccountView
        state={state}
        leagues={leagues}
        label={label}
        password={password}
        onPassword={onPassword}
        onApple={onApple}
        onGoogle={onGoogle}
        onDelete={onAsk}
      />
    </AuthScaffold>
  );
}
