/**
 * schedule (3c, League › Schedule). Built from the caller's own matchups for
 * every week (get_home_league returns them, so no request). Each regular-season
 * week is one row: past (result and your score), live (this week, not yet
 * posted), next (the week after), or future. A bye has no result and is never
 * a W or L. Playoff rows are not in this list; they are shown as a line.
 */

/** The rows get_home_league returns for the caller: gains, not the winner. The
 * winner is decided by dollars (the ruling), so W or L follows from the gains. */
export interface ScheduleMatchup {
  week_number: number;
  team1_user_id: string | null;
  team2_user_id: string | null;
  team1_gain: number | null;
  team2_gain: number | null;
  is_playoff: boolean;
}

export interface ScheduleRow {
  week: number;
  /** The opponent's display name, or '' when unknown (never invented), or null when there is no matchup. */
  opponent: string | null;
  bye: boolean;
  state: 'past' | 'live' | 'next' | 'future';
  won: boolean;
  tie: boolean;
  /** Your dollar gain for the week, or null when not yet posted. */
  gain: number | null;
  /** The opponent's gain (null for a bye or before posting), for the W/L decision. */
  oppGain: number | null;
}

export function buildSchedule(input: {
  myUserId: string;
  currentWeek: number;
  numWeeks: number;
  names: { user_id: string; display_name: string }[];
  matchups: ScheduleMatchup[];
}): ScheduleRow[] {
  const nameOf = (id: string | null) => (id === null ? '' : input.names.find((n) => n.user_id === id)?.display_name ?? '');
  const rows: ScheduleRow[] = [];
  for (let week = 1; week <= input.numWeeks; week++) {
    const m = input.matchups.find((x) => x.week_number === week && !x.is_playoff) ?? null;
    const mine = m !== null && m.team1_user_id === input.myUserId;
    const theirs = m !== null && m.team2_user_id === input.myUserId;
    const isMine = mine || theirs;
    const myGain = !isMine || !m ? null : mine ? m.team1_gain : m.team2_gain;
    const posted = myGain !== null;
    const bye = isMine && m!.team2_user_id === null;
    const opponentId = !isMine || !m ? null : mine ? m.team2_user_id : m.team1_user_id;
    const oppGain = !isMine || !m || bye ? null : mine ? m.team2_gain : m.team1_gain;
    const state: ScheduleRow['state'] =
      week < input.currentWeek ? 'past'
      : week === input.currentWeek ? (posted ? 'past' : 'live')
      : week === input.currentWeek + 1 ? 'next'
      : 'future';
    rows.push({
      week,
      opponent: !isMine ? null : bye ? null : nameOf(opponentId),
      bye,
      state,
      // Dollars decide: a W is a higher gain, an L a lower one. An exact tie in
      // dollars is decided by percent, which this read does not carry, so it
      // shows no W or L rather than a guess (`tie` stays false).
      won: posted && !bye && oppGain !== null && myGain! > oppGain,
      tie: false,
      gain: myGain,
      oppGain,
    });
  }
  return rows;
}
