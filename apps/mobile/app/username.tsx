import { router } from 'expo-router';

import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { UsernamePicker, UsernamePickerExit } from '@/components/shell/UsernamePicker';
import { useSession } from '@/lib/SessionProvider';

// Phase 3b-1 — Profile › Username (spec row 11): the same Pick-a-username
// validation, starting from the current name ("unchanged" until edited).
export default function EditUsernameScreen() {
  const { user, username, setUsernameLocal } = useSession();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <AuthScaffold back={{ label: 'Profile', onPress: back }}>
      <UsernamePicker
        current={username}
        email={user?.email ?? null}
        onSaved={(name) => {
          setUsernameLocal(name);
          back();
        }}
      />
      <UsernamePickerExit label="Cancel" onPress={back} />
    </AuthScaffold>
  );
}
