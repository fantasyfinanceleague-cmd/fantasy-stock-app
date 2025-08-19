import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase/supabaseClient';
import LeagueSetupWizard from './LeagueSetupWizard';
import '../layout.css'; // adjust if needed
//import Ticker from '../Ticker';
//import Header from '../Header';

const FINNHUB_API_KEY = 'REDACTED';
let suggestionAbortController = null;
let suggestionDebounceTimer = null;

function DraftPage() {
  const [currentPickNumber, setCurrentPickNumber] = useState(1);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentPicker, setCurrentPicker] = useState(null);

  const [symbol, setSymbol] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [quote, setQuote] = useState(null);
  const [portfolio, setPortfolio] = useState([]);
  const [error, setError] = useState(null);
  const [livePrices, setLivePrices] = useState({});
  const [symbolToName, setSymbolToName] = useState({});
  const recentPick = portfolio[0];
  const [selectedRound, setSelectedRound] = useState(1);

  const [budgetRemaining, setBudgetRemaining] = useState(null);
  const [hasDraftStarted, setHasDraftStarted] = useState(false);
  const [isDraftStarted, setIsDraftStarted] = useState(false);
  const [hasLeague, setHasLeague] = useState(false);
  const [creatingLeague, setCreatingLeague] = useState(false);

  const [setupComplete, setSetupComplete] = useState(false);
  const [leagueSettings, setLeagueSettings] = useState(null); // Store values from wizard

  const isBudgetMode = leagueSettings?.budgetMode === 'budget';
  const startingBudget = leagueSettings?.budgetAmount || 0;

  const userId = 'user-1'; // Replace with actual user ID from auth when ready
  const numTeams = leagueSettings?.numTeams ?? 8;      // was 3
  const totalRounds = leagueSettings?.numRounds ?? 8;  // new
  const userIds = Array.from({ length: numTeams }, (_, i) => `user-${i + 1}`);
  const activeLeagueId = typeof window !== 'undefined' ? localStorage.getItem('activeLeagueId') : null;

  if (!activeLeagueId) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#fff', marginTop: 0 }}>Choose a League</h3>
          <p className="muted">Go to the Leagues tab to create or join a league, then click “Draft”.</p>
          <a className="btn" href="/leagues">Open Leagues</a>
        </div>
      </div>
    );
  }
  const fetchBudgetFromSupabase = async () => {
    try {
      const { data, error } = await supabase
        .from('draft_settings')
        .select('mode, budget')
        .limit(1);

      if (error) {
        console.error('Error fetching draft settings:', error);
        return null;
      }
      return (data && data.length > 0) ? data[0] : null;
    } catch (err) {
      console.error('Unexpected error fetching draft settings:', err);
      return null;
    }
  };

  useEffect(() => {
    const initializeDraft = async () => {
      // 1. Check for a global budget
      const settings = await fetchBudgetFromSupabase();
      if (settings && settings.mode === 'budget' && settings.budget != null) {
        setBudgetRemaining(settings.budget);
        setIsDraftStarted(true);
      }

      // 2. Fetch all drafted picks
      const { data, error } = await supabase
        .from('drafts')
        .select('*')
        .order('draft_date', { ascending: false });

      if (error) {
        console.error('Error fetching picks:', error);
      } else {
        setPortfolio(data);
        fetchLivePrices(data);

        // 3. Snake draft logic + end check
        const totalPicks = data.length;
        const draftCap = numTeams * totalRounds; // << uses values from the wizard

        if (totalPicks >= draftCap) {
          // Draft is finished
          setCurrentPicker(null);
          setCurrentRound(Math.ceil(draftCap / numTeams));
          setCurrentPickNumber(draftCap);
          return; // stop here
        }

        const round = Math.floor(totalPicks / userIds.length) + 1;
        const pickIndex = totalPicks % userIds.length;
        const isEvenRound = round % 2 === 0;
        const pickerIndex = isEvenRound
          ? userIds.length - 1 - pickIndex
          : pickIndex;

        setCurrentRound(round);
        setCurrentPickNumber(totalPicks + 1);
        setCurrentPicker(userIds[pickerIndex]);

      }
    };

    initializeDraft();
  }, []);

  useEffect(() => {
    const updateDraftState = async () => {
      // 1) Read settings (mode + budget)
      const { data: settingsData, error: settingsError } = await supabase
        .from('draft_settings')
        .select('mode, budget')
        .limit(1)
        .maybeSingle();

      if (settingsError) {
        console.error('Error fetching draft settings:', settingsError);
        return;
      }

      // 2) Compute remaining if budget mode
      if (settingsData?.mode === 'budget' && settingsData?.budget != null) {
        const cap = Number(settingsData.budget) || 0;
        const userPicks = portfolio.filter(pick => pick.user_id === userId);
        const totalSpent = userPicks.reduce((sum, pick) => sum + Number(pick.entry_price || 0), 0);
        setBudgetRemaining(Math.max(cap - totalSpent, 0));
      } else {
        setBudgetRemaining(null);
      }

      // Update current pick, round, and picker for turn logic (+ end check)
      const totalPicks = portfolio.length;
      const draftCap = numTeams * totalRounds;

      if (totalPicks >= draftCap) {
        // Draft is finished
        setCurrentPicker(null);
        setCurrentRound(Math.ceil(draftCap / numTeams));
        setCurrentPickNumber(draftCap);
        return; // stop here
      }

      const round = Math.floor(totalPicks / userIds.length) + 1;
      const pickIndex = totalPicks % userIds.length;
      const isEvenRound = round % 2 === 0;
      const pickerIndex = isEvenRound
        ? userIds.length - 1 - pickIndex
        : pickIndex;

      setCurrentRound(round);
      setCurrentPickNumber(totalPicks + 1);
      setCurrentPicker(userIds[pickerIndex]);

    };

    if (portfolio.length >= 0) {
      updateDraftState();
    }
  }, [portfolio, userId, userIds]);

  useEffect(() => {
    async function fetchAlpacaAccount() {
      try {
        const response = await fetch('https://paper-api.alpaca.markets/v2/account', {
          headers: {
            'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
            'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
          },
        });
        const data = await response.json();
        console.log('✅ Alpaca account data:', data);
      } catch (error) {
        console.error('❌ Failed to fetch Alpaca account:', error);
      }
    }

    fetchAlpacaAccount();
  }, []);

  useEffect(() => {
    if (symbol.trim() === '') {
      setQuote(null);
      setError(null);
    }
  }, [symbol]);

  const fetchLivePrices = async (picks) => {
    const prices = {};

    for (const pick of picks) {
      try {
        const upperSymbol = pick.symbol.toUpperCase();

        const res = await fetch(`https://data.alpaca.markets/v2/stocks/${upperSymbol}/quotes/latest`, {
          headers: {
            'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
            'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
          },
        });

        const result = await res.json();

        if (result?.quote?.ap || result?.quote?.bp || result?.quote?.p) {
          const price = result.quote.ap || result.quote.bp || result.quote.p;
          prices[upperSymbol] = price;
        }
      } catch (err) {
        console.error(`Error fetching Alpaca price for ${pick.symbol}:`, err);
      }
    }

    setLivePrices(prices);
  };

  const fetchSuggestions = async (query) => {
    // basic guards
    if (!query || !query.trim()) {
      setSuggestions([]);
      return;
    }

    // debounce to avoid spamming the API while typing
    if (suggestionDebounceTimer) clearTimeout(suggestionDebounceTimer);
    suggestionDebounceTimer = setTimeout(async () => {
      try {
        // cancel previous request if still in flight
        if (suggestionAbortController) suggestionAbortController.abort();
        suggestionAbortController = new AbortController();

        const res = await fetch(
          `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`,
          { signal: suggestionAbortController.signal }
        );

        // non-200s happen (429, 401, etc.)
        if (!res.ok) {
          console.warn('Symbol search failed:', res.status, res.statusText);
          setSuggestions([]);
          return;
        }

        const data = await res.json();

        // SAFETY: make sure result is an array
        if (!data || !Array.isArray(data.result)) {
          setSuggestions([]);
          return;
        }

        const matches = data.result
          .filter((item) => item && item.symbol && item.description)
          .slice(0, 10);

        setSuggestions(matches);

        // keep symbol->name map fresh
        const nameMap = {};
        for (const item of matches) {
          nameMap[item.symbol.toUpperCase()] = item.description;
        }
        setSymbolToName((prev) => ({ ...prev, ...nameMap }));
      } catch (err) {
        if (err.name === 'AbortError') return; // expected when we cancel
        console.error('Symbol search error:', err);
        setSuggestions([]);
      }
    }, 250); // 250ms debounce
  };

  const fetchQuote = async () => {
    try {
      const upperSymbol = symbol.toUpperCase();
      const res = await fetch(`https://data.alpaca.markets/v2/stocks/${upperSymbol}/quotes/latest`, {
        headers: {
          'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
          'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
        },
      });

      const result = await res.json();
      console.log('📊 Alpaca quote result:', result);

      const price = result?.quote?.ap || result?.quote?.bp || result?.quote?.p;

      if (!price || isNaN(price)) {
        setError(`Alpaca has no recent data for "${upperSymbol}".`);
        setQuote(null);
        return;
      }

      setQuote({ c: price });
      setError(null);
      setSuggestions([]);
    } catch (err) {
      console.error('❌ Error fetching quote from Alpaca:', err);
      setError('Error fetching stock quote.');
      setQuote(null);
    }
  };

  const checkSymbolIsTradable = async (symbol) => {
    try {
      const res = await fetch(`https://paper-api.alpaca.markets/v2/assets/${symbol.toUpperCase()}`, {
        headers: {
          'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
          'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
        },
      });

      if (!res.ok) return false;

      const data = await res.json();
      return data.tradable === true;
    } catch (err) {
      console.error('❌ Error validating symbol with Alpaca:', err);
      return false;
    }
  };

  const placePaperOrder = async (symbol) => {
    try {
      const order = await fetch('https://paper-api.alpaca.markets/v2/orders', {
        method: 'POST',
        headers: {
          'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
          'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: symbol.toUpperCase(),
          qty: 1,
          side: 'buy',
          type: 'market',
          time_in_force: 'gtc',
        }),
      });

      const result = await order.json();
      console.log('✅ Paper trade placed:', result);

      if (order.status !== 200 && !result.id) {
        throw new Error(result.message || 'Failed to place order');
      }

      return result;
    } catch (error) {
      console.error('❌ Error placing paper order:', error);
      alert('Failed to place order with Alpaca.');
      return null;
    }
  };

  const draftStock = async () => {
    if (!quote || userId !== currentPicker) return;

    const price = quote.c;

    if (isBudgetMode && price > budgetRemaining) {
      alert("This stock is over your remaining budget.");
      return;
    }
    const alpacaOrder = await placePaperOrder(symbol);
    if (!alpacaOrder) return;

    const newPickNumber = portfolio.length + 1;

    const newPick = {
      symbol: symbol.toUpperCase(),
      entry_price: price,
      quantity: 1,
      draft_date: new Date().toLocaleString(),
      user_id: userId,
      round: currentRound,
      pick_number: newPickNumber,
    };

    const { data, error } = await supabase.from('drafts').insert([newPick]);

    if (error) {
      console.error('❌ Supabase insert error:', error.message);
      alert('Failed to draft stock. Check console for details.');
    } else {
      setPortfolio((prev) => [newPick, ...prev]);
      setQuote(null);
      setSymbol('');
      setCurrentPickNumber(newPickNumber + 1);
    }
  };

  const cancelAllAlpacaOrders = async () => {
    try {
      const res = await fetch('https://paper-api.alpaca.markets/v2/orders', {
        method: 'DELETE',
        headers: {
          'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
          'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
        },
      });

      const result = await res.json();

      if (res.ok) {
        console.log(`✅ Cancelled ${result.length} Alpaca order(s):`, result);
      } else {
        console.error('❌ Failed to cancel Alpaca orders:', result);
      }
    } catch (err) {
      console.error('❌ Error cancelling Alpaca orders:', err);
    }
  };

  const closeAllPositions = async () => {
    try {
      const res = await fetch('https://paper-api.alpaca.markets/v2/positions', {
        method: 'DELETE',
        headers: {
          'APCA-API-KEY-ID': import.meta.env.VITE_ALPACA_KEY,
          'APCA-API-SECRET-KEY': import.meta.env.VITE_ALPACA_SECRET,
        },
      });

      if (res.status === 204) {
        console.log('✅ All Alpaca positions liquidated (no content returned).');
      } else if (res.ok) {
        const data = await res.json();
        console.log(`✅ Closed ${data.length} position(s):`, data);
      } else {
        const errorData = await res.json();
        console.error('❌ Failed to liquidate Alpaca positions:', errorData);
      }
    } catch (err) {
      console.error('❌ Error closing Alpaca positions:', err);
    }
  };

  const handleResetDraft = async () => {
    // Cancel Alpaca orders & positions first
    await cancelAllAlpacaOrders();
    await closeAllPositions(); // Optional

    // Then delete from Supabase
    const { error: deleteDraftsError } = await supabase
      .from('drafts')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    const { error: deleteSettingsError } = await supabase
      .from('draft_settings')
      .delete()
      .gt('id', 0);

    if (deleteDraftsError || deleteSettingsError) {
      console.error('❌ Error clearing data:', deleteDraftsError || deleteSettingsError);
      return;
    }

    // Reset local state
    setPortfolio([]);
    setIsDraftStarted(false);
    setQuote(null);
    setSymbol('');
    setError(null);
    setLeagueSettings(null);
    setSetupComplete(false);
    setCreatingLeague(false); // ✅ This sends you back to the Welcome screen

    await fetchBudgetFromSupabase();
  };

  const handleSetBudget = async () => {
    if (inputMode === 'budget') {
      const parsed = parseFloat(inputBudget);
      if (isNaN(parsed) || parsed <= 0) {
        alert("Please enter a valid budget amount.");
        return;
      }

      const { data, error } = await supabase.from('draft_settings').select('*');
      if (error) {
        console.error('Error checking settings:', error);
        return;
      }

      if (data.length > 0) {
        alert('Draft settings already exist and cannot be changed.');
        return;
      }

      const { error: insertError } = await supabase
        .from('draft_settings')
        .insert([{ budget: parsed, mode: 'budget' }]);

      if (insertError) {
        console.error('Error setting budget:', insertError);
        alert('Failed to set budget.');
      } else {
        setBudget(parsed);
        setBudgetRemaining(parsed);
        setHasDraftStarted(true);
        setIsDraftStarted(true);
      }

    } else if (inputMode === 'no-budget') {
      const { data, error } = await supabase.from('draft_settings').select('*');
      if (error) {
        console.error('Error checking settings:', error);
        return;
      }

      if (data.length > 0) {
        alert('Draft settings already exist and cannot be changed.');
        return;
      }

      const { error: insertError } = await supabase
        .from('draft_settings')
        .insert([{ mode: 'no-budget' }]);

      if (insertError) {
        console.error('Error setting no-budget mode:', insertError);
        alert('Failed to start draft.');
      } else {
        setBudget(null);
        setBudgetRemaining(null);
        setHasDraftStarted(true);
        setIsDraftStarted(true);
      }
    }
  };

  function picksUntilYourTurn(totalPicks, usersInOrder, userIds, userId) {
    for (let k = 0; k <= usersInOrder * 2; k++) {
      const n = totalPicks + k;
      const round = Math.floor(n / usersInOrder) + 1;
      const pos = n % usersInOrder;
      const isEvenRound = round % 2 === 0;
      const pickerIndex = isEvenRound ? (usersInOrder - 1 - pos) : pos;
      if (userIds[pickerIndex] === userId) return k;
    }
    return "?";
  }

  return (
    <>
      {!hasLeague && !creatingLeague && (
        <div className="page-container">
          <div className="setup-card">

            {/* Step Label */}
            <h2 className="setup-title">Choose your option</h2>
            <div className="setup-buttons">
              <button onClick={() => setCreatingLeague(true)} className="btn-create">➕ Create League</button>
              <button disabled className="btn-join">🔗 Join League (Coming Soon)</button>
            </div>

          </div>
        </div>
      )}

      {!hasLeague && creatingLeague && !setupComplete && (
        <LeagueSetupWizard
          onComplete={async (settings) => {
            setLeagueSettings(settings);
            setSetupComplete(true);

            // persist the settings so "Budget Remaining" can compute
            try {
              // Clear any previous settings (optional)
              await supabase.from('draft_settings').delete().gt('id', 0);

              // Insert new settings
              await supabase.from('draft_settings').insert([{
                mode: settings.budgetMode,
                budget: settings.budgetMode === 'budget' ? settings.budgetAmount : null,
                num_teams: settings.numTeams,
                num_rounds: settings.numRounds,
              }]);

              // initialize local remaining immediately so UI updates right away
              if (settings.budgetMode === 'budget') {
                setBudgetRemaining(settings.budgetAmount);
              } else {
                setBudgetRemaining(null);
              }
            } catch (e) {
              console.error('❌ Failed to persist draft settings:', e);
            }
          }}
        />

      )}

      {(hasLeague || (creatingLeague && setupComplete)) && (
        <div className="grid-container px-8 py-6">
          {/* LEFT: Stock Draft */}
          <div className="p-4 bg-[#1c1c1c] rounded-xl text-white">
            <h1 className="draft-left">Stock Draft</h1>
            <p className="text-gray-400 mb-6">
              Select stocks for your fantasy portfolio during the draft.
            </p>

            <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
              <input
                type="text"
                value={symbol}
                onChange={(e) => {
                  const value = e.target.value;
                  setSymbol(value);
                  fetchSuggestions(value);
                }}
                placeholder="Enter stock symbol (e.g. AAPL)"
                className="modal-input"
              />
              {Array.isArray(suggestions) && suggestions.length > 0 && (
                <ul className="dropdown-list">
                  {suggestions.map((item) => (
                    <li
                      key={item.symbol}
                      className="dropdown-item"
                      onClick={async () => {
                        const isValid = await checkSymbolIsTradable(item.symbol);
                        if (!isValid) {
                          alert(`${item.symbol} is not tradable with Alpaca. Please choose another.`);
                          return;
                        }

                        setSymbol(item.symbol);
                        setSuggestions([]);
                        setQuote(null);
                      }}
                    >
                      <strong>{item.symbol}</strong> — {item.description}
                    </li>
                  ))}
                </ul>
              )}

            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '12px', marginBottom: '8px' }}>
              <button
                onClick={fetchQuote}
                className="modal-button btn-confirm"
                style={{ width: 'auto', padding: '10px 16px' }}
              >
                Get Quote
              </button>

              <button
                onClick={handleResetDraft}
                className="modal-button btn-danger"
                style={{ width: 'auto', padding: '10px 16px' }}
              >
                Reset Draft
              </button>
            </div>

            {error && <p className="text-red-600">{error}</p>}
            {quote && (
              <div style={{ marginTop: '24px' }}>
                <div className="draft-box">
                  {/* Symbol — Company Name */}
                  <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '6px' }}>
                    {symbol.toUpperCase()} — {symbolToName[symbol.toUpperCase()] || 'Company Name'}
                  </div>

                  {/* Current Price */}
                  <div style={{ fontSize: '1rem', marginBottom: '14px' }}>
                    Current Price: ${Number(quote.c).toFixed(2)}
                  </div>

                  {/* Draft button w/ existing guard logic */}
                  {(() => {
                    const upper = symbol.toUpperCase();
                    const alreadyDrafted = portfolio.some(p => p.symbol === upper);
                    const draftedByMe = portfolio.some(p => p.symbol === upper && p.user_id === userId);
                    const draftedByOther = alreadyDrafted && !draftedByMe;

                    let tooltipMessage = '';
                    let disabled = false;

                    if (draftedByMe) {
                      tooltipMessage = '✅ You already drafted this stock.';
                      disabled = true;
                    } else if (draftedByOther) {
                      tooltipMessage = '❌ This stock has already been drafted by another user.';
                      disabled = true;
                    } else if (userId !== currentPicker) {
                      tooltipMessage = '⏳ Not your turn to draft.';
                      disabled = true;
                    }

                    return (
                      <div>
                        <button
                          onClick={draftStock}
                          disabled={disabled}
                          className={`modal-button ${disabled ? 'btn-disabled' : 'btn-confirm'}`}
                          style={{ width: 'auto', padding: '10px 16px' }}
                          title={tooltipMessage}
                        >
                          Draft to My Team
                        </button>

                        {tooltipMessage && (
                          <div style={{ marginTop: '8px', fontSize: '0.9rem', color: '#9ca3af' }}>
                            {tooltipMessage}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

          </div>

          {/* MIDDLE: Status, Draft Progress, Recent Pick, Draft History */}
          <div className="draft-center">

            {/* Status */}
            <div className="draft-box">
              <h3 style={{ margin: 0 }}>
                {userId === currentPicker ? '✅ Your Turn' : '⏳ Not your turn'}
              </h3>

              {userId !== currentPicker && (
                <p style={{ marginTop: 8 }}>
                  Next turn in {
                    (() => {
                      const totalPicks = portfolio.length;
                      const usersInOrder = userIds.length;

                      // Find how many picks until it's this user's turn again
                      for (let i = 1; i <= usersInOrder * 2; i++) {
                        const nextPickNumber = totalPicks + i;
                        const nextRound = Math.floor(nextPickNumber / usersInOrder) + 1;
                        const pickIndex = nextPickNumber % usersInOrder;
                        const isEvenRound = nextRound % 2 === 0;
                        const pickerIndex = isEvenRound
                          ? usersInOrder - 1 - pickIndex
                          : pickIndex;

                        if (userIds[pickerIndex] === userId) {
                          return `${i} pick${i === 1 ? '' : 's'}`;
                        }
                      }
                      return '? picks';
                    })()
                  }
                </p>
              )}
            </div>

            {/* Draft Progress */}
            <div className="draft-box">
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Draft Progress</h3>
              <p style={{ margin: 0 }}>Current Pick: {currentRound}.{(currentPickNumber % userIds.length) || userIds.length}</p>
              <p style={{ margin: 0 }}>Total Picks Made: {portfolio.filter(pick => pick.user_id === userId).length}</p>
              <p style={{ margin: 0 }}>Budget Remaining: {budgetRemaining == null ? '—' : `$${budgetRemaining.toFixed(2)}`}</p>
            </div>

            {/* Recent Pick */}
            <div className="draft-box">
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Recent Pick</h3>
              {recentPick ? (
                <div>
                  <strong>{recentPick.symbol}</strong>
                  {` — ${symbolToName[recentPick.symbol] || recentPick.company_name || ''}`}<br />
                  Price: ${Number(recentPick.entry_price).toFixed(2)}
                </div>
              ) : (
                <p style={{ margin: 0 }}>No picks yet</p>
              )}
            </div>

            {/* Draft History */}
            <div className="draft-box scroll-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>Draft History</h3>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label htmlFor="roundSelect">Round:</label>
                  <select
                    id="roundSelect"
                    value={selectedRound}
                    onChange={(e) => setSelectedRound(Number(e.target.value))}
                    className="round-select"
                  >
                    {Array.from({ length: totalRounds }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{i + 1}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                {portfolio.filter(p => p.round === selectedRound).length === 0 && (
                  <p style={{ color: '#9ca3af', margin: 0 }}>No picks yet in this round.</p>
                )}

                {portfolio
                  .filter(p => p.round === selectedRound)
                  .sort((a, b) => a.pick_number - b.pick_number)
                  .map((pick) => {
                    const company =
                      symbolToName[pick.symbol] ||
                      pick.company_name ||
                      ''; // fallback if we don’t have a name yet
                    const price = Number(pick.entry_price);

                    return (
                      <div
                        key={`${pick.round}-${pick.pick_number}-${pick.symbol}-${pick.user_id}`}
                        className="list-row"
                      >
                        <span>
                          <strong>{pick.pick_number}</strong> — {pick.symbol}
                          {company ? ` — ${company}` : ''}
                        </span>
                        <span>{isNaN(price) ? '—' : `$${price.toFixed(2)}`}</span>
                      </div>
                    );
                  })}
              </div>
            </div>

          </div>

          {/* RIGHT: Your Drafted Stocks */}
          <div className="draft-box" style={{ maxHeight: '200px', overflowY: 'auto' }}>
            <h3 className="text-lg font-semibold mb-2">Your Drafted Stocks</h3>
            {portfolio.filter(p => p.user_id === userId).length > 0 ? (
              <ul>
                {portfolio
                  .filter(p => p.user_id === userId)
                  .map((stock, idx) => (
                    <li key={idx} className="py-1 border-b border-gray-700">
                      <strong>{stock.symbol}</strong> — {stock.company_name || 'Company Name'}<br />
                      Value: ${Number(stock.price).toFixed(2)}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-gray-400 text-sm">No drafted stocks yet.</p>
            )}
          </div>
        </div >
      )
      }
    </>
  );
}
export default DraftPage;
