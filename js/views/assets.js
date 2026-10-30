// Assets page (investments.html): owned assets (car, home, savings) with
// value history and equity, followed by investments (stocks/ETFs + cash).

import * as store from "../store.js";
import {
    assetRows, portfolio, ASSET_KINDS, ASSET_FIELDS_BY_KIND, LOAN_KINDS, label, currentValuation,
    quoteId, INVESTMENT_CASH_ID, combinePurchase,
} from "../calc.js";
import {
    esc, money, signedMoney, pct, signedPct, num, today, fmtDay, fmtDayNoYear, fmtMonthYear, timeAgo,
    centsToInput, toDecimal, byName, newId, plural,
} from "../util.js";
import { formPageHtml, fieldHtml, readForm, showErrors, parse, toast, confirmAction } from "../ui.js";
import { navigate, refreshQuotesIfStale } from "../app.js";
import * as quotes from "../quotes.js";

const notFound = (el, what) => {
    el.innerHTML = `<section class="card"><div class="empty"><strong>That ${what} no longer exists</strong><a href="#/assets">Back to assets</a></div></section>`;
};

export function assetsView({ el, rerender }) {
    const data = store.snapshot();
    const rows = assetRows(data);
    const folio = portfolio(data);
    const assetsValue = rows.reduce((s, r) => s + r.asset.valueCents, 0);
    const investmentsValue = folio.totalValue !== null ? folio.totalValue : folio.pricedValue + folio.cashBalance;
    const linked = new Set(rows.map((r) => r.asset.loanId).filter(Boolean));
    const suggestLoan = data.loans.filter((l) => l.kind === "auto" && !linked.has(l.id)).sort(byName)[0] || null;
    const hasKey = !!quotes.apiKey();
    const quoteStatus = (h) => (h.quote?.failed ? "Update failed"
        : h.quote?.date ? `${esc(h.quote.source || "Price")} · ${esc(fmtDayNoYear(h.quote.date))}` : "No price yet");
    const gainClass = (v) => (v === null ? "" : v >= 0 ? "good" : "bad");

    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Assets</h1>
            <p class="muted">What you own · ${money(assetsValue + investmentsValue)} total</p>
        </div>
        <div class="page-actions"><a class="btn" href="#/asset/new"><svg><use href="#i-plus"/></svg>Add asset</a></div>
    </div>

    <h2 class="section-title" style="margin-top:0">Property, vehicles &amp; savings</h2>
    ${rows.length ? `
    <div class="grid grid-2">
        ${rows.map((row) => {
            const a = row.asset;
            const id = encodeURIComponent(a.id);
            return `
        <section class="card asset-card">
            <div class="cc-top">
                <div>
                    <div class="cc-name">${esc(a.name)}</div>
                    <div class="muted small">${esc(label(ASSET_KINDS, a.kind))}${a.purchaseDate ? ` · owned since ${esc(fmtMonthYear(a.purchaseDate.slice(0, 7)))}` : ""}</div>
                </div>
                <a class="btn btn-ghost btn-small" href="#/asset/${id}/edit">Edit</a>
            </div>
            <div class="stat-value" style="margin-top:8px">${money(a.valueCents)}</div>
            <div class="muted small">${a.kind === "cash" ? "Balance" : "Estimated value"} as of ${esc(fmtDay(a.valueDate))}${row.change !== null
                ? ` · <span class="${row.change >= 0 ? "good" : "bad"}">${signedMoney(row.change)} (${signedPct(row.changePct)}) since purchase</span>` : ""}</div>
            ${row.loanBalance !== null ? `
            <div class="cc-figures" style="margin-top:14px">
                <div><span>Value</span><strong>${money(a.valueCents, 0)}</strong></div>
                <div><span>Loan owed</span><strong>${money(row.loanBalance, 0)}</strong></div>
                <div><span>Your equity</span><strong class="${row.equity >= 0 ? "good" : "bad"}">${signedMoney(row.equity)}</strong></div>
            </div>` : ""}
            ${a.notes ? `<p class="small" style="margin:12px 0 0;white-space:pre-line">${esc(a.notes)}</p>` : ""}
            ${row.history.length > 1 ? `
            <details style="margin-top:10px">
                <summary class="small">Value history</summary>
                <ul class="list">
                    ${row.history.map((v) => `<li class="row" style="padding:6px 0"><div class="row-main small">${esc(fmtDay(v.date))}${v.note ? ` · <span class="muted">${esc(v.note)}</span>` : ""}</div><div class="row-end small num">${money(v.valueCents)}</div></li>`).join("")}
                </ul>
            </details>` : ""}
            <div class="cc-actions" style="margin-top:12px">
                <a class="btn btn-small" href="#/asset/${id}/value">Update ${a.kind === "cash" ? "balance" : "value"}</a>
                ${a.loanId && row.loan ? `<a class="btn btn-secondary btn-small" href="#/loan/${encodeURIComponent(a.loanId)}">View loan</a>` : ""}
            </div>
        </section>`;
        }).join("")}
    </div>` : `
    <section class="card">
        <div class="empty">
            <strong>No assets yet</strong>
            Add your car, home or savings so your net worth reflects what you own, not just what you owe.
            <div class="form-actions" style="justify-content:center;margin-top:12px">
                ${suggestLoan ? `<a class="btn" href="#/asset/new?kind=vehicle&loan=${encodeURIComponent(suggestLoan.id)}&purchaseDate=${suggestLoan.openingDate}">Add the car for “${esc(suggestLoan.name)}”</a>` : ""}
                <a class="btn btn-secondary" href="#/asset/new">Add an asset</a>
            </div>
        </div>
    </section>`}
    ${rows.length && suggestLoan ? `<p class="muted small" style="margin-top:10px">Your loan “${esc(suggestLoan.name)}” isn’t linked to a vehicle yet. <a href="#/asset/new?kind=vehicle&loan=${encodeURIComponent(suggestLoan.id)}">Add it</a> or link it from an asset’s Edit page.</p>` : ""}

    <div class="page-head" style="margin:30px 0 14px">
        <div>
            <h2 class="section-title" style="margin:0">Investments</h2>
            <p class="muted small" style="margin-top:4px">${folio.lastChecked ? `Prices updated ${esc(timeAgo(folio.lastChecked))}${hasKey ? " · Finnhub" : ""}` : folio.holdings.length ? "Prices not loaded yet" : "Track stocks and ETFs at live prices"}</p>
        </div>
        <div class="page-actions">
            ${folio.holdings.length ? `<button type="button" class="btn-secondary btn-small" data-refresh><svg width="16" height="16"><use href="#i-refresh"/></svg>Refresh prices</button>` : ""}
            <a class="btn btn-small" href="#/stock/new"><svg width="16" height="16"><use href="#i-plus"/></svg>Add holding</a>
        </div>
    </div>

    ${hasKey ? "" : `
    <div class="notice">
        <strong>Live prices are turned off.</strong> The app needs a free price-data key to update your holdings.
        <ol style="margin:8px 0 0;padding-left:20px">
            <li>Create a free account at <a href="https://finnhub.io/register" target="_blank" rel="noopener">finnhub.io</a> and copy your API key.</li>
            <li><a href="#/finnhub">Paste it in Settings → Stock prices</a>. It’s saved with your data in your own Google Drive.</li>
        </ol>
        Until then you can type prices yourself with <em>Edit → Current price</em>.
    </div>`}

    <div class="grid grid-4">
        <section class="card stat">
            <div class="stat-label">Portfolio value</div>
            <div class="stat-value">${folio.totalValue !== null ? money(folio.totalValue) : "—"}</div>
            <div class="stat-sub">${folio.complete ? "Holdings + cash" : `Awaiting ${plural(folio.missingQuotes, "price")}`}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Gain / loss</div>
            <div class="stat-value ${gainClass(folio.gainLoss)}">${signedMoney(folio.gainLoss)}</div>
            <div class="stat-sub">${folio.gainPct !== null ? `<span class="pill ${folio.gainPct >= 0 ? "gain" : "loss"}">${signedPct(folio.gainPct)}</span> unrealized` : "Unrealized"}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Cost basis</div>
            <div class="stat-value">${money(folio.totalInvested)}</div>
            <div class="stat-sub">What you paid</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Uninvested cash</div>
            <div class="stat-value">${money(folio.cashBalance)}</div>
            <div class="stat-sub"><a href="#/cash">${folio.cashRecorded ? `Updated ${esc(fmtDayNoYear(new Date(folio.cashUpdatedAt).toLocaleDateString("en-CA")))} · edit` : "Add cash balance"}</a></div>
        </section>
    </div>

    <section class="card" style="margin-top:16px">
        <div class="card-head"><h2>Holdings</h2></div>
        ${folio.holdings.length ? `
        <div class="table-wrap holdings-table">
            <table>
                <thead><tr>
                    <th>Symbol</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th>
                    <th class="num">Avg cost</th><th class="num">Gain / loss</th><th class="num">Weight</th><th></th>
                </tr></thead>
                <tbody>
                ${folio.holdings.map((h) => `
                <tr>
                    <td>
                        <div class="ticker">${esc(h.stock.symbol)}</div>
                        <div class="small ${h.quote?.failed ? "bad" : "faint"}" title="${esc(h.quote?.error || "")}">${quoteStatus(h)}</div>
                    </td>
                    <td class="num">${num(h.stock.shares, 6)}</td>
                    <td class="num">${h.price === null ? "—" : money(Math.round(h.price * 100))}</td>
                    <td class="num"><strong>${money(h.marketValue)}</strong></td>
                    <td class="num">${money(Math.round(h.stock.averageCost * 100))}</td>
                    <td class="num ${gainClass(h.gainLoss)}">${signedMoney(h.gainLoss)}<div class="small">${signedPct(h.gainPct)}</div></td>
                    <td class="num">${pct(h.weight, 0)}</td>
                    <td class="num" style="white-space:nowrap"><a class="btn btn-ghost btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}/buy">Buy more</a><a class="btn btn-ghost btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}">Edit</a></td>
                </tr>`).join("")}
                </tbody>
            </table>
        </div>
        ${folio.holdings.map((h) => `
        <div class="holding-card">
            <div class="holding-top">
                <div>
                    <div class="ticker">${esc(h.stock.symbol)}</div>
                    <div class="small ${h.quote?.failed ? "bad" : "faint"}">${h.quote?.failed ? "Update failed" : h.quote?.date ? `${money(Math.round(h.price * 100))} · ${esc(fmtDayNoYear(h.quote.date))}` : "No price yet"}</div>
                </div>
                <div style="text-align:right">
                    <div class="row-amount">${money(h.marketValue)}</div>
                    <div class="small ${gainClass(h.gainLoss)}">${signedMoney(h.gainLoss)} (${signedPct(h.gainPct)})</div>
                </div>
            </div>
            <div class="holding-meta">
                <div><span>Shares</span>${num(h.stock.shares, 4)}</div>
                <div><span>Avg cost</span>${money(Math.round(h.stock.averageCost * 100))}</div>
                <div><span>Weight</span>${pct(h.weight, 0)}</div>
            </div>
            <div class="cc-actions" style="margin-top:8px">
                <a class="btn btn-secondary btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}/buy">Buy more</a>
                <a class="btn btn-secondary btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}">Edit</a>
            </div>
        </div>`).join("")}
        ${folio.hasFailedRefresh ? `
        <p class="notice small" style="margin:14px 0 0">
            Some prices could not be updated — the last saved price is shown.
            ${folio.holdings.filter((h) => h.quote?.failed && h.quote.error).map((h) => `<br><strong>${esc(h.stock.symbol)}:</strong> ${esc(h.quote.error)}`).join("")}
        </p>` : ""}
        ` : `<div class="empty"><strong>No holdings yet</strong><a href="#/stock/new">Add your first stock or ETF</a></div>`}
    </section>
    <p class="faint small" style="margin-top:12px">Prices may be delayed up to 15 minutes and refresh automatically when older than that. Not investment advice.</p>`;

    el.querySelector("[data-refresh]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.lastChild.textContent = "Refreshing…";
        const result = await quotes.refreshAll({ force: true });
        if (result.updated) toast(`Updated ${plural(result.updated, "price")}.`);
        if (result.errors.length) toast(result.errors.slice(0, 2).join(" "), "error");
        if (!result.updated && !result.errors.length) toast("All prices are already up to date.");
        rerender();
    });
    if (folio.needsRefresh) refreshQuotesIfStale();
}

// ------------------------------------------------------------- asset forms

const KIND_COPY = {
    vehicle: { intro: "A car, motorcycle or boat. Link its loan to see your equity.", value: ["Current value (USD)", "Kelley Blue Book or Edmunds value (private party or trade-in). Update it every few months."], valueDate: "Value as of", name: "e.g. 2022 Honda CR-V EX-L", notes: "Mileage, condition, warranty…" },
    property: { intro: "A home or land. Link the mortgage to see your equity.", value: ["Current value (USD)", "An estimate such as Zillow or a recent appraisal."], valueDate: "Value as of", name: "e.g. Home — 123 Main St", notes: "Address, purchase details…" },
    cash: { intro: "A savings, checking or emergency-fund balance.", value: ["Balance (USD)", "The current balance. Update it whenever it changes."], valueDate: "Balance as of", name: "e.g. Emergency fund", notes: "Bank, account type, interest rate…" },
    other: { intro: "Anything else with resale value: jewelry, electronics, collectibles.", value: ["Current value (USD)", "What you could reasonably sell it for today."], valueDate: "Value as of", name: "e.g. MacBook Air", notes: "Model, condition…" },
};
const OPTIONAL = ["purchaseDate", "purchaseCents", "loanId"];

export function assetFormView({ el, params, query }) {
    const asset = params.id ? store.get("assets", params.id) : null;
    if (params.id && !asset) return notFound(el, "asset");
    const day = today();
    const loans = store.all("loans").sort(byName);
    const initial = asset || {
        name: query.name || "", kind: ASSET_KINDS.some(([k]) => k === query.kind) ? query.kind : "vehicle",
        valueCents: null, valueDate: day, purchaseDate: query.purchaseDate || "", purchaseCents: null,
        loanId: loans.some((l) => l.id === query.loan) ? query.loan : "", notes: "",
    };
    const fields = [
        { name: "name", label: "Name", value: initial.name, maxlength: 100 },
        { name: "kind", label: "Type", type: "select", options: ASSET_KINDS, value: initial.kind },
        { name: "valueCents", label: "Current value (USD)", type: "money", value: initial.valueCents ?? "", placeholder: "e.g. 24500", help: " " },
        { name: "valueDate", label: "Value as of", type: "date", value: initial.valueDate },
        { name: "purchaseDate", label: "Purchase date", type: "date", value: initial.purchaseDate || "" },
        { name: "purchaseCents", label: "Purchase price (USD)", type: "money", value: initial.purchaseCents ?? "", placeholder: "" },
        { name: "loanId", label: "Financed by", type: "select", emptyLabel: "Not financed / paid off", value: initial.loanId || "",
          options: loans.map((l) => [l.id, `${l.name} (${label(LOAN_KINDS, l.kind)})`]), help: "Link the loan to see your equity (value minus what you still owe)." },
        { name: "notes", label: "Notes", type: "textarea", rows: 3, value: initial.notes || "" },
    ];
    el.innerHTML = formPageHtml({
        title: asset ? `Edit ${asset.name}` : "Add an asset", fields, cancelHref: "#/assets",
        extraHtml: `<p class="muted" data-intro></p>`, deleteLabel: asset ? "Delete" : "",
    });
    const form = el.querySelector("[data-form]");
    const box = (name) => form.querySelector(`[data-field="${name}"]`);
    const update = () => {
        const kind = form.querySelector("[name=kind]").value in KIND_COPY ? form.querySelector("[name=kind]").value : "other";
        for (const name of OPTIONAL) box(name).hidden = !ASSET_FIELDS_BY_KIND[kind].includes(name);
        const c = KIND_COPY[kind];
        el.querySelector("[data-intro]").textContent = c.intro;
        box("valueCents").querySelector("label").textContent = c.value[0];
        box("valueCents").querySelector("[data-help]").textContent = c.value[1];
        box("valueDate").querySelector("label").textContent = c.valueDate;
        form.querySelector("[name=name]").placeholder = c.name;
        form.querySelector("[name=notes]").placeholder = c.notes;
    };
    form.querySelector("[name=kind]").addEventListener("change", update);
    update();

    el.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!confirmAction(`Remove ${asset.name}? Its value history will be deleted too. Linked loans are not affected.`)) return;
        const history = store.all("assetValuations").filter((v) => v.assetId === asset.id);
        await store.saveMany({ assets: [{ id: asset.id, deleted: true }], assetValuations: history.map((v) => ({ id: v.id, deleted: true })) });
        toast(`${asset.name} removed.`);
        navigate("/assets");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const allowed = ASSET_FIELDS_BY_KIND[v.kind] || [];
        const errors = {};
        const name = parse.text(v.name, { max: 100 });
        const value = parse.money(v.valueCents);
        const valueDate = parse.day(v.valueDate);
        const purchaseDate = allowed.includes("purchaseDate") ? parse.day(v.purchaseDate, { required: false }) : { value: null };
        const purchase = allowed.includes("purchaseCents") ? parse.money(v.purchaseCents, { required: false }) : { value: null };
        for (const [k, r] of Object.entries({ name, valueCents: value, valueDate, purchaseDate, purchaseCents: purchase })) if (r.error) errors[k] = r.error;
        if (showErrors(form, errors)) return;
        const saved = {
            ...(asset || { id: newId(), createdAt: new Date().toISOString() }),
            name: name.value, kind: v.kind, valueCents: value.value, valueDate: valueDate.value,
            purchaseDate: purchaseDate.value, purchaseCents: purchase.value,
            loanId: allowed.includes("loanId") ? (v.loanId || null) : null,
            notes: v.notes.trim(),
        };
        const changes = { assets: [saved] };
        if (!asset || asset.valueCents !== saved.valueCents) {
            changes.assetValuations = [{ id: newId(), assetId: saved.id, date: saved.valueDate, valueCents: saved.valueCents, note: asset ? "Edited" : "Initial value", createdAt: new Date().toISOString() }];
        }
        await store.saveMany(changes);
        toast(`${saved.name} saved.`);
        navigate("/assets");
    });
}

export function assetValueView({ el, params }) {
    const asset = store.get("assets", params.id);
    if (!asset) return notFound(el, "asset");
    const day = today();
    const fields = [
        { name: "value", label: "New value (USD)", type: "money", value: asset.valueCents },
        { name: "date", label: "As of", type: "date", value: day },
        { name: "note", label: "Source / note", placeholder: "e.g. KBB private party, 61,200 miles", maxlength: 160 },
    ];
    el.innerHTML = formPageHtml({
        title: `Update ${asset.kind === "cash" ? "balance" : "value"} · ${asset.name}`,
        description: `Currently ${esc(money(asset.valueCents))} as of ${esc(fmtDay(asset.valueDate))}. Each update is kept so you can see depreciation over time.`,
        fields, submitLabel: "Save value", cancelHref: "#/assets",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const value = parse.money(v.value);
        const date = parse.day(v.date);
        if (value.error) errors.value = value.error;
        if (date.error) errors.date = date.error;
        if (showErrors(form, errors)) return;
        const valuation = { id: newId(), assetId: asset.id, date: date.value, valueCents: value.value, note: v.note.trim().slice(0, 160), createdAt: new Date().toISOString() };
        // The newest dated valuation is the current value.
        const latest = currentValuation([...store.all("assetValuations"), valuation], asset.id);
        await store.saveMany({
            assetValuations: [valuation],
            assets: [{ ...asset, valueCents: latest.valueCents, valueDate: latest.date }],
        });
        toast(`${asset.name}: updated to ${money(latest.valueCents)}.`);
        navigate("/assets");
    });
}

// ------------------------------------------------------------- investments

export function stockFormView({ el, params }) {
    const stock = params.id ? store.get("stocks", params.id) : null;
    if (params.id && !stock) return notFound(el, "holding");
    const day = today();
    const fields = [
        { name: "symbol", label: "Stock ticker", value: stock?.symbol || "", placeholder: "e.g. AAPL", disabled: !!stock, maxlength: 15 },
        { name: "shares", label: "Number of shares", type: "decimal", value: stock ? String(stock.shares) : "", help: "Fractional shares are supported, such as 1.5." },
        { name: "averageCost", label: stock ? "Average cost per share" : "Price paid per share", type: "decimal", value: stock ? String(stock.averageCost) : "", help: stock ? "Shown in your brokerage app as “average cost”." : "For several purchases, enter your brokerage’s “average cost”." },
        { name: "price", label: "Current price (optional)", type: "decimal", help: "Leave blank to fetch the live price automatically. Fill it in for funds the price service does not cover (e.g. 401k funds)." },
    ];
    el.innerHTML = formPageHtml({
        title: stock ? `Edit ${stock.symbol}` : "Add a holding", fields, cancelHref: "#/assets", deleteLabel: stock ? "Remove" : "",
        extraHtml: stock ? `<p style="margin:4px 0 0"><a class="btn btn-secondary btn-small" href="#/stock/${encodeURIComponent(stock.id)}/buy">Bought more ${esc(stock.symbol)}? Add a purchase</a></p>` : "",
        afterFields: stock ? purchaseHistoryHtml(stock) : "",
    });
    const form = el.querySelector("[data-form]");
    if (!stock) {
        // Typing a ticker you already hold: explain that the shares will be combined.
        const symbolInput = form.querySelector("[name=symbol]");
        symbolInput.closest(".field").insertAdjacentHTML("afterend", `<p class="notice small" data-combine hidden></p>`);
        const hint = form.querySelector("[data-combine]");
        symbolInput.addEventListener("input", () => {
            const held = store.all("stocks").find((s) => s.symbol === symbolInput.value.trim().toUpperCase());
            hint.hidden = !held;
            if (held) hint.innerHTML = `You already own <strong>${num(held.shares, 6)} ${esc(held.symbol)}</strong> at ${money(Math.round(held.averageCost * 100))} average. Saving adds these shares to it and works out the new average cost.`;
        });
    }
    el.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!confirmAction(`Remove ${stock.symbol} from your holdings?`)) return;
        await store.remove("stocks", stock.id);
        toast(`${stock.symbol} removed.`);
        navigate("/assets");
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const symbol = stock ? stock.symbol : String(v.symbol || "").trim().toUpperCase();
        if (!stock && !/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) errors.symbol = "Enter a valid stock ticker.";
        const held = stock ? null : store.all("stocks").find((s) => s.symbol === symbol);
        const shares = toDecimal(v.shares);
        if (shares === null || shares <= 0) errors.shares = "Enter the number of shares (more than 0).";
        const averageCost = toDecimal(v.averageCost);
        if (averageCost === null || averageCost < 0) errors.averageCost = "Enter the average cost (0 or more).";
        const priceText = String(v.price || "").trim();
        const price = priceText ? toDecimal(priceText) : null;
        if (priceText && (price === null || price <= 0)) errors.price = "Enter a price greater than 0, or leave it blank.";
        if (showErrors(form, errors)) return;
        let saved;
        if (held) {
            // Same ticker added again: combine into the existing holding.
            const combined = combinePurchase(held.shares, held.averageCost, shares, averageCost);
            saved = { ...held, ...combined, purchases: [...purchasesOf(held), { date: day, shares, price: averageCost, kind: "buy" }] };
        } else if (stock) {
            const changed = shares !== stock.shares || averageCost !== stock.averageCost;
            saved = { ...stock, shares, averageCost, purchases: changed ? [...purchasesOf(stock), { date: day, shares, price: averageCost, kind: "edit" }] : purchasesOf(stock) };
        } else {
            saved = { id: newId(), createdAt: new Date().toISOString(), symbol, shares, averageCost, purchases: [{ date: day, shares, price: averageCost, kind: "start" }] };
        }
        await store.save("stocks", saved);
        if (held) {
            if (price) await quotes.setManualPrice(symbol, price, day);
            toast(`Added ${num(shares, 6)} ${symbol}: now ${num(saved.shares, 6)} shares at ${money(Math.round(saved.averageCost * 100))} average.`);
            navigate("/assets");
            return;
        }
        if (price) {
            await quotes.setManualPrice(symbol, price, day);
        } else if (!store.get("quotes", quoteId(symbol))?.price) {
            const { ok, message } = await quotes.refreshSymbol(symbol);
            if (!ok) {
                toast(`Saved ${symbol}, but the price could not be fetched: ${message}`, "error");
                navigate("/assets");
                return;
            }
        }
        toast(`${symbol} saved.`);
        navigate("/assets");
    });
}

export function cashFormView({ el }) {
    const cash = store.get("prefs", INVESTMENT_CASH_ID);
    const fields = [{ name: "balance", label: "Uninvested cash (USD)", type: "money", value: cash ? cash.balanceCents : "" }];
    el.innerHTML = formPageHtml({
        title: "Uninvested cash",
        description: "Enter the cash sitting uninvested in your brokerage account. Exclude borrowed buying power.",
        fields, cancelHref: "#/assets",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const balance = parse.money(readForm(form).balance);
        if (showErrors(form, balance.error ? { balance: balance.error } : {})) return;
        await store.save("prefs", { id: INVESTMENT_CASH_ID, balanceCents: balance.value });
        toast("Uninvested cash updated.");
        navigate("/assets");
    });
}


const purchasesOf = (stock) => (Array.isArray(stock.purchases) ? stock.purchases : []);
const PURCHASE_KIND = { start: "Added", buy: "Bought", edit: "Set to" };

function purchaseHistoryHtml(stock) {
    const list = purchasesOf(stock).slice().reverse();
    if (!list.length) return "";
    return `<div class="field"><label>History</label>
        <ul class="list purchase-list">${list.map((p) => `
            <li class="row"><span class="row-main"><span class="row-title">${esc(PURCHASE_KIND[p.kind] || "Bought")} ${num(p.shares, 6)} ${p.kind === "edit" ? "shares" : `share${p.shares === 1 ? "" : "s"}`} @ ${money(Math.round(p.price * 100))}</span>
                <span class="row-sub">${esc(fmtDay(p.date))}</span></span>
                <span class="row-end num">${p.kind === "edit" ? "" : money(Math.round(p.shares * p.price * 100))}</span></li>`).join("")}
        </ul></div>`;
}

/** Record another purchase of a stock you already hold (#/stock/:id/buy). */
export function stockBuyView({ el, params }) {
    const stock = store.get("stocks", params.id);
    if (!stock) return notFound(el, "holding");
    const day = today();
    el.innerHTML = formPageHtml({
        title: `Buy more ${stock.symbol}`,
        description: `You have <strong>${num(stock.shares, 6)} shares</strong> at ${money(Math.round(stock.averageCost * 100))} average. Enter the new purchase and the app works out your new total and average cost.`,
        fields: [
            { name: "shares", label: "Shares bought", type: "decimal", help: "Fractional shares are supported, such as 0.5." },
            { name: "price", label: "Price paid per share", type: "decimal" },
            { name: "date", label: "Date", type: "date", value: day },
        ],
        afterFields: `<div class="notice small" data-preview hidden></div>`,
        submitLabel: "Add purchase",
        cancelHref: "#/assets",
    });
    const form = el.querySelector("[data-form]");
    const preview = form.querySelector("[data-preview]");
    const read = () => {
        const v = readForm(form);
        return { shares: toDecimal(v.shares), price: toDecimal(v.price), date: v.date };
    };
    form.addEventListener("input", () => {
        const { shares, price } = read();
        const ok = shares > 0 && price !== null && price >= 0;
        preview.hidden = !ok;
        if (!ok) return;
        const after = combinePurchase(stock.shares, stock.averageCost, shares, price);
        preview.innerHTML = `After this purchase: <strong>${num(after.shares, 6)} shares</strong> at <strong>${money(Math.round(after.averageCost * 100))}</strong> average · ${money(Math.round(after.shares * after.averageCost * 100))} invested.`;
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const { shares, price, date } = read();
        const errors = {};
        if (shares === null || shares <= 0) errors.shares = "Enter the number of shares (more than 0).";
        if (price === null || price < 0) errors.price = "Enter the price per share (0 or more).";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) errors.date = "Pick a date.";
        if (showErrors(form, errors)) return;
        const after = combinePurchase(stock.shares, stock.averageCost, shares, price);
        const current = store.get("stocks", stock.id) || stock;
        await store.save("stocks", { ...current, ...after, purchases: [...purchasesOf(current), { date, shares, price, kind: "buy" }] });
        toast(`${stock.symbol}: now ${num(after.shares, 6)} shares at ${money(Math.round(after.averageCost * 100))} average.`);
        navigate("/assets");
    });
}
