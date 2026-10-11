/**
 * The pre-draft Members row (UX final sweep S-3). The list comes in the server's
 * order, so "you" is never assumed to be the first member: you are found by your
 * own user id, marked, and placed first; everyone else keeps the server's order.
 * Pure, so Deno tests it.
 */
export interface MemberRow<M> {
  member: M;
  isYou: boolean;
}

export function membersYouFirst<M extends { userId: string }>(members: readonly M[], myUserId: string | null | undefined): MemberRow<M>[] {
  const mine = myUserId ? members.filter((m) => m.userId === myUserId) : [];
  const rest = myUserId ? members.filter((m) => m.userId !== myUserId) : [...members];
  return [...mine.map((member) => ({ member, isYou: true })), ...rest.map((member) => ({ member, isYou: false }))];
}
