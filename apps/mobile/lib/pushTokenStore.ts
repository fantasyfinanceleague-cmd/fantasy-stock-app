/**
 * The push token's two database operations (F8, `20261017000000`): the token lives in the owner-scoped `push_tokens`
 * table and nowhere else; `user_profiles.expo_push_token` is DROPPED, so there is no second store to write or clear.
 *
 * supabase-js RESOLVES a failed write to `{ error }`; it does not throw. So both operations check the resolved error
 * (a `try/catch` alone read every failure as success), and log a constant line with the error CODE only: an error's
 * message or details can echo the row, and the token is a bearer for the device's pushes.
 *
 * Pure: the client is passed in, no RN or Expo import, so Deno tests it with a fake client.
 */
interface ErrorLike {
  code?: string | null;
}

export interface PushTokenClient {
  from(table: 'push_tokens'): {
    upsert(row: { user_id: string; token: string; updated_at: string }, options: { onConflict: string }): PromiseLike<{ error: ErrorLike | null }>;
    delete(): { eq(column: 'user_id', value: string): PromiseLike<{ error: ErrorLike | null }> };
  };
}

const codeOf = (e: ErrorLike | null | undefined): string => e?.code || 'unknown';

/** Upsert this user's token. False (after one constant log line) when the write failed or threw. */
export async function upsertPushToken(client: PushTokenClient, userId: string, token: string): Promise<boolean> {
  try {
    const { error } = await client.from('push_tokens').upsert({ user_id: userId, token, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      console.error('[push] saving the push token failed:', codeOf(error));
      return false;
    }
    return true;
  } catch {
    console.error('[push] saving the push token failed: threw');
    return false;
  }
}

/** Delete this user's token. Best-effort (sign-out proceeds either way) but no longer silent: false after one constant log line. */
export async function deletePushToken(client: PushTokenClient, userId: string): Promise<boolean> {
  try {
    const { error } = await client.from('push_tokens').delete().eq('user_id', userId);
    if (error) {
      console.warn('[push] removing the push token failed:', codeOf(error));
      return false;
    }
    return true;
  } catch {
    console.warn('[push] removing the push token failed: threw');
    return false;
  }
}
