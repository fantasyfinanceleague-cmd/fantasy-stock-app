import { router } from 'expo-router';

import { brand } from '@/constants/brand';
import { PASSWORD_RULE_SENTENCE } from '@/constants/passwordRules';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { NewPasswordForm } from '@/components/shell/NewPasswordForm';
import { getAuthErrorMessage } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';

// Phase 3b-1 — Profile › Change password (spec row 13): its own screen, not
// the old always-open form. Same "Set a new password" form as the recovery
// link's Reset password.
export default function ChangePasswordScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  return (
    <AuthScaffold back={{ label: 'Profile', onPress: back }}>
      <NewPasswordForm
        submit={async (password) => {
          const { error } = await supabase.auth.updateUser({ password });
          return error ? getAuthErrorMessage(error, PASSWORD_RULE_SENTENCE, brand.name) : null;
        }}
        onDone={back}
        onCancel={back}
      />
    </AuthScaffold>
  );
}
