import React, { useState, useEffect } from "react";
import "./layout.css";

const SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "META", "NVDA", "NFLX", "V",
  "JPM", "UNH", "HD", "MA", "DIS", "PFE", "T", "KO", "PEP", "INTC", "CRM", "BABA"
];

const Ticker = () => {
  const [stockData, setStockData] = useState([]);

  const fetchRandomQuotes = async () => {
    const randomSymbols = SYMBOLS.sort(() => 0.5 - Math.random()).slice(0, 10);
    const results = [];

    for (const symbol of randomSymbols) {
      try {
        const formattedSymbol = symbol;

        const res = await fetch(
          `https://data.alpaca.markets/v2/stocks/${formattedSymbol}/quotes/latest`,
          {
            headers: {
              "APCA-API-KEY-ID": import.meta.env.VITE_ALPACA_KEY,
              "APCA-API-SECRET-KEY": import.meta.env.VITE_ALPACA_SECRET,
            },
          }
        );
        const data = await res.json();
        const price = data?.quote?.ap || data?.quote?.bp || data?.quote?.p;

        if (price) {
          results.push({
            symbol,
            current: price,
            change: (Math.random() - 0.5) * 4, // Simulated change
          });
        }
      } catch (err) {
        console.error(`❌ Failed to fetch quote for ${symbol}`, err);
      }
    }

    setStockData(results);
  };

  useEffect(() => {
    fetchRandomQuotes();
    const interval = setInterval(fetchRandomQuotes, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="ticker-bar">
      <div className="ticker-scroll">
        {stockData.map((stock, index) => (
          <div
            key={index}
            className={`ticker-item ${stock.change >= 0 ? "ticker-up" : "ticker-down"
              }`}
          >
            {stock.symbol}: ${stock.current.toFixed(2)} ({stock.change >= 0 ? "+" : ""}
            {stock.change.toFixed(2)})
          </div>
        ))}
      </div>
    </div>
  );
};

export default Ticker;
