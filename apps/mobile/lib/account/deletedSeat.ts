// Account deletion (W4) — what a deleted manager's seat is called, and how the app knows a name is that seat.
//
// The server owns the word: deleted_manager_label() is the one SQL constant, and league_participant_display_name
// already returns it for a deleted seat, so every mobile name that arrives from the server arrives as the label.
// The app therefore needs the label for exactly two things: (1) to recognise a seat, so its avatar is the default
// person glyph and never initials of the label (Giorgio's board pick), and (2) to fill the delete screen's lines
// and the takeover question. FORMER_MANAGER_FALLBACK is the ONE client literal: it stands in until the server's
// answer has been read once, and is never used when the server's is known.
//
// RECOGNISING A SEAT BY ITS NAME is safe only because the label is a reserved sentinel: it contains a space and
// usernames are ^[A-Za-z0-9_]{3,20}$ (lib/shell/usernameRules.ts, the server's CHECK), so no person can be
// called it. tests-deno pins that. Not an overloaded NULL: an explicit value nobody else can hold. This is the
// ONE place the comparison lives (isDeletedSeatName), so an explicit server flag would swap one function.
//
// Pure (no React Native / supabase imports) so tests-deno exercises it hermetically; the fetch is
// lib/account/deletedLabelStore.ts.

export const FORMER_MANAGER_FALLBACK = 'Former manager';

type Listener = () => void;

let serverLabel: string | null = null;
const listeners = new Set<Listener>();

/** The label as the server says it; blank or non-string is ignored (the fallback stays). */
export function setDeletedManagerLabel(label: unknown): void {
  const next = typeof label === 'string' && label.trim().length > 0 && label.length <= 60 ? label.trim() : null;
  if (next === null || next === serverLabel) return;
  serverLabel = next;
  listeners.forEach((l) => l());
}

export function deletedManagerLabel(): string {
  return serverLabel ?? FORMER_MANAGER_FALLBACK;
}

export function subscribeDeletedLabel(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget what the server said. */
export function resetDeletedManagerLabel(): void {
  serverLabel = null;
  listeners.forEach((l) => l());
}

/** True when `name` is the deleted seat's placeholder (exact, trimmed; never a prefix or a case-fold). */
export function isDeletedSeatName(name: string | null | undefined, label: string = deletedManagerLabel()): boolean {
  return typeof name === 'string' && name.trim() === label;
}
