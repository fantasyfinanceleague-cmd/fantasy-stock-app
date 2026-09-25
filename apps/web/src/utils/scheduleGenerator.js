// src/utils/scheduleGenerator.js
//
// Display helpers only. Season schedules, initial standings, league dates and
// playoff brackets are generated SERVER-SIDE:
//   - regular season: supabase/functions/_shared/schedule.ts, written at draft
//     completion by validate-and-record-pick via the finalize_league_draft RPC
//   - playoffs: process-week-results generatePlayoffs
// The client generators that used to live here (generateSchedule,
// generateInitialStandings, generatePlayoffBracket, ...) were removed so there
// is exactly one writer. Do not re-add client-side matchups/standings inserts.

/**
 * Get the round name for display purposes
 * @param {string} playoffRound - 'quarter', 'semi', or 'finals'
 * @returns {string} Display name
 */
export function getPlayoffRoundName(playoffRound) {
  switch (playoffRound) {
    case 'quarter':
      return 'Quarterfinals';
    case 'semi':
      return 'Semifinals';
    case 'finals':
      return 'Finals';
    default:
      return 'Playoff';
  }
}
