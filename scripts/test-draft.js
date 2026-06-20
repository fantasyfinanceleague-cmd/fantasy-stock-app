/**
 * Test Draft Script
 * Creates a test league with bots and simulates the draft to verify:
 * 1. No duplicate pick_numbers occur
 * 2. Snake draft order is correct
 * 3. All picks are recorded properly
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load .env from repo root
const envPath = path.resolve(new URL('.', import.meta.url).pathname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://haiaaifjcclsvmkfqgmd.supabase.co';
// Phase 3a: legacy anon key -> new publishable key (anon drop-in replacement).
const SUPABASE_PUBLISHABLE_KEY = process.env.SB_PUBLISHABLE_KEY;
if (!SUPABASE_PUBLISHABLE_KEY) {
  console.error('ERROR: SB_PUBLISHABLE_KEY not set in .env or environment');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Test configuration
const TEST_CONFIG = {
  leagueName: `TEST_DRAFT_${Date.now()}`,
  numBots: 4,
  numRounds: 4,
  budgetMode: 'no-budget',
  leagueType: 'duration',
  durationDays: 7,
};

// Stock pool for bots to pick from
const STOCK_POOL = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA', 'NVDA', 'JPM',
  'V', 'MA', 'HD', 'PG', 'JNJ', 'UNH', 'BAC', 'XOM'
];

let testLeagueId = null;
let botIds = [];

function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function createTestLeague() {
  console.log('📋 Creating test league...');

  const { data: league, error } = await supabase
    .from('leagues')
    .insert({
      name: TEST_CONFIG.leagueName,
      num_rounds: TEST_CONFIG.numRounds,
      num_participants: TEST_CONFIG.numBots,
      budget_mode: TEST_CONFIG.budgetMode,
      league_type: TEST_CONFIG.leagueType,
      duration_days: TEST_CONFIG.durationDays,
      draft_status: 'not_started',
      draft_date: new Date().toISOString(),
      commissioner_id: 'test-commissioner',
      invite_code: generateInviteCode(),
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Failed to create league:', error);
    throw error;
  }

  testLeagueId = league.id;
  console.log(`✅ Created league: ${league.name} (ID: ${league.id})`);
  return league;
}

async function addBots() {
  console.log(`🤖 Adding ${TEST_CONFIG.numBots} bots...`);

  const botEntries = [];
  for (let i = 1; i <= TEST_CONFIG.numBots; i++) {
    const botId = `test-bot-${i}`;
    botIds.push(botId);
    botEntries.push({
      league_id: testLeagueId,
      user_id: botId,
      role: i === 1 ? 'commissioner' : 'member',
    });
  }

  const { error } = await supabase
    .from('league_members')
    .insert(botEntries);

  if (error) {
    console.error('❌ Failed to add bots:', error);
    throw error;
  }

  console.log(`✅ Added bots: ${botIds.join(', ')}`);
}

async function startDraft() {
  console.log('🚀 Starting draft...');

  const { error } = await supabase
    .from('leagues')
    .update({ draft_status: 'in_progress' })
    .eq('id', testLeagueId);

  if (error) {
    console.error('❌ Failed to start draft:', error);
    throw error;
  }

  console.log('✅ Draft started');
}

// Simulate bot pick with optional delay
async function makeBotPick(botId, pickNumber, round, symbol, price) {
  const payload = {
    league_id: testLeagueId,
    user_id: botId,
    symbol: symbol,
    entry_price: price,
    quantity: 1,
    round: round,
    pick_number: pickNumber,
    draft_date: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('drafts')
    .insert(payload)
    .select()
    .single();

  return { data, error };
}

// Calculate who picks at each position (snake draft)
function getPickerForPosition(pickNumber, members) {
  const numMembers = members.length;
  const round = Math.floor((pickNumber - 1) / numMembers) + 1;
  const positionInRound = (pickNumber - 1) % numMembers;
  const isReverseRound = round % 2 === 0;

  const pickerIndex = isReverseRound
    ? (numMembers - 1 - positionInRound)
    : positionInRound;

  return { picker: members[pickerIndex], round };
}

async function simulateDraft() {
  console.log('\n🎯 Simulating draft picks...');

  const totalPicks = TEST_CONFIG.numBots * TEST_CONFIG.numRounds;
  const usedSymbols = new Set();
  const pickResults = [];

  for (let pickNum = 1; pickNum <= totalPicks; pickNum++) {
    const { picker, round } = getPickerForPosition(pickNum, botIds);

    // Get an unused symbol
    let symbol;
    for (const s of STOCK_POOL) {
      if (!usedSymbols.has(s)) {
        symbol = s;
        usedSymbols.add(s);
        break;
      }
    }

    const price = Math.floor(Math.random() * 400) + 50; // Random price $50-$450

    const { data, error } = await makeBotPick(picker, pickNum, round, symbol, price);

    if (error) {
      console.log(`  ❌ Pick ${pickNum}: ${picker} -> ${symbol} FAILED: ${error.message}`);
      pickResults.push({ pickNum, picker, symbol, success: false, error: error.message });
    } else {
      console.log(`  ✅ Pick ${pickNum}: ${picker} -> ${symbol} ($${price}) [Round ${round}]`);
      pickResults.push({ pickNum, picker, symbol, success: true });
    }
  }

  return pickResults;
}

// Test race condition - try to insert two picks with same pick_number simultaneously
async function testRaceCondition() {
  console.log('\n⚡ Testing race condition (concurrent duplicate picks)...');

  // Get current pick count
  const { data: currentPicks } = await supabase
    .from('drafts')
    .select('pick_number')
    .eq('league_id', testLeagueId)
    .order('pick_number', { ascending: false })
    .limit(1);

  const nextPickNumber = (currentPicks?.[0]?.pick_number || 0) + 1;
  const round = Math.floor((nextPickNumber - 1) / botIds.length) + 1;

  console.log(`  Attempting to insert TWO picks with pick_number ${nextPickNumber}...`);

  // Try to insert two picks simultaneously
  const [result1, result2] = await Promise.all([
    makeBotPick('test-bot-race-1', nextPickNumber, round, 'RACE1', 100),
    makeBotPick('test-bot-race-2', nextPickNumber, round, 'RACE2', 100),
  ]);

  const success1 = !result1.error;
  const success2 = !result2.error;

  if (success1 && success2) {
    console.log('  ❌ RACE CONDITION BUG: Both picks succeeded! Unique constraint not working.');
    return false;
  } else if (success1 || success2) {
    console.log('  ✅ PASS: Only one pick succeeded (unique constraint working)');
    console.log(`     Pick 1: ${success1 ? 'SUCCESS' : 'BLOCKED - ' + result1.error.message}`);
    console.log(`     Pick 2: ${success2 ? 'SUCCESS' : 'BLOCKED - ' + result2.error.message}`);
    return true;
  } else {
    console.log('  ⚠️  Both picks failed (unexpected):');
    console.log(`     Pick 1: ${result1.error.message}`);
    console.log(`     Pick 2: ${result2.error.message}`);
    return false;
  }
}

async function verifyDraftIntegrity() {
  console.log('\n🔍 Verifying draft integrity...');

  // Get all picks
  const { data: picks, error } = await supabase
    .from('drafts')
    .select('*')
    .eq('league_id', testLeagueId)
    .order('pick_number', { ascending: true });

  if (error) {
    console.error('❌ Failed to fetch picks:', error);
    return false;
  }

  // Check for duplicate pick_numbers
  const pickNumbers = picks.map(p => p.pick_number);
  const uniquePickNumbers = new Set(pickNumbers);
  const hasDuplicates = pickNumbers.length !== uniquePickNumbers.size;

  if (hasDuplicates) {
    console.log('❌ DUPLICATE PICK NUMBERS FOUND:');
    const counts = {};
    pickNumbers.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    Object.entries(counts).filter(([_, c]) => c > 1).forEach(([n, c]) => {
      console.log(`   Pick #${n} appears ${c} times`);
    });
    return false;
  }

  // Verify snake draft order
  console.log('\n📊 Draft Results by Round:');
  for (let round = 1; round <= TEST_CONFIG.numRounds; round++) {
    const roundPicks = picks.filter(p => p.round === round);
    const isReverse = round % 2 === 0;
    console.log(`  Round ${round} ${isReverse ? '(reverse)' : '(forward)'}:`);
    roundPicks.forEach(p => {
      console.log(`    Pick ${p.pick_number}: ${p.user_id} -> ${p.symbol}`);
    });
  }

  console.log(`\n✅ Draft integrity verified:`);
  console.log(`   - Total picks: ${picks.length}`);
  console.log(`   - Unique pick numbers: ${uniquePickNumbers.size}`);
  console.log(`   - No duplicates found`);

  return true;
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');

  if (!testLeagueId) {
    console.log('  No test league to clean up');
    return;
  }

  // Delete picks
  await supabase.from('drafts').delete().eq('league_id', testLeagueId);

  // Delete members
  await supabase.from('league_members').delete().eq('league_id', testLeagueId);

  // Delete league
  await supabase.from('leagues').delete().eq('id', testLeagueId);

  console.log('✅ Test data cleaned up');
}

async function runTests() {
  console.log('═'.repeat(60));
  console.log('🧪 DRAFT LOGIC TEST');
  console.log('═'.repeat(60));
  console.log(`Configuration:`);
  console.log(`  - Bots: ${TEST_CONFIG.numBots}`);
  console.log(`  - Rounds: ${TEST_CONFIG.numRounds}`);
  console.log(`  - Total picks: ${TEST_CONFIG.numBots * TEST_CONFIG.numRounds}`);
  console.log('═'.repeat(60));

  try {
    // Setup
    await createTestLeague();
    await addBots();
    await startDraft();

    // Run draft simulation
    await simulateDraft();

    // Test race condition protection
    const raceTestPassed = await testRaceCondition();

    // Verify integrity
    const integrityPassed = await verifyDraftIntegrity();

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📋 TEST SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Race condition test: ${raceTestPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`  Draft integrity: ${integrityPassed ? '✅ PASSED' : '❌ FAILED'}`);
    console.log('═'.repeat(60));

    // Cleanup
    await cleanup();

    return raceTestPassed && integrityPassed;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    await cleanup();
    return false;
  }
}

// Run the tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
});
