#!/bin/bash
# =============================================================================
# SEASON SIMULATION: Run process-week-results to simulate a full season
# =============================================================================
# Prerequisite: Run seed-test-league.sql first in Supabase SQL Editor
#
# Usage:
#   export SB_SECRET_KEY_CRON="..." SB_SECRET_KEY_LOCAL_SCRIPTS="..."
#   ./scripts/simulate-season.sh
# =============================================================================

set -e

SUPABASE_URL="https://haiaaifjcclsvmkfqgmd.supabase.co"
FUNCTION_URL="$SUPABASE_URL/functions/v1/process-week-results"
REST_URL="$SUPABASE_URL/rest/v1"
LEAGUE_ID="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

# Phase 3a: this script uses TWO NEW keys (no legacy keys remain).
#   - SB_SECRET_KEY_CRON           -> process-week-results function call (apikey header).
#       process-week-results validates `apikey` against SB_SECRET_KEY_CRON.
#   - SB_SECRET_KEY_LOCAL_SCRIPTS  -> /rest/v1 (PostgREST) data-plane reads below (apikey header).
#       Dedicated local-scripts secret key (blast-radius isolation).
# The /rest/v1 calls here are READ-ONLY (GET) verification queries.
if [ -z "$SB_SECRET_KEY_CRON" ]; then
  echo "ERROR: SB_SECRET_KEY_CRON not set (required for the process-week-results call)"
  echo "Usage: export SB_SECRET_KEY_CRON=\"...\" SB_SECRET_KEY_LOCAL_SCRIPTS=\"...\" && ./scripts/simulate-season.sh"
  exit 1
fi
if [ -z "$SB_SECRET_KEY_LOCAL_SCRIPTS" ]; then
  echo "ERROR: SB_SECRET_KEY_LOCAL_SCRIPTS not set (required for the /rest/v1 verification calls)"
  echo "Usage: export SB_SECRET_KEY_CRON=\"...\" SB_SECRET_KEY_LOCAL_SCRIPTS=\"...\" && ./scripts/simulate-season.sh"
  exit 1
fi

# Check for jq
if ! command -v jq &> /dev/null; then
  echo "WARNING: jq not installed, output won't be formatted"
  JQ="cat"
else
  JQ="jq ."
fi

echo "============================================"
echo "  SEASON SIMULATION"
echo "============================================"
echo ""

# Expected flow:
# Run 1: Process week 1 matchups -> advance current_week to 2
# Run 2: Process week 2 matchups -> advance current_week to 3
# Run 3: Process week 3 matchups -> transition to playoffs, generate bracket
# Run 4: Process semifinals -> advance winners to finals
# Run 5: Process finals -> complete season

LABELS=("Week 1 (Regular)" "Week 2 (Regular)" "Week 3 (Regular -> Playoffs)" "Semifinals" "Finals")

for i in {0..4}; do
  RUN=$((i + 1))
  echo "--- Run $RUN/5: ${LABELS[$i]} ---"

  RESPONSE=$(curl -s -X POST "$FUNCTION_URL" \
    -H "apikey: $SB_SECRET_KEY_CRON" \
    -H "Content-Type: application/json")

  echo "$RESPONSE" | $JQ

  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed // "error"' 2>/dev/null || echo "?")
  echo "Processed: $PROCESSED matchups"
  echo ""

  # Don't sleep after the last run
  if [ $RUN -lt 5 ]; then
    sleep 2
  fi
done

echo "============================================"
echo "  VERIFICATION"
echo "============================================"
echo ""

# Check league status
echo "--- League Status ---"
curl -s "$REST_URL/leagues?id=eq.$LEAGUE_ID&select=season_status,current_week" \
  -H "apikey: $SB_SECRET_KEY_LOCAL_SCRIPTS" | $JQ
echo ""

# Check season record
echo "--- Season Record ---"
curl -s "$REST_URL/league_seasons?league_id=eq.$LEAGUE_ID&select=champion_user_id,runner_up_user_id,completed_at" \
  -H "apikey: $SB_SECRET_KEY_LOCAL_SCRIPTS" | $JQ
echo ""

# Check standings
echo "--- Final Standings ---"
curl -s "$REST_URL/league_standings?league_id=eq.$LEAGUE_ID&select=user_id,wins,losses,ties,points_for&order=wins.desc,points_for.desc" \
  -H "apikey: $SB_SECRET_KEY_LOCAL_SCRIPTS" | $JQ
echo ""

# Check matchup results
echo "--- All Matchup Results ---"
curl -s "$REST_URL/matchups?league_id=eq.$LEAGUE_ID&select=week_number,is_playoff,playoff_round,team1_user_id,team2_user_id,team1_gain,team2_gain,winner_user_id&order=week_number" \
  -H "apikey: $SB_SECRET_KEY_LOCAL_SCRIPTS" | $JQ
echo ""

echo "============================================"
echo "  SIMULATION COMPLETE"
echo "============================================"
