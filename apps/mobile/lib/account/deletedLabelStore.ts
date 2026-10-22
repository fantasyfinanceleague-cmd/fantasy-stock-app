import { useSyncExternalStore } from 'react';

import { supabase } from '../supabase';
import { deletedManagerLabel, setDeletedManagerLabel, subscribeDeletedLabel } from './deletedSeat';

// Reads the server's deleted_manager_label() ONCE per launch (signed in) and caches it in lib/account/deletedSeat.ts.
// A failed read leaves the fallback; the next signed-in launch asks again. Nothing here blocks a screen.

let asked = false;

export async function loadDeletedManagerLabel(): Promise<void> {
  if (asked) return;
  asked = true;
  try {
    const { data, error } = await supabase.rpc('deleted_manager_label');
    if (error) {
      asked = false; // try again on the next call (e.g. the next sign-in), never in a loop
      return;
    }
    setDeletedManagerLabel(data);
  } catch {
    asked = false;
  }
}

/** The label, live (re-renders when the server's answer arrives). */
export function useDeletedManagerLabel(): string {
  return useSyncExternalStore(subscribeDeletedLabel, deletedManagerLabel);
}
