// src/utils/scheduleGenerator.js

/**
 * Generates a round-robin schedule for matchup-based leagues.
 *
 * Week timing (aligned with US stock market hours):
 * - Monday: Trade day (lineups can be changed)
 * - Tuesday 9:30 AM ET: Week officially starts (market open)
 * - Friday 4:00 PM ET: Week officially ends (market close)
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

    // Calculate week timing with market hours
    // Week starts Tuesday 9:30 AM ET (14:30 UTC)
    // Week ends Friday 4:00 PM ET (21:00 UTC)
    const weekStart = getWeekStartTuesday(startDate, week);
    const weekEnd = getWeekEndFriday(weekStart);

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
 * Gets the next Tuesday at market open (9:30 AM ET / 14:30 UTC) for a given week number.
 *
 * @param {Date} baseDate - The base date (draft completion date)
 * @param {number} weekNumber - Which week (1-indexed)
 * @returns {Date} Tuesday market open of that week
 */
function getWeekStartTuesday(baseDate, weekNumber) {
  const date = new Date(baseDate);

  // Find the next Tuesday from baseDate
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 2 = Tuesday
  let daysUntilTuesday = (2 - dayOfWeek + 7) % 7;
  if (daysUntilTuesday === 0) daysUntilTuesday = 7; // If today is Tuesday, start next Tuesday

  date.setUTCDate(date.getUTCDate() + daysUntilTuesday);

  // Add weeks for subsequent weeks
  date.setUTCDate(date.getUTCDate() + (weekNumber - 1) * 7);

  // Set to market open: 9:30 AM ET = 14:30 UTC (during EST)
  // Note: This uses 14:30 UTC which is correct for EST. During EDT it would be 13:30 UTC.
  // For simplicity, we use 14:30 UTC year-round.
  date.setUTCHours(14, 30, 0, 0);

  return date;
}

/**
 * Gets Friday market close (4:00 PM ET / 21:00 UTC) for the week starting on the given Tuesday.
 *
 * @param {Date} tuesdayStart - The Tuesday start date of the week
 * @returns {Date} Friday market close of that week
 */
function getWeekEndFriday(tuesdayStart) {
  const date = new Date(tuesdayStart);

  // Friday is 3 days after Tuesday
  date.setUTCDate(date.getUTCDate() + 3);

  // Set to market close: 4:00 PM ET = 21:00 UTC (during EST)
  // Note: This uses 21:00 UTC which is correct for EST. During EDT it would be 20:00 UTC.
  // For simplicity, we use 21:00 UTC year-round.
  date.setUTCHours(21, 0, 0, 0);

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

/**
 * Gets the next market open time (9:30 AM ET / 14:30 UTC) after the given date.
 * For duration leagues, this is the next day's market open after draft completion.
 *
 * @param {Date} draftCompleteDate - When the draft finished
 * @returns {Date} Next day's market open
 */
export function getNextDayMarketOpen(draftCompleteDate) {
  const date = new Date(draftCompleteDate);

  // Move to next day
  date.setUTCDate(date.getUTCDate() + 1);

  // Set to market open: 9:30 AM ET = 14:30 UTC
  date.setUTCHours(14, 30, 0, 0);

  return date;
}

/**
 * Gets the market close time (4:00 PM ET / 21:00 UTC) for a given end date.
 *
 * @param {Date} endDate - The date to set market close on
 * @returns {Date} Market close time on that date
 */
export function getMarketClose(endDate) {
  const date = new Date(endDate);

  // Set to market close: 4:00 PM ET = 21:00 UTC
  date.setUTCHours(21, 0, 0, 0);

  return date;
}
