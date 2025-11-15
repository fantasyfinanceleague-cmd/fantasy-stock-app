// Utility functions for fetching stock data
import { supabase } from '../supabase/supabaseClient';
import { prettyName } from './formatting';

/**
 * Fetch a quote for a symbol via Edge Function
 * @param {string} symbol - The stock symbol
 * @returns {Promise<number|null>} - The price or null if unavailable
 */
export async function fetchQuote(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;

  const { data, error } = await supabase.functions.invoke('quote', { body: { symbol: sym } });
  if (error) return null;

  const price = Number(
    data?.price ??
    data?.quote?.ap ??
    data?.quote?.bp ??
    data?.trade?.p ??
    data?.bar?.c
  );

  return Number.isFinite(price) ? price : null;
}

/**
 * Fetch company name for a symbol via Edge Function
 * @param {string} symbol - The stock symbol
 * @returns {Promise<string>} - The company name (prettified) or empty string
 */
export async function fetchCompanyName(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return '';

  const { data, error } = await supabase.functions.invoke('symbol-name', { body: { symbol: sym } });
  if (error) return '';

  return data?.name ? prettyName(data.name) : '';
}

/**
 * Fetch multiple quotes with rate limiting
 * @param {string[]} symbols - Array of stock symbols
 * @param {number} maxConcurrent - Maximum concurrent requests
 * @param {number} delayMs - Delay between requests in ms
 * @returns {Promise<Object>} - Object with symbol -> price mapping
 */
export async function fetchQuotesInBatch(symbols, maxConcurrent = 3, delayMs = 60) {
  const results = {};
  let i = 0;

  async function runNext() {
    if (i >= symbols.length) return;
    const s = symbols[i++];
    const px = await fetchQuote(s).catch(() => null);
    if (px != null) results[s] = px;
    await new Promise(r => setTimeout(r, delayMs));
    return runNext();
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrent, symbols.length) }, () => runNext())
  );

  return results;
}
