import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { UsernamePicker, UsernamePickerExit } from '@/components/shell/UsernamePicker';
import { useSession } from '@/lib/SessionProvider';

// Phase 3b-1 — the first-run username gate (spec row 8). Shown whenever the
// signed-in account's username IS NULL, BEFORE the tabs (app/_layout.tsx's
// nested Stack.Protected). It can't be skipped, but Sign out is always
// there. Saving updates the session, which lifts the gate — the navigator
// then opens the app (and any deep link waiting since sign-in).
export default function PickUsernameScreen() {
  const { user, setUsernameLocal, signOut } = useSession();
  return (
    <AuthScaffold>
      <UsernamePicker current={null} email={user?.email ?? null} onSaved={setUsernameLocal} />
      <UsernamePickerExit label="Sign out" onPress={signOut} />
    </AuthScaffold>
  );
}
