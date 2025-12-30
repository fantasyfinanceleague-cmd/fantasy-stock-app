// src/utils/scheduleGenerator.js

/**
 * Generates a round-robin schedule for matchup-based leagues.
 *
 * Week timing:
 * - Monday: Trade day (lineups can be changed)
 * - Tuesday-Friday: Matchup week (performance counted)
 *
 * @param {string[]} userIds - Array of user IDs in the league
 * @param {number} numWeeks - Number of weeks to schedule
 * @param {Date} startDate - Date when the league starts (after draft completes)
 * @returns {Array<{week: number, team1: string, team2: string, weekStart: Date, weekEnd: Date}>}
 */
export function generateSchedule(userIds, numWeeks, startDate) {
  const teams = [...userIds];
  const matchups = [];

  // If odd number of teams, add a "BYE" placeholder
  const hasBye = teams.length % 2 !== 0;
  if (hasBye) {
    teams.push('BYE');
  }

  const n = teams.length;
  const roundsNeeded = n - 1; // Full round-robin requires n-1 rounds

  // Generate round-robin matchups
  for (let week = 1; week <= numWeeks; week++) {
    // Which rotation are we on? (0-indexed within round-robin cycle)
    const rotation = (week - 1) % roundsNeeded;

    // Get the matchups for this rotation
    const weekMatchups = getRotationMatchups(teams, rotation);

    // Calculate week timing
    // Start date is typically when draft completes
    // Week 1 starts on the next Tuesday after startDate
    const weekStart = getNextTuesday(startDate, week);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 3); // Friday (3 days after Tuesday)
    weekEnd.setHours(23, 59, 59, 999);

    for (const [team1, team2] of weekMatchups) {
      // Skip BYE matchups
      if (team1 === 'BYE' || team2 === 'BYE') continue;

      matchups.push({
        week,
        team1,
        team2,
        weekStart,
        weekEnd,
      });
    }
  }

  return matchups;
}

/**
 * Gets matchups for a specific rotation in round-robin.
 * Uses the "circle method" where one team stays fixed and others rotate.
 *
 * @param {string[]} teams - Array of team IDs (even length)
 * @param {number} rotation - Rotation number (0 to teams.length - 2)
 * @returns {Array<[string, string]>} Array of [team1, team2] pairs
 */
function getRotationMatchups(teams, rotation) {
  const n = teams.length;
  const matchups = [];

  // Create a rotated version of teams (excluding first team which stays fixed)
  const rotated = [teams[0]];
  for (let i = 1; i < n; i++) {
    const newIndex = ((i - 1 + rotation) % (n - 1)) + 1;
    rotated.push(teams[newIndex]);
  }

  // Pair teams: first with last, second with second-to-last, etc.
  for (let i = 0; i < n / 2; i++) {
    matchups.push([rotated[i], rotated[n - 1 - i]]);
  }

  return matchups;
}

/**
 * Gets the next Tuesday at 00:00 UTC for a given week number.
 *
 * @param {Date} baseDate - The base date (draft completion date)
 * @param {number} weekNumber - Which week (1-indexed)
 * @returns {Date} The Tuesday of that week
 */
function getNextTuesday(baseDate, weekNumber) {
  const date = new Date(baseDate);

  // Find the next Tuesday from baseDate
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 2 = Tuesday
  let daysUntilTuesday = (2 - dayOfWeek + 7) % 7;
  if (daysUntilTuesday === 0) daysUntilTuesday = 7; // If today is Tuesday, start next Tuesday

  date.setUTCDate(date.getUTCDate() + daysUntilTuesday);

  // Add weeks for subsequent weeks
  date.setUTCDate(date.getUTCDate() + (weekNumber - 1) * 7);

  // Set to midnight UTC
  date.setUTCHours(0, 0, 0, 0);

  return date;
}

/**
 * Generates standings entries for all users in a matchup league.
 * Called when league is created to initialize standings.
 *
 * @param {string} leagueId - The league UUID
 * @param {string[]} userIds - Array of user IDs
 * @returns {Array<{league_id: string, user_id: string}>}
 */
export function generateInitialStandings(leagueId, userIds) {
  return userIds.map(userId => ({
    league_id: leagueId,
    user_id: userId,
    wins: 0,
    losses: 0,
    ties: 0,
    points_for: 0,
    points_against: 0,
  }));
}
