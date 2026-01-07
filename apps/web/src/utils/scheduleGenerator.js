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
      // Include BYE matchups so players know they have a bye week
      // The player with the bye is always stored as team1, with team2 = null
      if (team1 === 'BYE') {
        matchups.push({
          week,
          team1: team2, // The real player
          team2: null,  // null indicates bye week
          weekStart,
          weekEnd,
        });
      } else if (team2 === 'BYE') {
        matchups.push({
          week,
          team1: team1, // The real player
          team2: null,  // null indicates bye week
          weekStart,
          weekEnd,
        });
      } else {
        matchups.push({
          week,
          team1,
          team2,
          weekStart,
          weekEnd,
        });
      }
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

/**
 * Generates playoff bracket matchups for single-elimination playoffs.
 *
 * Bracket seeding:
 * - 2 teams: #1 vs #2 (Finals only)
 * - 4 teams: #1 vs #4, #2 vs #3 (Semi) → Winners play Finals
 * - 8 teams: #1 vs #8, #4 vs #5, #2 vs #7, #3 vs #6 (Quarter) → Semi → Finals
 *
 * @param {Array} seededTeams - Array of {user_id, seed} sorted by seed
 * @param {Date} startDate - When playoffs start (after regular season)
 * @param {number} startWeek - Week number for first playoff round
 * @returns {Array} Playoff matchup objects
 */
export function generatePlayoffBracket(seededTeams, startDate, startWeek) {
  const numTeams = seededTeams.length;
  const matchups = [];

  if (numTeams === 2) {
    // Finals only
    const weekStart = getWeekStartTuesday(startDate, 1);
    const weekEnd = getWeekEndFriday(weekStart);

    matchups.push({
      week: startWeek,
      team1: seededTeams[0].user_id,
      team2: seededTeams[1].user_id,
      team1_seed: 1,
      team2_seed: 2,
      weekStart,
      weekEnd,
      is_playoff: true,
      playoff_round: 'finals',
    });
  } else if (numTeams === 4) {
    // Semi-finals (Week 1)
    const semiStart = getWeekStartTuesday(startDate, 1);
    const semiEnd = getWeekEndFriday(semiStart);

    // #1 vs #4
    matchups.push({
      week: startWeek,
      team1: seededTeams[0].user_id,
      team2: seededTeams[3].user_id,
      team1_seed: 1,
      team2_seed: 4,
      weekStart: semiStart,
      weekEnd: semiEnd,
      is_playoff: true,
      playoff_round: 'semi',
    });

    // #2 vs #3
    matchups.push({
      week: startWeek,
      team1: seededTeams[1].user_id,
      team2: seededTeams[2].user_id,
      team1_seed: 2,
      team2_seed: 3,
      weekStart: semiStart,
      weekEnd: semiEnd,
      is_playoff: true,
      playoff_round: 'semi',
    });

    // Finals placeholder (Week 2) - teams TBD
    const finalsStart = getWeekStartTuesday(startDate, 2);
    const finalsEnd = getWeekEndFriday(finalsStart);

    matchups.push({
      week: startWeek + 1,
      team1: null, // Winner of #1 vs #4
      team2: null, // Winner of #2 vs #3
      team1_seed: null,
      team2_seed: null,
      weekStart: finalsStart,
      weekEnd: finalsEnd,
      is_playoff: true,
      playoff_round: 'finals',
    });
  } else if (numTeams === 8) {
    // Quarter-finals (Week 1)
    const quarterStart = getWeekStartTuesday(startDate, 1);
    const quarterEnd = getWeekEndFriday(quarterStart);

    // Standard bracket: 1v8, 4v5, 2v7, 3v6
    const quarterMatchups = [
      [0, 7], // #1 vs #8
      [3, 4], // #4 vs #5
      [1, 6], // #2 vs #7
      [2, 5], // #3 vs #6
    ];

    for (const [idx1, idx2] of quarterMatchups) {
      matchups.push({
        week: startWeek,
        team1: seededTeams[idx1].user_id,
        team2: seededTeams[idx2].user_id,
        team1_seed: idx1 + 1,
        team2_seed: idx2 + 1,
        weekStart: quarterStart,
        weekEnd: quarterEnd,
        is_playoff: true,
        playoff_round: 'quarter',
      });
    }

    // Semi-finals placeholders (Week 2)
    const semiStart = getWeekStartTuesday(startDate, 2);
    const semiEnd = getWeekEndFriday(semiStart);

    // Semi 1: Winner of 1v8 vs Winner of 4v5
    matchups.push({
      week: startWeek + 1,
      team1: null,
      team2: null,
      team1_seed: null,
      team2_seed: null,
      weekStart: semiStart,
      weekEnd: semiEnd,
      is_playoff: true,
      playoff_round: 'semi',
    });

    // Semi 2: Winner of 2v7 vs Winner of 3v6
    matchups.push({
      week: startWeek + 1,
      team1: null,
      team2: null,
      team1_seed: null,
      team2_seed: null,
      weekStart: semiStart,
      weekEnd: semiEnd,
      is_playoff: true,
      playoff_round: 'semi',
    });

    // Finals placeholder (Week 3)
    const finalsStart = getWeekStartTuesday(startDate, 3);
    const finalsEnd = getWeekEndFriday(finalsStart);

    matchups.push({
      week: startWeek + 2,
      team1: null,
      team2: null,
      team1_seed: null,
      team2_seed: null,
      weekStart: finalsStart,
      weekEnd: finalsEnd,
      is_playoff: true,
      playoff_round: 'finals',
    });
  }

  return matchups;
}

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

/**
 * Calculate how many playoff weeks are needed
 * @param {number} playoffTeams - Number of teams in playoffs (2, 4, or 8)
 * @returns {number} Number of weeks needed
 */
export function getPlayoffWeeksNeeded(playoffTeams) {
  if (playoffTeams === 2) return 1; // Finals only
  if (playoffTeams === 4) return 2; // Semi + Finals
  if (playoffTeams === 8) return 3; // Quarter + Semi + Finals
  return 0;
}
