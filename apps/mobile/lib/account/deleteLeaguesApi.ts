// Account deletion (W4) — the facts behind the delete screen's one line per league: the person's own leagues,
// their commissioner/window facts, who else is in each (joined_at for the successor) and the seats' names. Reads
// only, through the same tables and RPC the leave flow reads (lib/game/useLeaveLeague.ts). A failed read yields
// null (the screen then shows no list rather than a guessed one).

import { supabase } from '../supabase';
import { isDeletedSeatName } from './deletedSeat';
import type { DeleteLeagueInput, LeagueMemberFact } from './leagueLines';

interface LeagueRow {
  id: string;
  name: string;
  commissioner_id: string | null;
  season_status: string | null;
  draft_status: string | null;
  draft_date: string | null;
  created_at: string | null;
}
interface MemberRow {
  league_id: string;
  user_id: string;
  joined_at: string | null;
  hidden_at: string | null;
}
interface NameRow {
  user_id: string;
  display_name: string | null;
  is_bot: boolean | null;
}

export async function loadDeleteLeagues(meId: string, label: string): Promise<DeleteLeagueInput[] | null> {
  try {
    const mine = await supabase.from('league_members').select('league_id').eq('user_id', meId).is('hidden_at', null);
    if (mine.error) return null;
    const ids = (mine.data ?? []).map((r) => String(r.league_id));
    if (ids.length === 0) return [];
    const [leagues, members] = await Promise.all([
      supabase.from('leagues').select('id, name, commissioner_id, season_status, draft_status, draft_date, created_at').in('id', ids),
      supabase.from('league_members').select('league_id, user_id, joined_at, hidden_at').in('league_id', ids),
    ]);
    if (leagues.error || members.error) return null;
    const names = await Promise.all(ids.map((id) => supabase.rpc('get_league_display_names', { p_league_id: id })));
    if (names.some((n) => n.error)) return null;
    const byLeague = new Map<string, MemberRow[]>();
    for (const m of (members.data ?? []) as MemberRow[]) byLeague.set(m.league_id, [...(byLeague.get(m.league_id) ?? []), m]);
    return ((leagues.data ?? []) as LeagueRow[])
      .slice()
      .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.name.localeCompare(b.name))
      .map((l) => {
        const nameRows = (names[ids.indexOf(l.id)].data ?? []) as NameRow[];
        const nameOf = new Map(nameRows.map((n) => [String(n.user_id), n] as const));
        const facts: LeagueMemberFact[] = (byLeague.get(l.id) ?? []).map((m) => {
          const n = nameOf.get(String(m.user_id));
          return {
            user_id: String(m.user_id),
            joined_at: m.joined_at,
            hidden: m.hidden_at !== null,
            displayName: n?.display_name ?? null,
            isBot: n?.is_bot === true,
            deleted: isDeletedSeatName(n?.display_name, label),
          };
        });
        return {
          id: l.id,
          name: l.name,
          commissionerId: l.commissioner_id,
          facts: { seasonStatus: l.season_status, draftStatus: l.draft_status, draftDate: l.draft_date },
          members: facts,
        };
      });
  } catch {
    return null;
  }
}
