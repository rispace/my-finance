// Live stock prices from Finnhub, fetched straight from the browser with the
// user's own free API key (Settings → Stock prices). Quotes are stored per
// symbol in the "quotes" collection, separate from holdings, so a price
// refresh on one device never overwrites a share-count edit on another.

import * as store from "./store.js";
import { quoteId, quoteKey, cryptoQuoteId, isCrypto, isStale, recentlyAttempted, FINNHUB_PREF_ID } from "./calc.js";

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
        const q = store.get("quotes", quoteKey(s));
        return force || (isStale(q, now) && !recentlyAttempted(q, now));
    });
    const summary = { updated: 0, failed: 0, errors: [], notConfigured: !apiKey() };
    if (!due.length) return summary;
    const dueStocks = due.filter((s) => !isCrypto(s));
    const dueCrypto = due.filter(isCrypto);
    if (dueCrypto.length) {
        const r = await refreshCrypto(dueCrypto);
        summary.updated += r.updated;
        summary.failed += r.failed;
        summary.errors.push(...r.errors);
    }
    if (dueStocks.length && summary.notConfigured) {
        summary.failed += dueStocks.length;
        summary.errors.push("Stock prices are off: add a free Finnhub key in Settings → Stock prices.");
        return summary;
    }
    for (const stock of dueStocks.slice(0, 25)) { // Finnhub free plan: 60 calls/minute
        const { ok, message } = await refreshSymbol(stock.symbol);
        if (ok) summary.updated += 1;
        else { summary.failed += 1; summary.errors.push(`${stock.symbol}: ${message}`); }
    }
    return summary;
}

// ------------------------------------------------------------------ crypto
// CoinGecko's free keyless API: no account needed, about 5 calls a minute,
// so every coin is fetched in one call and only when its price is stale.

const COINGECKO = "https://api.coingecko.com/api/v3";

async function getJson(url, what) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
        response = await fetch(url, { signal: controller.signal });
    } catch {
        throw new Error(`${what} could not be reached. Try again later.`);
    } finally {
        clearTimeout(timer);
    }
    if (response.status === 429) throw new Error(`${what} is busy (too many requests). Wait a minute and retry.`);
    if (!response.ok) throw new Error(`${what} returned HTTP ${response.status}.`);
    try { return await response.json(); } catch { throw new Error(`${what} returned an unreadable response.`); }
}

/** Find coins by name or symbol: [{ id, symbol, name, rank, thumb }]. */
export async function searchCoins(query) {
    const q = String(query || "").trim();
    if (!q) return [];
    const payload = await getJson(`${COINGECKO}/search?query=${encodeURIComponent(q)}`, "CoinGecko");
    const coins = Array.isArray(payload?.coins) ? payload.coins : [];
    const upper = q.toUpperCase();
    return coins.slice(0, 25)
        .map((c) => ({ id: String(c.id || ""), symbol: String(c.symbol || "").toUpperCase(), name: String(c.name || ""), rank: Number(c.market_cap_rank) || null, thumb: String(c.thumb || "") }))
        .filter((c) => c.id && c.symbol)
        // Exact symbol matches first, then by market-cap rank.
        .sort((a, b) => (b.symbol === upper) - (a.symbol === upper) || (a.rank ?? 1e9) - (b.rank ?? 1e9))
        .slice(0, 8);
}

/** Refresh prices for these crypto holdings in one request. */
export async function refreshCrypto(holdings) {
    const now = Date.now();
    const ids = [...new Set(holdings.map((h) => h.coinId).filter(Boolean))];
    const summary = { updated: 0, failed: 0, errors: [] };
    if (!ids.length) return summary;
    let payload;
    try {
        payload = await getJson(`${COINGECKO}/simple/price?ids=${encodeURIComponent(ids.join(","))}&vs_currencies=usd&include_last_updated_at=true`, "CoinGecko");
    } catch (error) {
        const message = String(error.message || error).slice(0, 300);
        for (const id of ids) {
            const old = store.get("quotes", cryptoQuoteId(id));
            await store.save("quotes", { ...(old || { price: null, date: null, source: "" }), id: cryptoQuoteId(id), symbol: id, failed: true, attemptAt: now, error: message });
        }
        return { updated: 0, failed: ids.length, errors: [`Crypto: ${message}`] };
    }
    for (const id of ids) {
        const old = store.get("quotes", cryptoQuoteId(id));
        const price = Number(payload?.[id]?.usd);
        if (!Number.isFinite(price) || price <= 0) {
            await store.save("quotes", { ...(old || { price: null, date: null, source: "" }), id: cryptoQuoteId(id), symbol: id, failed: true, attemptAt: now, error: "CoinGecko returned no price for this coin." });
            summary.failed += 1;
            summary.errors.push(`${id}: no price from CoinGecko`);
            continue;
        }
        const t = Number(payload[id].last_updated_at);
        const date = new Date(Number.isFinite(t) && t > 0 ? t * 1000 : now).toLocaleDateString("en-CA");
        await store.save("quotes", { ...(old || {}), id: cryptoQuoteId(id), symbol: id, price, date, source: "CoinGecko", checkedAt: now, attemptAt: now, failed: false, error: "" });
        summary.updated += 1;
    }
    return summary;
}

/** Save a price typed by hand (for funds Finnhub doesn't cover). Pass a holding for crypto. */
export async function setManualPrice(symbolOrHolding, price, todayDay) {
    const now = Date.now();
    const holding = typeof symbolOrHolding === "object" ? symbolOrHolding : null;
    const id = holding ? quoteKey(holding) : quoteId(symbolOrHolding);
    const symbol = holding ? (isCrypto(holding) ? holding.coinId : holding.symbol) : symbolOrHolding;
    await store.save("quotes", { id, symbol, price, date: todayDay, source: "Manual", checkedAt: now, attemptAt: now, failed: false, error: "" });
}
