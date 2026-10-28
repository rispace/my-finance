// Overview (the web app's dashboard.html).

import * as store from "../store.js";
import { dashboard, ASSET_KINDS, label } from "../calc.js";
import {
    esc, money, signedMoney, pct, signedPct, cssPct, today, monthOf, isMonth, shiftMonth,
    fmtMonthLong, fmtMonthName, fmtMonthShort, fmtDay, fmtDayNoYear, fmtMonthYearShort, initials, timeAgo, plural,
} from "../util.js";
import { donutHtml, bindDonuts, openSheet } from "../ui.js";
import { navigate, refreshQuotesIfStale } from "../app.js";
import * as quotes from "../quotes.js";

const pill = (level) => (level === "high" ? "loss" : level === "mid" ? "warn" : "gain");

export function overviewView({ el, query }) {
    const day = today();
    const month = isMonth(query.m) ? query.m : monthOf(day);
    const data = store.snapshot();
    const d = dashboard(data, month, day);
    const go = (m) => `#/?m=${m}`;
    const monthName = fmtMonthName(month);
    const debt = d.debt;
    const folio = d.portfolio;
    const firstRun = !data.transactions.length && !data.categories.length && !data.cards.length;

    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Overview</h1>
            <p class="muted">Here’s where your money stands.</p>
        </div>
        <div class="month-switch" aria-label="Choose month">
            <a href="${go(shiftMonth(month, -1))}" aria-label="Previous month"><svg width="18" height="18"><use href="#i-left"/></svg></a>
            <select class="month-select" aria-label="Jump to month" data-month-select>
                ${d.monthOptions.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${esc(fmtMonthLong(m))}</option>`).join("")}
            </select>
            <a href="${go(shiftMonth(month, 1))}" aria-label="Next month"><svg width="18" height="18"><use href="#i-right"/></svg></a>
            ${d.isCurrentMonth ? "" : `<a href="#/" class="btn-small" style="width:auto;padding:0 10px" title="Back to this month">Today</a>`}
        </div>
    </div>

    ${firstRun ? `
    <section class="card empty-hero" style="margin-bottom:16px">
        <h2>Welcome! Let’s bring your data in.</h2>
        <p class="muted">Import the JSON backup from the old web app, or start fresh with starter categories.</p>
        <div class="form-actions"><a class="btn" href="#/settings">Import or start fresh</a></div>
    </section>` : ""}

    <div class="grid grid-4">
        <section class="card stat">
            <div class="stat-label">Spent in ${esc(monthName)}</div>
            <div class="stat-value">${money(d.monthTotal)}</div>
            <div class="stat-sub">${d.changePct !== null
                ? `<span class="pill ${d.changePct > 0 ? "up" : "down"}">${signedPct(d.changePct, 0)}</span> vs ${esc(fmtMonthShort(d.previousMonth))}`
                : plural(d.monthCount, "transaction")}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Net worth</div>
            <div class="stat-value ${d.netWorth < 0 ? "bad" : ""}">${money(d.netWorth, 0)}</div>
            <div class="stat-sub">Assets − debt</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Total debt</div>
            <div class="stat-value">${money(debt.totalDebt, 0)}</div>
            <div class="stat-sub">${debt.cards.length
                ? `<span class="pill ${pill(debt.utilizationLevel)}">${pct(debt.utilization, 0)}</span> card utilization`
                : "Cards &amp; loans"}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Assets</div>
            <div class="stat-value">${d.hasInvestments || d.assets.length ? money(d.totalAssets, 0) : "—"}</div>
            <div class="stat-sub">${d.assets.length ? `Property ${money(d.assetsValue, 0)} · Investments ${money(d.investmentsValue, 0)}`
                : folio.gainLoss !== null && folio.holdings.length ? `<span class="pill ${folio.gainLoss >= 0 ? "gain" : "loss"}">${signedPct(folio.gainPct)}</span> investments all-time`
                : d.hasInvestments ? "Awaiting prices" : "Not set up"}</div>
        </section>
    </div>

    <div class="grid grid-main" style="margin-top:16px">
        <div class="stack">
            <section class="card">
                <div class="card-head">
                    <h2>Spending by category</h2>
                    <a href="#/activity" data-see-all>See all</a>
                </div>
                ${d.monthTotal ? `
                <div class="donut-wrap">
                    ${donutHtml(d.donut, { centerValue: money(d.monthTotal, 0), centerLabel: `${d.monthCount} items`, label: "Spending by category", openPrefix: "cat:" })}
                    <div>
                        ${d.categoryTotals.filter((r) => r.spent).map((r) => `
                        <button type="button" class="row" style="display:block;padding:0" data-open="cat:${esc(r.category.id)}" aria-haspopup="dialog">
                            <div class="cat-row">
                                <span class="cat-name"><span class="swatch" style="background:${r.color}"></span><span>${esc(r.category.name)}</span></span>
                                <span class="num"><strong>${money(r.spent)}</strong> <span class="faint small">${pct(r.share, 0)}</span></span>
                                <div class="bar"><span style="width:${cssPct(d.largest ? (r.spent / d.largest) * 100 : 0)}%;background:${r.color}"></span></div>
                            </div>
                        </button>`).join("")}
                    </div>
                </div>
                <p class="faint small" style="margin:12px 0 0">Hover a slice to see the category; tap it (or a row) for subcategories and 12-month history.</p>
                ` : d.hasCategories
                    ? `<div class="empty"><strong>No spending in ${esc(fmtMonthLong(month))}</strong>Add a transaction to see it here.</div>`
                    : `<div class="empty"><strong>No categories yet</strong><a href="#/settings">Create your categories</a> to get started.</div>`}
            </section>

            <section class="card">
                <div class="card-head">
                    <h2>Monthly trend</h2>
                    <span class="muted small">12-month average ${money(d.averageMonth, 0)}</span>
                </div>
                <div class="trend" role="img" aria-label="Total spending for each of the last 12 months.">
                    ${d.trend.map((t) => `
                    <a href="${go(t.month)}" class="${t.selected ? "selected" : ""}" title="${esc(fmtMonthLong(t.month))}: ${esc(money(t.total))}">
                        <span class="col" style="height:${cssPct(t.height)}%"></span>
                        <span>${esc(fmtMonthShort(t.month)[0])}</span>
                    </a>`).join("")}
                </div>
            </section>

            ${budgetCard(d, month, monthName)}
        </div>

        <div class="stack">
            <section class="card">
                <div class="card-head">
                    <h2>Recently added</h2>
                    <a href="#/activity">All activity</a>
                </div>
                <ul class="list">
                ${d.recent.map((t) => {
                    const category = store.get("categories", t.categoryId);
                    const sub = store.get("subcategories", t.subcategoryId);
                    return `
                    <li class="row">
                        <span class="dot" style="background:${d.colors.get(t.categoryId) || "var(--accent)"}" aria-hidden="true">${esc(initials(category?.name || "?"))}</span>
                        <div class="row-main">
                            <div class="row-title">${esc(t.description)}</div>
                            <div class="row-sub">${esc(fmtDayNoYear(t.date))} · ${esc(category?.name || "Uncategorized")}${sub ? ` / ${esc(sub.name)}` : ""}</div>
                        </div>
                        <div class="row-end row-amount">${money(t.amountCents)}</div>
                    </li>`;
                }).join("") || `<li class="empty"><strong>Nothing yet</strong><a href="#/add">Add your first transaction</a></li>`}
                </ul>
            </section>

            <section class="card">
                <div class="card-head">
                    <h2>Debt</h2>
                    <a href="#/cards">Manage</a>
                </div>
                ${debt.hasAccounts ? `
                    ${debt.cards.length ? `
                    <div class="row">
                        <div class="row-main">
                            <div class="row-title">Credit cards</div>
                            <div class="row-sub">${money(debt.totalAvailable, 0)} available of ${money(debt.totalLimit, 0)}</div>
                        </div>
                        <div class="row-end row-amount">${money(debt.totalUsed)}</div>
                    </div>
                    <div class="bar thick" style="margin:2px 0 8px"><span class="${debt.utilizationLevel}" style="width:${cssPct(debt.utilization)}%"></span></div>` : ""}
                    ${debt.loans.map((item) => `
                    <a class="row" href="#/loan/${encodeURIComponent(item.loan.id)}" style="color:inherit;text-decoration:none">
                        <div class="row-main">
                            <div class="row-title">${esc(item.loan.name)}</div>
                            <div class="row-sub">${pct(item.paidPct, 0)} paid off · ${(item.loan.aprMilli / 1000).toFixed(2)}% APR</div>
                        </div>
                        <div class="row-end row-amount">${money(item.balance)}</div>
                    </a>`).join("")}
                ` : `<div class="empty"><strong>No debt tracked</strong><a href="#/card/new">Add a card</a> or <a href="#/loan/new">a loan</a>.</div>`}
            </section>

            <section class="card">
                <div class="card-head">
                    <h2>Assets</h2>
                    <a href="#/assets">Details</a>
                </div>
                ${d.assets.map((a) => `
                    <div class="row">
                        <div class="row-main"><div class="row-title">${esc(a.name)}</div>
                            <div class="row-sub">${esc(label(ASSET_KINDS, a.kind))} · value as of ${esc(fmtDay(a.valueDate))}</div></div>
                        <div class="row-end row-amount">${money(a.valueCents)}</div>
                    </div>`).join("")}
                ${d.hasInvestments ? `
                    <div class="row">
                        <div class="row-main"><div class="row-title">Portfolio value</div>
                            <div class="row-sub">${folio.lastChecked ? `Prices updated ${esc(timeAgo(folio.lastChecked))}` : "Prices not loaded yet"}</div></div>
                        <div class="row-end row-amount">${money(d.investmentsValue)}</div>
                    </div>
                    ${folio.gainLoss !== null ? `
                    <div class="row">
                        <div class="row-main"><div class="row-title">Unrealized gain/loss</div></div>
                        <div class="row-end row-amount ${folio.gainLoss >= 0 ? "good" : "bad"}">${signedMoney(folio.gainLoss)}</div>
                    </div>` : ""}
                    ${folio.holdings.length && !quotes.apiKey() ? `<p class="notice small" style="margin:10px 0 0">Live prices are off. <a href="#/finnhub">Add your free Finnhub key</a>.</p>` : ""}
                ` : !d.assets.length ? `<div class="empty"><strong>No assets yet</strong><a href="#/asset/new">Add your car or home</a> or <a href="#/stock/new">a holding</a></div>` : ""}
            </section>
        </div>
    </div>`;

    el.querySelector("[data-month-select]").addEventListener("change", (e) => navigate(`/?m=${e.target.value}`));
    el.querySelector("[data-see-all]").addEventListener("click", (e) => {
        e.preventDefault();
        import("./activity.js").then(({ setActivityFilters }) => {
            setActivityFilters({ from: `${month}-01`, to: d.monthEnd });
            navigate("/activity");
        });
    });
    el.querySelectorAll("[data-open^='cat:']").forEach((node) => node.addEventListener("click", () => {
        const row = d.categoryTotals.find((r) => r.category.id === node.dataset.open.slice(4));
        if (row) openCategory(row, month);
    }));
    bindDonuts(el);
    if (folio.needsRefresh) refreshQuotesIfStale();
}

function budgetCard(d, month, monthName) {
    const b = d.budget;
    const editHref = `#/budget?m=${month}`;
    if (!b) {
        return `
        <section class="card" id="budget">
            <div class="card-head"><h2>Budget · ${esc(monthName)}</h2><a href="${editHref}">Set budget</a></div>
            <div class="empty"><strong>No budget for ${esc(fmtMonthLong(month))}</strong>Set an overall limit and type the budget lines you care about.
                <a href="${editHref}">Set budget</a> · <a href="${editHref}&copy=1">copy last budget</a></div>
        </section>`;
    }
    return `
    <section class="card" id="budget">
        <div class="card-head"><h2>Budget · ${esc(monthName)}</h2><a href="${editHref}">Edit</a></div>
        <div class="budget-top">
            <div>
                <div class="stat-value ${b.level === "high" ? "bad" : ""}">${money(b.spent)}</div>
                <div class="muted small">of ${money(b.overall)}${b.overallIsSum ? " (sum of budget lines)" : ""}</div>
            </div>
            <div style="text-align:right">
                ${b.remaining >= 0
                    ? `<div class="row-amount good">${money(b.remaining)} left</div>
                       ${b.perDayLeft ? `<div class="muted small">≈ ${money(Math.round(b.perDayLeft))}/day for ${plural(b.daysLeft, "day")}</div>` : ""}`
                    : `<div class="row-amount bad">${signedMoney(b.remaining)} over</div>`}
            </div>
        </div>
        <div class="bar thick budget-bar" style="margin:12px 0 4px">
            <span class="${b.level}" style="width:${cssPct(b.pct)}%"></span>
            ${b.inProgress ? `<i class="pace" style="left:${cssPct(b.elapsedPct)}%" title="Where you'd be at an even pace"></i>` : ""}
        </div>
        <p class="muted small" style="margin:0 0 6px">
            ${pct(b.pct, 0)} used${b.inProgress ? ` · ${pct(b.elapsedPct, 0)} of the month gone ·
            ${b.ahead > 0 ? `<span class="bad">${money(Math.round(b.ahead), 0)} ahead of pace</span>` : `<span class="good">on track</span>`}` : ""}
        </p>
        ${b.rows.map((r) => `
        <div class="cat-row">
            <span class="cat-name"><span class="swatch" style="background:${r.color}"></span><span>${esc(r.name)}</span></span>
            <span class="num"><strong class="${r.level === "high" ? "bad" : ""}">${money(r.spent, 0)}</strong> <span class="faint small">/ ${money(r.budget, 0)}</span></span>
            <div class="bar"><span class="${r.level}" style="width:${cssPct(r.pct)}%"></span></div>
            ${r.matched ? "" : `<span class="faint small" style="grid-column:1/-1">No transactions match “${esc(r.name)}” yet</span>`}
        </div>`).join("")}
        ${b.rows.length && b.unbudgeted ? `<p class="faint small" style="margin:8px 0 0">${money(b.unbudgeted)} spent on things not in a budget line.</p>` : ""}
    </section>`;
}

function openCategory(row, month) {
    const c = row.category;
    openSheet(`<span class="swatch" style="background:${row.color}"></span> ${esc(c.name)}`, `
        <p class="muted">${esc(fmtMonthLong(month))} · ${money(row.spent)}</p>
        ${row.spent ? `
        <div class="donut-wrap" style="margin-bottom:16px">
            ${donutHtml(row.donut, { centerValue: money(row.spent, 0), centerLabel: "this month", label: c.name })}
            <div>
                ${row.monthlyRows.filter((r) => r.total).map((r) => `
                <div class="cat-row">
                    <span class="cat-name"><span class="swatch" style="background:${r.color}"></span><span>${esc(r.name)}</span></span>
                    <span class="num"><strong>${money(r.total)}</strong> <span class="faint small">${pct(r.share, 0)}</span></span>
                </div>`).join("")}
            </div>
        </div>` : ""}
        <h3 style="margin:8px 0">Last 12 months</h3>
        ${row.historyRows.map((r) => `
        <div class="hist-row">
            <span class="muted">${esc(fmtMonthYearShort(r.month))}</span>
            <div class="bar"><span style="width:${cssPct(row.historyMax ? (r.total / row.historyMax) * 100 : 0)}%;background:${row.color}"></span></div>
            <strong>${money(r.total)}</strong>
        </div>`).join("")}
        <div class="row" style="margin-top:6px"><strong class="row-main">12-month total</strong><strong class="num">${money(row.historyTotal)}</strong></div>
        <div class="form-actions">
            <button type="button" class="btn btn-secondary" data-view-tx>View transactions</button>
        </div>`, (body) => {
        body.querySelector("[data-view-tx]").addEventListener("click", () => {
            import("./activity.js").then(({ setActivityFilters }) => {
                setActivityFilters({ category: c.id });
                navigate("/activity");
            });
        });
    });
}
