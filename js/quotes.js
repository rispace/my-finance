// Live stock prices from Finnhub, fetched straight from the browser with the
// user's own free API key (Settings → Stock prices). Quotes are stored per
// symbol in the "quotes" collection, separate from holdings, so a price
// refresh on one device never overwrites a share-count edit on another.

import * as store from "./store.js";
import { quoteId, isStale, recentlyAttempted, FINNHUB_PREF_ID } from "./calc.js";

const TIMEOUT_MS = 8000;

export function apiKey() {
    return (store.get("prefs", FINNHUB_PREF_ID)?.key || "").trim();
}

async function fetchFinnhub(symbol, key) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
        response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`, { signal: controller.signal });
    } catch {
        throw new Error("Finnhub could not be reached. Try again later.");
    } finally {
        clearTimeout(timer);
    }
    if (response.status === 429) throw new Error("Finnhub is rate-limiting requests. Wait a minute and retry.");
    if (response.status === 401) throw new Error("Finnhub rejected the API key. Check it in Settings → Stock prices.");
    if (response.status === 403) throw new Error("Finnhub denied access to this ticker on the free plan.");
    if (!response.ok) throw new Error(`Finnhub returned HTTP ${response.status}.`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error("Finnhub returned an unreadable response."); }
    if (payload?.error) throw new Error(`Finnhub: ${String(payload.error).replace(key, "[redacted]").slice(0, 200)}`);
    const price = Number(payload?.c);
    // Finnhub answers unknown tickers with c=0, t=0 rather than an error.
    if (!Number.isFinite(price) || price <= 0 || price >= 1e10) {
        throw new Error("Finnhub returned no price for this ticker. Check the symbol (US-listed stocks and ETFs only).");
    }
    const t = Number(payload?.t);
    if (!Number.isFinite(t) || t <= 0) throw new Error("Finnhub returned no usable quote time for this ticker.");
    const quoted = new Date(t * 1000);
    if (quoted.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Finnhub returned a quote time in the future.");
    const date = quoted.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD in New York
    return { price, date, source: "Finnhub" };
}

/** Refresh one symbol. Returns { ok, message }. */
export async function refreshSymbol(symbol) {
    const key = apiKey();
    const now = Date.now();
    const old = store.get("quotes", quoteId(symbol));
    if (!key) {
        return { ok: false, message: "Live prices are off: add a free Finnhub key in Settings → Stock prices." };
    }
    try {
        const quote = await fetchFinnhub(symbol, key);
        // Never replace a newer saved quote with an older one.
        const keep = old && old.date && quote.date < old.date;
        await store.save("quotes", {
            ...(old || {}), id: quoteId(symbol), symbol,
            ...(keep ? {} : quote),
            checkedAt: now, attemptAt: now, failed: false, error: "",
        });
        return { ok: true, message: keep ? "kept newer saved quote" : "updated" };
    } catch (error) {
        const message = String(error.message || error).slice(0, 300);
        await store.save("quotes", { ...(old || { price: null, date: null, source: "" }), id: quoteId(symbol), symbol, failed: true, attemptAt: now, error: message });
        return { ok: false, message };
    }
}

/** Refresh every stale holding (or all with force). Returns { updated, failed, errors }. */
export async function refreshAll({ force = false } = {}) {
    const now = Date.now();
    const due = store.all("stocks").filter((s) => {
        const q = store.get("quotes", quoteId(s.symbol));
        return force || (isStale(q, now) && !recentlyAttempted(q, now));
    });
    const summary = { updated: 0, failed: 0, errors: [], notConfigured: !apiKey() };
    if (!due.length) return summary;
    if (summary.notConfigured) {
        summary.failed = due.length;
        summary.errors.push("Live prices are off: add a free Finnhub key in Settings → Stock prices.");
        return summary;
    }
    for (const stock of due.slice(0, 25)) { // Finnhub free plan: 60 calls/minute
        const { ok, message } = await refreshSymbol(stock.symbol);
        if (ok) summary.updated += 1;
        else { summary.failed += 1; summary.errors.push(`${stock.symbol}: ${message}`); }
    }
    return summary;
}

/** Save a price typed by hand (for funds Finnhub doesn't cover). */
export async function setManualPrice(symbol, price, todayDay) {
    const now = Date.now();
    await store.save("quotes", { id: quoteId(symbol), symbol, price, date: todayDay, source: "Manual", checkedAt: now, attemptAt: now, failed: false, error: "" });
}
