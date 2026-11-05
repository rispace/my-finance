// Assets page (investments.html): owned assets (car, home, savings) with
// value history and equity, followed by investments (stocks/ETFs + cash).

import * as store from "../store.js";
import {
    assetRows, portfolio, ASSET_KINDS, ASSET_FIELDS_BY_KIND, LOAN_KINDS, label, currentValuation,
    quoteId, quoteKey, isCrypto, INVESTMENT_CASH_ID, combinePurchase, BANK_ACCOUNT_KINDS, linkedBalance, ACCOUNT_KINDS,
    HISTORY_RANGES, historySeries, historySnapshot, historyId,
} from "../calc.js";
import {
    esc, money, signedMoney, pct, signedPct, num, today, fmtDay, fmtDayNoYear, fmtMonthYear, timeAgo,
    centsToInput, toDecimal, byName, newId, plural,
} from "../util.js";
import { formPageHtml, fieldHtml, readForm, showErrors, parse, toast, confirmAction } from "../ui.js";
import { navigate, refreshQuotesIfStale } from "../app.js";
import * as quotes from "../quotes.js";

const gainClass = (v) => (v === null ? "" : v >= 0 ? "good" : "bad");

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
            ${a.flow ? `<div class="muted small">Updates from ${esc(a.accountIds.map((id) => store.get("accounts", id)?.name).filter(Boolean).join(", "))}</div>
            <div class="small flow-line">${money(a.flow.startCents)} on ${esc(fmtDay(a.flow.startDate))}${a.flow.deposited ? ` · <span class="good">+${money(a.flow.deposited)} deposited</span>` : ""}${a.flow.spent ? ` · <span class="bad">−${money(a.flow.spent)} spent</span>` : ""}</div>
            ${a.flow.items.length ? `<details style="margin-top:8px"><summary class="small">${plural(a.flow.items.length, "change")} since ${esc(fmtDay(a.flow.startDate))}</summary>
                <ul class="list">${a.flow.items.slice(0, 30).map((i) => `<li class="row" style="padding:6px 0"><div class="row-main small">${esc(fmtDayNoYear(i.date))} · ${esc(i.label)} <span class="faint">· ${esc(store.get("accounts", i.accountId)?.name || "")}</span></div><div class="row-end small num ${i.amountCents >= 0 ? "good" : ""}">${i.amountCents >= 0 ? "+" : "−"}${money(Math.abs(i.amountCents))}</div></li>`).join("")}</ul></details>` : ""}` : `
            <div class="muted small">${a.kind === "cash" ? "Balance" : "Estimated value"} as of ${esc(fmtDay(a.valueDate))}${row.change !== null
                ? ` · <span class="${row.change >= 0 ? "good" : "bad"}">${signedMoney(row.change)} (${signedPct(row.changePct)}) since purchase</span>` : ""}</div>`}
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
            <p class="muted small" style="margin-top:4px">${folio.lastChecked ? `Prices updated ${esc(timeAgo(folio.lastChecked))}` : folio.holdings.length ? "Prices not loaded yet" : "Track stocks, ETFs and crypto at live prices"}</p>
        </div>
        <div class="page-actions">
            ${folio.holdings.length ? `<button type="button" class="btn-secondary btn-small" data-refresh><svg width="16" height="16"><use href="#i-refresh"/></svg>Refresh prices</button>` : ""}
            <a class="btn btn-small" href="#/stock/new"><svg width="16" height="16"><use href="#i-plus"/></svg>Add stock</a>
            <a class="btn btn-secondary btn-small" href="#/crypto/new"><svg width="16" height="16"><use href="#i-plus"/></svg>Add crypto</a>
        </div>
    </div>

    ${hasKey || !folio.stocks.holdings.length ? "" : `
    <div class="notice">
        <strong>Live stock prices are turned off.</strong> The app needs a free price-data key to update your stocks (crypto prices need no key).
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

    ${folio.holdings.length || folio.cashRecorded ? historyCardHtml() : ""}

    <section class="card" style="margin-top:16px">
        <div class="card-head"><h2>Stocks &amp; ETFs</h2>${folio.stocks.holdings.length ? `<span class="muted small">${money(folio.stocks.value)}</span>` : ""}</div>
        ${folio.stocks.holdings.length ? holdingsHtml(folio.stocks.holdings, quoteStatus)
            : `<div class="empty"><strong>No stocks yet</strong><a href="#/stock/new">Add your first stock or ETF</a></div>`}
    </section>

    <section class="card" style="margin-top:16px">
        <div class="card-head"><h2>Crypto</h2>${folio.crypto.holdings.length ? `<span class="muted small">${money(folio.crypto.value)}</span>` : ""}</div>
        ${folio.crypto.holdings.length ? holdingsHtml(folio.crypto.holdings, quoteStatus)
            : `<div class="empty"><strong>No crypto yet</strong><a href="#/crypto/new">Add Bitcoin, Ethereum or any other coin</a></div>`}
        ${folio.crypto.holdings.length ? `<p class="faint small" style="margin:12px 0 0">Crypto prices by <a href="https://www.coingecko.com/" target="_blank" rel="noopener">CoinGecko</a>.</p>` : ""}
    </section>

    ${folio.hasFailedRefresh ? `
    <p class="notice small" style="margin:14px 0 0">
        Some prices could not be updated. The last saved price is shown.
        ${folio.holdings.filter((h) => h.quote?.failed && h.quote.error).map((h) => `<br><strong>${esc(h.stock.symbol)}:</strong> ${esc(h.quote.error)}`).join("")}
    </p>` : ""}
    <p class="faint small" style="margin-top:12px">Prices may be delayed up to 15 minutes and refresh automatically when older than that. Not investment advice.</p>`;
    bindHistoryCard(el);

    el.querySelector("[data-refresh]")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.lastChild.textContent = "Refreshing…";
        const result = await quotes.refreshAll({ force: true });
        if (result.updated) toast(`Updated ${plural(result.updated, "price")}.`);
        if (result.errors.length) toast(result.errors.slice(0, 2).join(" "), "error");
        if (!result.updated && !result.errors.length) toast("All prices are already up to date.");
        await recordPortfolioHistory();
        rerender();
    });
    if (folio.needsRefresh) refreshQuotesIfStale();
    else recordPortfolioHistory();
}

// ------------------------------------------------------------- asset forms

const KIND_COPY = {
    vehicle: { intro: "A car, motorcycle or boat. Link its loan to see your equity.", value: ["Current value (USD)", "Kelley Blue Book or Edmunds value (private party or trade-in). Update it every few months."], valueDate: "Value as of", name: "e.g. 2022 Honda CR-V EX-L", notes: "Mileage, condition, warranty…" },
    property: { intro: "A home or land. Link the mortgage to see your equity.", value: ["Current value (USD)", "An estimate such as Zillow or a recent appraisal."], valueDate: "Value as of", name: "e.g. Home — 123 Main St", notes: "Address, purchase details…" },
    cash: { intro: "A savings or checking balance. Link the bank account or debit card and the balance updates by itself from your spending and deposits.", value: ["Balance", "What the account holds on the date below."], valueDate: "Balance as of", name: "e.g. CSB checking", notes: "Account type, interest rate…" },
    other: { intro: "Anything else with resale value: jewelry, electronics, collectibles.", value: ["Current value (USD)", "What you could reasonably sell it for today."], valueDate: "Value as of", name: "e.g. MacBook Air", notes: "Model, condition…" },
};
const OPTIONAL = ["purchaseDate", "purchaseCents", "loanId"];

export function assetFormView({ el, params, query }) {
    const asset = params.id ? store.get("assets", params.id) : null;
    if (params.id && !asset) return notFound(el, "asset");
    const day = today();
    const loans = store.all("loans").sort(byName);
    const liveFlow = asset ? linkedBalance(asset, store.snapshot()) : null;
    const initial = asset ? { ...asset, ...(liveFlow ? { valueCents: liveFlow.valueCents, valueDate: day } : {}) } : {
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
    // Cash / savings: which bank accounts or debit cards hold this money.
    const linkedNow = new Set(asset?.accountIds || []);
    const takenBy = new Map();
    for (const other of store.all("assets")) if (other.id !== asset?.id) for (const id of other.accountIds || []) takenBy.set(id, other.name);
    const bankAccounts = store.all("accounts").filter((a) => BANK_ACCOUNT_KINDS.includes(a.kind) && (!a.archived || linkedNow.has(a.id))).sort(byName);
    el.querySelector("[data-field=valueDate]").insertAdjacentHTML("afterend", `
        <div class="field" data-field="accountIds">
            <label>Linked bank account / debit card</label>
            <div class="check-list">
                ${bankAccounts.map((a) => `<label class="check-item ${takenBy.has(a.id) ? "muted" : ""}">
                    <input type="checkbox" name="link" value="${esc(a.id)}" ${linkedNow.has(a.id) ? "checked" : ""} ${takenBy.has(a.id) ? "disabled" : ""}>
                    <span>${esc(a.name)} <span class="faint small">· ${esc(label(ACCOUNT_KINDS, a.kind))}${takenBy.has(a.id) ? ` · linked to ${esc(takenBy.get(a.id))}` : ""}</span></span></label>`).join("") || `<p class="muted small" style="margin:0">No bank accounts or debit cards yet.</p>`}
            </div>
            <input type="text" name="newAccount" placeholder="+ Add another bank account, e.g. Chase savings" maxlength="60" autocomplete="off" style="margin-top:8px">
            <p class="help">Spending paid with a linked account and earnings deposited into it update this balance automatically. Leave all unticked to update it by hand.</p>
        </div>`);
    const form = el.querySelector("[data-form]");
    const box = (name) => form.querySelector(`[data-field="${name}"]`);
    const update = () => {
        const kind = form.querySelector("[name=kind]").value in KIND_COPY ? form.querySelector("[name=kind]").value : "other";
        for (const name of OPTIONAL) box(name).hidden = !ASSET_FIELDS_BY_KIND[kind].includes(name);
        box("accountIds").hidden = kind !== "cash";
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
        const changes = { assets: [] };
        // Linked accounts (cash only), including one typed in as new.
        let accountIds = [];
        if (v.kind === "cash") {
            accountIds = [...form.querySelectorAll("[name=link]:checked")].map((c) => c.value);
            const newName = String(v.newAccount || "").replace(/\s+/g, " ").trim().slice(0, 60);
            if (newName) {
                const existing = store.all("accounts").find((a) => a.name.toLowerCase() === newName.toLowerCase());
                const account = existing || { id: newId(), name: newName, kind: "debit", archived: false, createdAt: new Date().toISOString() };
                if (!existing) changes.accounts = [account];
                if (!accountIds.includes(account.id)) accountIds.push(account.id);
            }
        }
        const sameLinks = asset && accountIds.length === linkedNow.size && accountIds.every((id) => linkedNow.has(id));
        // A linked balance only gets a new starting point when you change it (or its accounts).
        const keepAnchor = asset && liveFlow && sameLinks && value.value === liveFlow.valueCents;
        const saved = {
            ...(asset || { id: newId(), createdAt: new Date().toISOString() }),
            name: name.value, kind: v.kind,
            ...(keepAnchor ? {} : { valueCents: value.value, valueDate: valueDate.value, valueSetAt: new Date().toISOString() }),
            purchaseDate: purchaseDate.value, purchaseCents: purchase.value,
            loanId: allowed.includes("loanId") ? (v.loanId || null) : null,
            accountIds,
            notes: v.notes.trim(),
        };
        changes.assets.push(saved);
        if (!asset || (!keepAnchor && (liveFlow ? liveFlow.valueCents : asset.valueCents) !== saved.valueCents)) {
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
    const flow = linkedBalance(asset, store.snapshot());
    const current = flow ? flow.valueCents : asset.valueCents;
    const fields = [
        { name: "value", label: asset.kind === "cash" ? "Actual balance" : "New value", type: "money", value: current },
        { name: "date", label: "As of", type: "date", value: day },
        { name: "note", label: "Source / note", placeholder: "e.g. KBB private party, 61,200 miles", maxlength: 160 },
    ];
    el.innerHTML = formPageHtml({
        title: `Update ${asset.kind === "cash" ? "balance" : "value"} · ${asset.name}`,
        description: flow
            ? `The app has it at ${esc(money(current))}, worked out from your linked accounts. If your bank shows a different balance, enter it here and the automatic updates continue from that.`
            : `Currently ${esc(money(asset.valueCents))} as of ${esc(fmtDay(asset.valueDate))}. Each update is kept so you can see depreciation over time.`,
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
            assets: [{ ...asset, valueCents: latest.valueCents, valueDate: latest.date, valueSetAt: new Date().toISOString() }],
        });
        toast(`${asset.name}: updated to ${money(latest.valueCents)}.`);
        navigate("/assets");
    });
}

// ------------------------------------------------------------- investments

export function stockFormView({ el, params }) {
    const stock = params.id ? store.get("stocks", params.id) : null;
    if (params.id && !stock) return notFound(el, "holding");
    const crypto = isCrypto(stock);
    const day = today();
    const fields = [
        { name: "symbol", label: crypto ? "Coin" : "Stock ticker", value: stock ? (crypto && stock.name ? `${stock.name} (${stock.symbol})` : stock.symbol) : "", placeholder: "e.g. AAPL", disabled: !!stock, maxlength: 15 },
        { name: "shares", label: crypto ? "Amount you hold" : "Number of shares", type: "decimal", value: stock ? String(stock.shares) : "", help: crypto ? "Fractions are fine, such as 0.0125." : "Fractional shares are supported, such as 1.5." },
        { name: "averageCost", label: crypto ? "Average cost per coin" : stock ? "Average cost per share" : "Price paid per share", type: "decimal", value: stock ? String(stock.averageCost) : "", help: stock ? "Shown in your brokerage app as “average cost”." : "For several purchases, enter your brokerage’s “average cost”." },
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
            const held = store.all("stocks").find((s) => !isCrypto(s) && s.symbol === symbolInput.value.trim().toUpperCase());
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
        const held = stock ? null : store.all("stocks").find((s) => s.symbol === symbol && !isCrypto(s));
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
            await quotes.setManualPrice(crypto ? saved : symbol, price, day);
        } else if (crypto) {
            if (!store.get("quotes", quoteKey(saved))?.price) await quotes.refreshCrypto([saved]);
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
        description: `You have <strong>${num(stock.shares, 8)}${isCrypto(stock) ? ` ${esc(stock.symbol)}` : " shares"}</strong> at ${fmtPrice(stock.averageCost)} average. Enter the new purchase and the app works out your new total and average cost.`,
        fields: [
            { name: "shares", label: isCrypto(stock) ? "Amount bought" : "Shares bought", type: "decimal", help: "Fractions are supported, such as 0.5." },
            { name: "price", label: isCrypto(stock) ? "Price paid per coin" : "Price paid per share", type: "decimal" },
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
        toast(`${stock.symbol}: now ${num(after.shares, 8)}${isCrypto(stock) ? "" : " shares"} at ${fmtPrice(after.averageCost)} average.`);
        await recordPortfolioHistory();
        navigate("/assets");
    });
}

// ------------------------------------------------------------- holdings list

/** Prices: cents for normal prices, more decimals for coins worth under $1. */
function fmtPrice(p) {
    if (p === null || p === undefined) return "—";
    return p >= 1 ? money(Math.round(p * 100)) : money(p * 100, p >= 0.01 ? 4 : 8);
}

function holdingsHtml(list, quoteStatus) {
    const crypto = isCrypto(list[0]?.stock);
    const unit = crypto ? "Amount" : "Shares";
    const qty = (h) => num(h.stock.shares, crypto ? 8 : 6);
    const named = (h) => crypto && h.stock.name && h.stock.name !== h.stock.symbol;
    const label = (h) => (named(h) ? `<div class="small faint">${esc(h.stock.name)}</div>` : "");
    return `
        <div class="table-wrap holdings-table">
            <table>
                <thead><tr>
                    <th>${crypto ? "Coin" : "Symbol"}</th><th class="num">${unit}</th><th class="num">Price</th><th class="num">Value</th>
                    <th class="num">Avg cost</th><th class="num">Gain / loss</th><th class="num">Weight</th><th></th>
                </tr></thead>
                <tbody>
                ${list.map((h) => `
                <tr>
                    <td>
                        <div class="ticker">${esc(h.stock.symbol)}</div>${label(h)}
                        <div class="small ${h.quote?.failed ? "bad" : "faint"}" title="${esc(h.quote?.error || "")}">${quoteStatus(h)}</div>
                    </td>
                    <td class="num">${qty(h)}</td>
                    <td class="num">${fmtPrice(h.price)}</td>
                    <td class="num"><strong>${money(h.marketValue)}</strong></td>
                    <td class="num">${fmtPrice(h.stock.averageCost)}</td>
                    <td class="num ${gainClass(h.gainLoss)}">${signedMoney(h.gainLoss)}<div class="small">${signedPct(h.gainPct)}</div></td>
                    <td class="num">${pct(h.weight, 0)}</td>
                    <td class="num" style="white-space:nowrap"><a class="btn btn-ghost btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}/buy">Buy more</a><a class="btn btn-ghost btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}">Edit</a></td>
                </tr>`).join("")}
                </tbody>
            </table>
        </div>
        ${list.map((h) => `
        <div class="holding-card">
            <div class="holding-top">
                <div>
                    <div class="ticker">${esc(h.stock.symbol)}${named(h) ? ` <span class="small faint" style="font-weight:500">${esc(h.stock.name)}</span>` : ""}</div>
                    <div class="small ${h.quote?.failed ? "bad" : "faint"}">${h.quote?.failed ? "Update failed" : h.quote?.date ? `${fmtPrice(h.price)} · ${esc(fmtDayNoYear(h.quote.date))}` : "No price yet"}</div>
                </div>
                <div style="text-align:right">
                    <div class="row-amount">${money(h.marketValue)}</div>
                    <div class="small ${gainClass(h.gainLoss)}">${signedMoney(h.gainLoss)} (${signedPct(h.gainPct)})</div>
                </div>
            </div>
            <div class="holding-meta">
                <div><span>${unit}</span>${num(h.stock.shares, crypto ? 8 : 4)}</div>
                <div><span>Avg cost</span>${fmtPrice(h.stock.averageCost)}</div>
                <div><span>Weight</span>${pct(h.weight, 0)}</div>
            </div>
            <div class="cc-actions" style="margin-top:8px">
                <a class="btn btn-secondary btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}/buy">Buy more</a>
                <a class="btn btn-secondary btn-small" href="#/stock/${encodeURIComponent(h.stock.id)}">Edit</a>
            </div>
        </div>`).join("")}`;
}

// ---------------------------------------------------------- value history chart

let historyRange = "1M";

function historyCardHtml() {
    return `
    <section class="card history-card" style="margin-top:16px" data-history>
        <div class="history-head">
            <div class="stat-label">Investments</div>
            <div class="history-value" data-hv></div>
            <div class="history-change" data-hc></div>
        </div>
        <div class="history-chart" data-chart></div>
        <div class="history-ranges" role="group" aria-label="Time range">
            ${HISTORY_RANGES.map(([k, l]) => `<button type="button" data-range="${k}" title="${esc(l)}" aria-pressed="${k === historyRange}">${k}</button>`).join("")}
        </div>
    </section>`;
}

function bindHistoryCard(el) {
    const card = el.querySelector("[data-history]");
    if (!card) return;
    const draw = () => {
        const day = today();
        const pts = historySeries(store.all("portfolioHistory"), historyRange, day);
        const label = HISTORY_RANGES.find(([k]) => k === historyRange)[1];
        card.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === historyRange)));
        const $v = card.querySelector("[data-hv]");
        const $c = card.querySelector("[data-hc]");
        const $chart = card.querySelector("[data-chart]");
        const latest = store.all("portfolioHistory").sort((a, b) => b.date.localeCompare(a.date))[0];
        const setHeader = (value, base, when) => {
            $v.textContent = money(value);
            const diff = value - base;
            const cls = diff > 0 ? "good" : diff < 0 ? "bad" : "muted";
            $c.innerHTML = `<span class="${cls}">${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))} (${base ? signedPct((diff / base) * 100) : "0.00%"})</span> <span class="muted">${esc(when)}</span>`;
        };
        if (pts.length < 2) {
            card.classList.remove("up", "down");
            $v.textContent = latest ? money(latest.valueCents) : "—";
            $c.innerHTML = `<span class="muted">Not enough history yet</span>`;
            $chart.innerHTML = `<div class="history-empty">The chart starts on the first day the app saved your portfolio value${latest ? ` (${esc(fmtDay(store.all("portfolioHistory").sort((a, b) => a.date.localeCompare(b.date))[0].date))})` : ""} and fills in as you keep opening the app. Free price services don’t provide past stock prices, so earlier days can’t be filled in.</div>`;
            return;
        }
        const first = pts[0].v;
        const last = pts[pts.length - 1].v;
        card.classList.toggle("up", last >= first);
        card.classList.toggle("down", last < first);
        setHeader(last, first, label);
        // SVG line chart, Robinhood style: one line, dotted starting level, scrub to read values.
        const W = 600, H = 190, PAD = 10;
        const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
        const vals = pts.map((p) => p.v);
        let lo = Math.min(...vals), hi = Math.max(...vals);
        if (hi === lo) { hi += 100; lo -= 100; }
        const x = (t) => (t1 === t0 ? W / 2 : ((t - t0) / (t1 - t0)) * W);
        const y = (v) => PAD + (1 - (v - lo) / (hi - lo)) * (H - 2 * PAD);
        const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
        $chart.innerHTML = `
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Portfolio value, ${esc(label)}: from ${esc(money(first))} to ${esc(money(last))}">
                <line class="history-base" x1="0" x2="${W}" y1="${y(first).toFixed(1)}" y2="${y(first).toFixed(1)}"/>
                <path class="history-line" d="${path}" vector-effect="non-scaling-stroke"/>
                <line class="history-cursor" x1="0" x2="0" y1="0" y2="${H}" style="display:none" vector-effect="non-scaling-stroke"/>
            </svg>
            <span class="history-dot" hidden></span>
            <span class="history-tip" hidden></span>`;
        const svg = $chart.querySelector("svg");
        const cursor = $chart.querySelector(".history-cursor");
        const dot = $chart.querySelector(".history-dot");
        const tip = $chart.querySelector(".history-tip");
        const when = (p) => (p.intraday && !p.previousClose ? new Date(p.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : fmtDay(p.day));
        const move = (clientX) => {
            const box = svg.getBoundingClientRect();
            const fx = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
            const t = t0 + fx * (t1 - t0);
            const p = pts.reduce((best, q) => (Math.abs(q.t - t) < Math.abs(best.t - t) ? q : best), pts[0]);
            const px = x(p.t), py = y(p.v);
            cursor.setAttribute("x1", px); cursor.setAttribute("x2", px); cursor.style.display = "";
            dot.hidden = false;
            dot.style.left = `${(px / W) * 100}%`;
            dot.style.top = `${(py / H) * 100}%`;
            tip.hidden = false;
            tip.textContent = when(p);
            tip.style.left = `${Math.min(88, Math.max(12, (px / W) * 100))}%`;
            setHeader(p.v, first, ""); // the date is shown above the cursor
        };
        const leave = () => { cursor.style.display = "none"; dot.hidden = true; tip.hidden = true; setHeader(last, first, label); };
        svg.addEventListener("pointermove", (e) => move(e.clientX));
        svg.addEventListener("pointerdown", (e) => move(e.clientX));
        svg.addEventListener("pointerleave", leave);
        svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") leave(); });
    };
    card.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", () => { historyRange = b.dataset.range; draw(); }));
    draw();
}

/** Save today's portfolio value for the chart (only when every price is loaded). */
export async function recordPortfolioHistory() {
    const day = today();
    const record = historySnapshot(portfolio(store.snapshot()), store.get("portfolioHistory", historyId(day)), day);
    if (record) await store.save("portfolioHistory", record);
}

// ------------------------------------------------------------------ crypto

/** Add a coin (#/crypto/new): search CoinGecko, then quantity and cost. */
export function cryptoFormView({ el }) {
    const day = today();
    el.innerHTML = formPageHtml({
        title: "Add crypto",
        description: "Search for the coin, then enter how much you hold and what you paid. Prices update automatically from CoinGecko (no key needed).",
        fields: [
            { name: "query", label: "Coin", placeholder: "e.g. Bitcoin or BTC", maxlength: 60, attrs: 'autocomplete="off" autocapitalize="off" spellcheck="false"' },
            { name: "shares", label: "Amount you hold", type: "decimal", help: "Fractions are fine, such as 0.0125 BTC." },
            { name: "averageCost", label: "Price paid per coin", type: "decimal", help: "For several purchases, use the average cost shown by your exchange." },
            { name: "price", label: "Current price (optional)", type: "decimal", help: "Leave blank to fetch it automatically." },
        ],
        submitLabel: "Add coin",
        cancelHref: "#/assets",
    });
    const form = el.querySelector("[data-form]");
    const query = form.querySelector("[name=query]");
    query.closest(".field").insertAdjacentHTML("beforeend", `<div class="coin-results" data-results></div><p class="notice small" data-picked hidden></p>`);
    const results = form.querySelector("[data-results]");
    const picked = form.querySelector("[data-picked]");
    let coin = null;
    let timer = null;
    let seq = 0;
    const pick = (c) => {
        coin = c;
        results.innerHTML = "";
        picked.hidden = false;
        const held = store.all("stocks").find((s) => isCrypto(s) && s.coinId === c.id);
        picked.innerHTML = `Selected <strong>${esc(c.name)} (${esc(c.symbol)})</strong>.${held ? ` You already hold ${num(held.shares, 8)} ${esc(held.symbol)}; this adds to it and works out the new average cost.` : ""} <button type="button" class="link" data-change>Change</button>`;
        picked.querySelector("[data-change]").addEventListener("click", () => { coin = null; picked.hidden = true; query.value = ""; query.focus(); });
        query.value = `${c.name} (${c.symbol})`;
    };
    const search = async () => {
        const q = query.value.trim();
        const mine = ++seq;
        if (q.length < 2) { results.innerHTML = ""; return; }
        results.innerHTML = `<p class="muted small">Searching…</p>`;
        try {
            const found = await quotes.searchCoins(q);
            if (mine !== seq) return;
            results.innerHTML = found.length ? found.map((c, i) => `
                <button type="button" class="row coin-option" data-i="${i}">
                    ${c.thumb ? `<img src="${esc(c.thumb)}" alt="" width="22" height="22" loading="lazy">` : ""}
                    <span class="row-main"><span class="row-title">${esc(c.name)}</span> <span class="faint small">${esc(c.symbol)}${c.rank ? ` · #${c.rank}` : ""}</span></span>
                </button>`).join("") : `<p class="muted small">No coins match “${esc(q)}”.</p>`;
            results.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => pick(found[Number(b.dataset.i)])));
        } catch (error) {
            if (mine !== seq) return;
            // Offline or CoinGecko unavailable: still allow adding it with a typed symbol and price.
            results.innerHTML = `<p class="muted small">${esc(error.message)} You can still add it: type its symbol (e.g. BTC) and enter the current price yourself.</p>`;
        }
    };
    query.addEventListener("input", () => {
        if (coin) { coin = null; picked.hidden = true; }
        clearTimeout(timer);
        timer = setTimeout(search, 350);
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        let chosen = coin;
        const typed = String(v.query || "").trim().toUpperCase();
        if (!chosen && /^[A-Z0-9]{2,10}$/.test(typed)) chosen = { id: `manual-${typed.toLowerCase()}`, symbol: typed, name: typed, manual: true };
        if (!chosen) errors.query = "Search and pick a coin from the list.";
        const shares = toDecimal(v.shares);
        if (shares === null || shares <= 0) errors.shares = "Enter the amount you hold (more than 0).";
        const averageCost = toDecimal(v.averageCost);
        if (averageCost === null || averageCost < 0) errors.averageCost = "Enter the price you paid (0 or more).";
        const priceText = String(v.price || "").trim();
        const price = priceText ? toDecimal(priceText) : null;
        if (priceText && (price === null || price <= 0)) errors.price = "Enter a price greater than 0, or leave it blank.";
        if (chosen?.manual && !price) errors.price = "This coin wasn’t found on CoinGecko, so enter its current price.";
        if (showErrors(form, errors)) return;
        const held = store.all("stocks").find((s) => isCrypto(s) && s.coinId === chosen.id);
        const saved = held
            ? { ...held, ...combinePurchase(held.shares, held.averageCost, shares, averageCost), purchases: [...purchasesOf(held), { date: day, shares, price: averageCost, kind: "buy" }] }
            : { id: newId(), createdAt: new Date().toISOString(), assetType: "crypto", coinId: chosen.id, symbol: chosen.symbol, name: chosen.name, shares, averageCost, purchases: [{ date: day, shares, price: averageCost, kind: "start" }] };
        await store.save("stocks", saved);
        if (price) await quotes.setManualPrice(saved, price, day);
        else if (!store.get("quotes", quoteKey(saved))?.price) {
            const r = await quotes.refreshCrypto([saved]);
            if (r.failed) toast(`Saved ${saved.symbol}, but the price could not be fetched: ${r.errors[0] || ""}`, "error");
        }
        if (!toastShownForFailure(saved)) toast(held ? `Added ${num(shares, 8)} ${saved.symbol}: now ${num(saved.shares, 8)} at ${fmtPrice(saved.averageCost)} average.` : `${saved.symbol} added.`);
        await recordPortfolioHistory();
        navigate("/assets");
    });
}
const toastShownForFailure = (saved) => !!store.get("quotes", quoteKey(saved))?.failed;
