// src/Ticker.jsx
import React, { useEffect, useState, useMemo } from "react";
import "./layout.css";
import { supabase } from "./supabase/supabaseClient"; // adjust path if needed

const SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "NFLX", "V",
  "JPM", "UNH", "HD", "MA", "DIS", "PFE", "T", "KO", "PEP", "INTC", "CRM", "BABA"
];

// Optional: allow a mock mode for local/dev without hitting the function
const USE_MOCK =
  import.meta.env.VITE_USE_MOCK_QUOTES?.toString().toLowerCase() === "true";

export default function Ticker() {
  const [stockData, setStockData] = useState([]);

  // Pick a fixed set of symbols on mount (doesn't change on refresh)
  const selectedSymbols = useMemo(() => {
    return SYMBOLS.slice().sort(() => 0.5 - Math.random()).slice(0, 10);
  }, []);

  async function fetchQuoteViaFunction(symbol) {
    // normalize the symbol a bit
    const sym = String(symbol || "").trim().toUpperCase();

    // call your Edge Function
    const { data, error } = await supabase.functions.invoke("quote", {
      body: { symbol: sym }, // feed defaults to IEX in the function
    });

    // non-2xx from the function
    if (error) throw new Error("Edge Function returned a non-2xx status code");

    // the function may return an error payload (e.g., alpaca_error)
    if (data?.error) {
      const status =
        data?.status ??
        data?.quote?.status ??
        data?.trade?.status ??
        data?.bar?.status;
      throw new Error(`${data.error}${status ? ` (status: ${status})` : ""}`);
    }

    // normalize price from any of the possible shapes
    const priceRaw =
      data?.price ??
      data?.quote?.ap ??
      data?.quote?.bp ??
      data?.trade?.p ??
      data?.bar?.c ??
      null;

    const price = Number(priceRaw);
    if (!Number.isFinite(price)) {
      throw new Error("No price found in function response");
    }

    return {
      symbol: data?.symbol || sym,
      current: price,
    };
  }

  function fetchQuoteMock(symbol) {
    // Simple mock: jitter around pseudo price
    const base = 100 + Math.random() * 300;
    return Promise.resolve({ symbol, current: Number(base.toFixed(2)) });
  }

  const fetchQuotes = async () => {
    try {
      const results = await Promise.all(
        selectedSymbols.map(async (symbol) => {
          try {
            const { current } = USE_MOCK
              ? await fetchQuoteMock(symbol)
              : await fetchQuoteViaFunction(symbol);

            // Simulated change just for the visual effect
            const change = (Math.random() - 0.5) * 4;
            return { symbol, current, change };
          } catch (err) {
            console.error(`❌ Failed to fetch quote for ${symbol}`, err);
            return null; // skip this symbol on error
          }
        })
      );

      setStockData(results.filter(Boolean));
    } catch (err) {
      console.error("❌ Ticker batch failed", err);
      setStockData([]); // fail safe
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchQuotes();

    // Poll every 60 seconds
    const id = setInterval(fetchQuotes, 60000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbols]);

  // Duplicate the stock data for seamless loop
  const renderTickerItems = (keyPrefix = '') => {
    return stockData.map((s, i) => (
      <div
        key={`${keyPrefix}${s.symbol}-${i}`}
        className={`ticker-item ${s.change >= 0 ? "ticker-up" : "ticker-down"}`}
      >
        {s.symbol}: ${s.current.toFixed(2)} ({s.change >= 0 ? "+" : ""}
        {s.change.toFixed(2)})
      </div>
    ));
  };

  return (
    <div className="ticker-bar">
      <div className="ticker-scroll">
        {/* First set */}
        {renderTickerItems('set1-')}
        {/* Duplicate for seamless loop */}
        {renderTickerItems('set2-')}
      </div>
    </div>
  );
}
