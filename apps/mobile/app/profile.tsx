import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { HowItWorksSheet } from '@/components/shell/HowItWorksSheet';
import { ProfileView } from '@/components/shell/ProfileView';
import { useSession } from '@/lib/SessionProvider';
import { profileBackLabel } from '@/lib/shell/profileBack';

// Phase 3b-1 — Profile (spec row 11). Reached from the avatar on any tab; the back link names that tab (?from=, W8 F3).
export default function ProfileScreen() {
  const { user, username, signOut } = useSession();
  const [howItWorks, setHowItWorks] = useState(false);
  const { from } = useLocalSearchParams<{ from?: string | string[] }>();
  return (
    <AuthScaffold back={{ label: profileBackLabel(from), onPress: () => (router.canGoBack() ? router.back() : router.replace('/')) }}>
      <ProfileView
        username={username}
        email={user?.email ?? null}
        onUsername={() => router.push('/username')}
        onChangePassword={() => router.push('/change-password')}
        onAppearance={() => router.push('/appearance')}
        onHowItWorks={() => setHowItWorks(true)}
        onSignOut={signOut}
        onDeleteAccount={() => router.push('/delete-account')}
      />
      <HowItWorksSheet visible={howItWorks} onClose={() => setHowItWorks(false)} />
    </AuthScaffold>
  );
}
