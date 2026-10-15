import { supabase } from '@/lib/supabase';
import { SHELL_FIXTURE } from '@/lib/shell/devFixture';
import { interpretInvitePreview, type InvitePreview } from './invitePreview';

/**
 * The no-session invite preview (supabase/functions/invite-preview; verify_jwt=false, so the publishable key
 * is enough and a signed-out person can call it). Never throws: every failure, including the function not
 * being deployed, is 'unavailable', and the screens fall back to the generic "You're invited to a league".
 * The dev fixtures make no calls.
 */
export async function fetchInvitePreview(code: string): Promise<InvitePreview> {
  if (SHELL_FIXTURE) return { kind: 'unavailable' };
  try {
    const { data, error } = await supabase.functions.invoke('invite-preview', { body: { code } });
    return interpretInvitePreview(data, error);
  } catch {
    return { kind: 'unavailable' };
  }
}
