// src/utils/tiebreaker.js

/**
 * Playoff seeding tiebreaker logic
 *
 * Tiebreaker order:
 * 1. Head-to-head record between tied teams
 * 2. Total points for (higher is better)
 */

/**
 * Get head-to-head record between two users
 * @param {string} user1Id
 * @param {string} user2Id
 * @param {Array} matchups - All matchups for the league
 * @returns {{user1Wins: number, user2Wins: number, ties: number}}
 */
export function getHeadToHead(user1Id, user2Id, matchups) {
  let user1Wins = 0;
  let user2Wins = 0;
  let ties = 0;

  for (const m of matchups) {
    // Skip playoff matchups, only count regular season
    if (m.is_playoff) continue;

    // Skip if results not yet calculated
    if (m.team1_gain === null || m.team1_gain === undefined) continue;

    const isMatch = (
      (m.team1_user_id === user1Id && m.team2_user_id === user2Id) ||
      (m.team1_user_id === user2Id && m.team2_user_id === user1Id)
    );

    if (!isMatch) continue;

    if (m.winner_user_id === user1Id) {
      user1Wins++;
    } else if (m.winner_user_id === user2Id) {
      user2Wins++;
    } else {
      ties++;
    }
  }

  return { user1Wins, user2Wins, ties };
}

/**
 * Compare two users for seeding purposes
 * Returns negative if user1 should be seeded higher (better record)
 * Returns positive if user2 should be seeded higher
 * Returns 0 if still tied after all tiebreakers
 *
 * @param {Object} user1 - {user_id, wins, losses, ties, points_for, points_against}
 * @param {Object} user2 - {user_id, wins, losses, ties, points_for, points_against}
 * @param {Array} matchups - All matchups for head-to-head lookup
 * @returns {number}
 */
export function compareForSeeding(user1, user2, matchups) {
  // Primary: Compare wins
  if (user1.wins !== user2.wins) {
    return user2.wins - user1.wins; // Higher wins = better (lower index)
  }

  // Tiebreaker 1: Head-to-head record
  const h2h = getHeadToHead(user1.user_id, user2.user_id, matchups);
  if (h2h.user1Wins !== h2h.user2Wins) {
    return h2h.user2Wins - h2h.user1Wins; // More h2h wins = better
  }

  // Tiebreaker 2: Total points for (higher is better)
  const pf1 = Number(user1.points_for) || 0;
  const pf2 = Number(user2.points_for) || 0;
  if (pf1 !== pf2) {
    return pf2 - pf1; // Higher points = better
  }

  // Still tied - could add more tiebreakers here
  // For now, keep original order
  return 0;
}

/**
 * Sort standings array for playoff seeding
 * Applies all tiebreakers to produce final seeding order
 *
 * @param {Array} standings - Array of standing objects from league_standings
 * @param {Array} matchups - All matchups for the league
 * @returns {Array} Sorted standings with seed property added
 */
export function sortForPlayoffSeeding(standings, matchups) {
  // Create copy to avoid mutating original
  const sorted = [...standings];

  // Sort using comparison function
  sorted.sort((a, b) => compareForSeeding(a, b, matchups));

  // Add seed numbers
  return sorted.map((s, idx) => ({
    ...s,
    seed: idx + 1
  }));
}

/**
 * Get playoff-eligible teams based on standings and playoff_teams count
 *
 * @param {Array} standings - Standings from league_standings table
 * @param {Array} matchups - All matchups for tiebreaker calculation
 * @param {number} playoffTeams - Number of teams in playoffs (2, 4, or 8)
 * @returns {Array} Top N teams with seeds assigned
 */
export function getPlayoffTeams(standings, matchups, playoffTeams) {
  const seeded = sortForPlayoffSeeding(standings, matchups);
  return seeded.slice(0, playoffTeams);
}
