// Account deletion (W4) — after {ok:true}: the server has deleted the auth user, so this phone's session is dead.
// Clear it LOCALLY: supabase.auth.signOut({scope:'local'}) skips nothing that matters here (GoTrue answers 401/403/404
// to the logout of a user that no longer exists, and supabase-js treats those as signed-out and removes the stored
// session itself), and the next person on this phone picks their own Google account (signOutOfGoogle). Nothing here
// touches the push token: the server deleted those rows with the account. The one-time line is raised by the caller
// BEFORE this runs, so Sign in shows it from its first render.

import { supabase } from '../supabase';
import { signOutOfGoogle } from '../auth/socialSignIn';

export async function endSessionAfterDeletion(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The account is gone; a failed local clear leaves a session the first refresh rejects. Nothing to tell the person.
  }
  await signOutOfGoogle();
}
