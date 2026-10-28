// Earnings: monthly income with a 12-month earned-vs-spent chart, a
// breakdown by type, and a filterable, sortable, exportable list.

import * as store from "../store.js";
import {
    earningsSummary, filterEarnings, sortTransactions, groupTransactions, EARNING_TYPES, EARNING_COLORS, label, SORTS,
} from "../calc.js";
import {
    esc, money, signedMoney, pct, signedPct, cssPct, today, monthOf, isMonth, isDay, shiftMonth, toCents, centsToInput,
    fmtMonthLong, fmtMonthName, fmtMonthShort, fmtDay, fmtDayFull, fmtDateTime, byName, newId, plural,
} from "../util.js";
import { openSheet, closeSheet, toast, confirmAction } from "../ui.js";
import { navigate } from "../app.js";
import { earningsCsv, buildEarningsCsvImport, saveFile } from "../csv.js";

const PAGE = 30;
const filters = { q: "", type: "", account: "", sort: "date_desc", allTime: false };
let shown = PAGE;

const typeName = (key) => label(EARNING_TYPES, key || "other");
const accountName = (id) => store.get("accounts", id)?.name || "";

export function earningsView({ el, query, rerender }) {
    const day = today();
    const month = isMonth(query.m) ? query.m : monthOf(day);
    const data = store.snapshot();
    const s = earningsSummary(data, month, day);
    const accounts = [...data.accounts].sort((a, b) => (a.archived - b.archived) || byName(a, b));
    const range = filters.allTime ? {} : { from: `${month}-01`, to: s.monthEnd };
    const matching = sortTransactions(filterEarnings(data.earnings, { ...filters, ...range }), filters.sort);
    const total = matching.reduce((t, e) => t + e.amountCents, 0);
    const groups = groupTransactions(matching.slice(0, shown), filters.sort, day);
    const go = (m) => `#/earnings?m=${m}`;
    const firstTime = !data.earnings.length;

    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Earnings</h1>
            <p class="muted">Money coming in, and what’s left after spending.</p>
        </div>
        <div class="month-switch" aria-label="Choose month">
            <a href="${go(shiftMonth(month, -1))}" aria-label="Previous month"><svg width="18" height="18"><use href="#i-left"/></svg></a>
            <select class="month-select" aria-label="Jump to month" data-month-select>
                ${s.monthOptions.map((m) => `<option value="${m}" ${m === month ? "selected" : ""}>${esc(fmtMonthLong(m))}</option>`).join("")}
            </select>
            <a href="${go(shiftMonth(month, 1))}" aria-label="Next month"><svg width="18" height="18"><use href="#i-right"/></svg></a>
            ${s.isCurrentMonth ? "" : `<a href="#/earnings" class="btn-small" style="width:auto;padding:0 10px">Today</a>`}
        </div>
    </div>

    ${firstTime ? `
    <section class="card empty-hero" style="margin-bottom:16px">
        <h2>Track what you earn</h2>
        <p class="muted">Add paychecks, side income, interest or refunds. You’ll see monthly totals, how much you saved, and a 12-month picture next to your spending.</p>
        <div class="form-actions"><a class="btn" href="#/earning/new">Add your first earning</a>
            <a class="btn btn-secondary" href="#/import-earnings">Import a CSV</a></div>
    </section>` : ""}

    <div class="grid grid-4">
        <section class="card stat">
            <div class="stat-label">Earned in ${esc(fmtMonthName(month))}</div>
            <div class="stat-value good">${money(s.monthTotal)}</div>
            <div class="stat-sub">${s.changePct !== null
                ? `<span class="pill ${s.changePct >= 0 ? "gain" : "loss"}">${signedPct(s.changePct, 0)}</span> vs ${esc(fmtMonthShort(s.previousMonth))}`
                : plural(s.monthCount, "deposit")}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Saved in ${esc(fmtMonthName(month))}</div>
            <div class="stat-value ${s.saved < 0 ? "bad" : ""}">${signedMoney(s.saved)}</div>
            <div class="stat-sub">${s.savingsRate !== null ? `<span class="pill ${s.saved >= 0 ? "gain" : "loss"}">${pct(s.savingsRate, 0)}</span> savings rate` : `Spent ${money(s.spent)}`}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">${esc(month.slice(0, 4))} so far</div>
            <div class="stat-value">${money(s.yearToDate, 0)}</div>
            <div class="stat-sub">Through ${esc(fmtMonthShort(month))}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Monthly average</div>
            <div class="stat-value">${money(s.averageMonth, 0)}</div>
            <div class="stat-sub">Months with earnings, last 12</div>
        </section>
    </div>

    <div class="grid grid-main" style="margin-top:16px">
        <section class="card">
            <div class="card-head">
                <h2>Earned vs spent</h2>
                <span class="legend small"><span><i class="swatch" style="background:var(--accent)"></i>Earned</span><span><i class="swatch" style="background:#d08a2c"></i>Spent</span></span>
            </div>
            <div class="trend dual" role="img" aria-label="Earned and spent for each of the last 12 months.">
                ${s.trend.map((t) => `
                <a href="${go(t.month)}" class="${t.selected ? "selected" : ""}" title="${esc(fmtMonthLong(t.month))}: earned ${esc(money(t.earned))}, spent ${esc(money(t.spent))}, ${t.saved >= 0 ? "saved" : "overspent"} ${esc(money(Math.abs(t.saved)))}">
                    <span class="pair"><span class="col earned" style="height:${cssPct(t.earnedHeight)}%"></span><span class="col spent" style="height:${cssPct(t.spentHeight)}%"></span></span>
                    <span>${esc(fmtMonthShort(t.month)[0])}</span>
                </a>`).join("")}
            </div>
        </section>
        <section class="card">
            <div class="card-head"><h2>By type · ${esc(fmtMonthName(month))}</h2></div>
            ${s.byType.length ? s.byType.map((r) => `
            <div class="cat-row">
                <span class="cat-name"><span class="swatch" style="background:${r.color}"></span><span>${esc(r.name)}</span></span>
                <span class="num"><strong>${money(r.total)}</strong> <span class="faint small">${pct(r.share, 0)}</span></span>
                <div class="bar"><span style="width:${cssPct(r.share)}%;background:${r.color}"></span></div>
            </div>`).join("") : `<div class="empty"><strong>Nothing earned in ${esc(fmtMonthLong(month))}</strong><a href="#/earning/new">Add an earning</a></div>`}
        </section>
    </div>

    <section class="card" style="margin-top:16px">
        <div class="card-head">
            <h2>${filters.allTime ? "All earnings" : `Earnings in ${esc(fmtMonthLong(month))}`}</h2>
            <span class="cc-actions">
                <button type="button" class="btn btn-secondary btn-small" data-export>Export CSV</button>
                <a class="btn btn-small" href="#/earning/new"><svg width="16" height="16"><use href="#i-plus"/></svg>Add</a>
            </span>
        </div>
        <form class="filters earnings-filters" data-filters>
            <div class="field search"><label for="eq">Search</label><input type="search" id="eq" name="q" placeholder="Search source or notes" value="${esc(filters.q)}"></div>
            <div class="field"><label for="et">Type</label><select id="et" name="type"><option value="">All types</option>
                ${EARNING_TYPES.map(([k, l]) => `<option value="${k}" ${k === filters.type ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
            <div class="field"><label for="ea">Deposited to</label><select id="ea" name="account"><option value="">All accounts</option>
                ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === filters.account ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
            <div class="field"><label for="es">Sort</label><select id="es" name="sort">
                ${SORTS.map(([v, l]) => `<option value="${v}" ${v === filters.sort ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
            <div class="form-actions" style="grid-column:1/-1;margin:0">
                <label class="checkbox-field small"><input type="checkbox" name="allTime" ${filters.allTime ? "checked" : ""}> All months</label>
                ${filters.q || filters.type || filters.account ? `<button type="button" class="btn btn-ghost btn-small" data-clear>Clear filters</button>` : ""}
                <span class="muted small" style="margin-left:auto">${plural(matching.length, "entry", "entries")} · <strong class="num">${money(total)}</strong></span>
            </div>
        </form>
        ${groups.map((g) => `
        <div class="day-group">
            ${g.title ? `<div class="day-head"><span>${esc(g.title)}</span><span class="num">${money(g.total)}</span></div>` : ""}
            ${g.items.map((e) => `
            <button type="button" class="row" data-earning="${esc(e.id)}" aria-haspopup="dialog">
                <span class="dot" style="background:${EARNING_COLORS[e.type] || EARNING_COLORS.other}" aria-hidden="true">+</span>
                <span class="row-main">
                    <span class="row-title" style="display:block">${esc(e.description)}</span>
                    <span class="row-sub" style="display:block">${filters.sort === "date_desc" || filters.sort === "date_asc" ? "" : `${esc(fmtDay(e.date))} · `}${esc(typeName(e.type))}${e.accountId ? ` · ${esc(accountName(e.accountId))}` : ""}${e.notes ? ` · ${esc(e.notes)}` : ""}</span>
                </span>
                <span class="row-end row-amount good">${money(e.amountCents)}</span>
            </button>`).join("")}
        </div>`).join("") || `<div class="empty"><strong>No earnings match</strong>${firstTime ? "" : `<button type="button" class="link" data-all>Show all months</button>`}</div>`}
        ${matching.length > shown ? `<div class="show-more"><button type="button" class="btn btn-secondary btn-small" data-more>Show more (${matching.length - shown} left)</button></div>` : ""}
    </section>`;

    el.querySelector("[data-month-select]").addEventListener("change", (e) => navigate(`/earnings?m=${e.target.value}`));
    const form = el.querySelector("[data-filters]");
    let typing;
    form.addEventListener("input", (e) => {
        if (e.target.name !== "q") return;
        clearTimeout(typing);
        typing = setTimeout(() => {
            filters.q = e.target.value;
            shown = PAGE;
            const pos = e.target.selectionStart;
            rerender();
            const q = el.querySelector("#eq");
            q.focus();
            q.setSelectionRange(pos, pos);
        }, 200);
    });
    form.addEventListener("change", (e) => {
        if (e.target.name === "q") return;
        filters[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
        shown = PAGE;
        rerender();
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    el.querySelector("[data-clear]")?.addEventListener("click", () => { Object.assign(filters, { q: "", type: "", account: "" }); rerender(); });
    el.querySelector("[data-all]")?.addEventListener("click", () => { filters.allTime = true; rerender(); });
    el.querySelector("[data-more]")?.addEventListener("click", () => { shown += PAGE; rerender(); });
    el.querySelector("[data-export]").addEventListener("click", () => saveFile(`earnings-${filters.allTime ? "all" : month}.csv`, earningsCsv(matching, typeName, accountName)));
    el.querySelectorAll("[data-earning]").forEach((b) => b.addEventListener("click", () => openEarning(b.dataset.earning, rerender)));
}

function openEarning(id, rerender) {
    const e = store.get("earnings", id);
    if (!e) return;
    openSheet(esc(e.description), `
        <div class="stat-value good" style="margin-bottom:10px">${money(e.amountCents)}</div>
        <dl class="detail-list">
            <dt>Date</dt><dd>${esc(fmtDayFull(e.date))}</dd>
            <dt>Type</dt><dd>${esc(typeName(e.type))}</dd>
            <dt>Deposited to</dt><dd>${esc(accountName(e.accountId) || "—")}</dd>
            <dt>Notes</dt><dd>${esc(e.notes || "—")}</dd>
            <dt>Added</dt><dd>${esc(fmtDateTime(e.createdAt))}</dd>
        </dl>
        <div class="form-actions" style="margin-top:16px">
            <a class="btn" href="#/earning/${encodeURIComponent(id)}">Edit</a>
            <button type="button" class="btn btn-secondary" data-duplicate>Add again</button>
            <button type="button" class="btn btn-secondary" data-delete>Delete</button>
        </div>`, (body) => {
        body.querySelector("[data-delete]").addEventListener("click", async () => {
            if (!confirmAction(`Delete “${e.description}” (${money(e.amountCents)})? This can’t be undone.`)) return;
            await store.remove("earnings", id);
            closeSheet();
            toast("Earning deleted.");
            rerender();
        });
        body.querySelector("[data-duplicate]").addEventListener("click", () => {
            closeSheet();
            navigate(`/earning/new?from=${encodeURIComponent(id)}`);
        });
    });
}

// ------------------------------------------------------------- add / edit

export function earningFormView({ el, params, query }) {
    const data = store.snapshot();
    const editing = params.id ? store.get("earnings", params.id) : null;
    if (params.id && !editing) {
        el.innerHTML = `<section class="card"><div class="empty"><strong>That earning no longer exists</strong><a href="#/earnings">Back to earnings</a></div></section>`;
        return;
    }
    // "Add again" pre-fills from an earlier entry (handy for paychecks).
    const template = query.from ? store.get("earnings", query.from) : null;
    const lastDeposit = [...data.earnings].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
    const e = editing || {
        date: today(), description: template?.description || "", type: template?.type || lastDeposit?.type || "salary",
        accountId: template?.accountId || lastDeposit?.accountId || "", notes: "", amountCents: template?.amountCents ?? null,
    };
    const accounts = [...data.accounts].sort(byName).filter((a) => !a.archived || a.id === e.accountId);
    const sources = [...new Set([...data.earnings].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map((x) => x.description))].slice(0, 40);

    el.innerHTML = `
    <section class="card form-card">
        <div class="card-head">
            <h1 style="font-size:22px">${editing ? "Edit earning" : "Add earning"}</h1>
            ${editing ? `<button type="button" class="btn btn-ghost btn-small" style="color:var(--danger)" data-delete>Delete</button>` : ""}
        </div>
        <form novalidate data-form>
            <div class="field">
                <label for="f-amount">Amount (USD)</label>
                <input id="f-amount" class="amount-input" inputmode="decimal" placeholder="0.00" autocomplete="off" value="${e.amountCents != null ? centsToInput(e.amountCents) : ""}">
                <ul class="errorlist" data-error-for="amount"></ul>
            </div>
            <div class="field">
                <label for="f-source">Source</label>
                <input id="f-source" list="source-suggestions" placeholder="e.g. Iowa State payroll" autocomplete="off" maxlength="200" value="${esc(e.description)}">
                <datalist id="source-suggestions">${sources.map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
                <ul class="errorlist" data-error-for="source"></ul>
            </div>
            <div class="field-row">
                <div class="field">
                    <label for="f-type">Type</label>
                    <select id="f-type">${EARNING_TYPES.map(([k, l]) => `<option value="${k}" ${k === e.type ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
                </div>
                <div class="field">
                    <label for="f-date">Date received</label>
                    <input id="f-date" type="date" value="${esc(e.date)}">
                    <ul class="errorlist" data-error-for="date"></ul>
                </div>
            </div>
            <div class="field">
                <label for="f-account">Deposited to</label>
                <select id="f-account"><option value="">Not specified</option>
                    ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === e.accountId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
                </select>
                <p class="help"><a href="#/settings">Manage accounts</a> (same list as payment methods)</p>
            </div>
            <div class="field">
                <label for="f-notes">Notes</label>
                <textarea id="f-notes" rows="2" placeholder="Optional, e.g. pay period">${esc(e.notes || "")}</textarea>
            </div>
            <div class="form-actions">
                ${editing
                    ? `<button type="submit" class="btn" data-then="list">Save changes</button><a class="btn btn-ghost" href="#/earnings">Cancel</a>`
                    : `<button type="submit" class="btn" data-then="add">Save &amp; add another</button>
                       <button type="submit" class="btn btn-secondary" data-then="list">Save &amp; view earnings</button>`}
            </div>
        </form>
    </section>`;

    const form = el.querySelector("[data-form]");
    const $ = (sel) => form.querySelector(sel);
    let then = "add";
    form.querySelectorAll("[data-then]").forEach((b) => b.addEventListener("click", () => { then = b.dataset.then; }));
    el.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!confirmAction(`Delete “${editing.description}” (${money(editing.amountCents)})?`)) return;
        await store.remove("earnings", editing.id);
        toast("Earning deleted.");
        navigate("/earnings");
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const errors = {};
        const amountCents = toCents($("#f-amount").value);
        const description = $("#f-source").value.trim();
        const date = $("#f-date").value;
        if ($("#f-amount").value.trim() === "") errors.amount = "This field is required.";
        else if (amountCents === null) errors.amount = "Enter a number.";
        else if (amountCents < 1) errors.amount = "Ensure this value is greater than or equal to 0.01.";
        if (!description) errors.source = "This field is required.";
        if (!isDay(date)) errors.date = "Enter a valid date.";
        form.querySelectorAll("[data-error-for]").forEach((ul) => { ul.innerHTML = errors[ul.dataset.errorFor] ? `<li>${esc(errors[ul.dataset.errorFor])}</li>` : ""; });
        if (Object.keys(errors).length) return;
        const record = {
            ...(editing || { id: newId(), createdAt: new Date().toISOString() }),
            date, description, amountCents, type: $("#f-type").value,
            accountId: $("#f-account").value || null, notes: $("#f-notes").value.trim(),
        };
        await store.save("earnings", record);
        if (editing || then === "list") {
            toast(editing ? "Earning updated." : `Saved ${money(amountCents)} · ${description}.`);
            navigate(`/earnings?m=${monthOf(date)}`);
        } else {
            toast(`Saved ${money(amountCents)} · ${description}.`);
            earningFormView({ el, params: {}, query: {} });
            el.querySelector("#f-amount").focus();
        }
    });
    if (!editing && matchMedia("(pointer: fine)").matches) $("#f-amount").focus({ preventScroll: true });
}

// ------------------------------------------------------------- CSV import

export function earningsImportView({ el }) {
    el.innerHTML = `
    <section class="card form-card">
        <h1 style="font-size:22px;margin-bottom:6px">Import earnings</h1>
        <p class="muted">Upload a CSV with the columns <strong>Date, Source, Amount (USD)</strong> and optionally <strong>Type, Deposited to, Notes</strong> — the same as this app’s earnings export. Dates must be YYYY-MM-DD.</p>
        <form novalidate data-form>
            <ul class="errorlist nonfield" data-errors hidden></ul>
            <div class="field"><label for="csv-file">CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv"></div>
            <div class="field"><div class="checkbox-field"><input type="checkbox" id="skip" checked><label for="skip">Skip rows that already exist (same date, source and amount)</label></div></div>
            <div class="form-actions"><button type="submit" class="btn">Import</button><a class="btn btn-ghost" href="#/earnings">Cancel</a></div>
        </form>
    </section>`;
    const form = el.querySelector("[data-form]");
    const box = el.querySelector("[data-errors]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const show = (msg) => { box.innerHTML = `<li>${esc(msg)}</li>`; box.hidden = false; };
        const file = el.querySelector("#csv-file").files[0];
        if (!file) return show("Choose a CSV file.");
        if (file.size > 5 * 1024 * 1024) return show("Please upload a file smaller than 5 MB.");
        const result = buildEarningsCsvImport(await file.text(), store.snapshot(), { skipDuplicates: el.querySelector("#skip").checked, newId, types: EARNING_TYPES });
        if (result.errors.length) return show(result.errors.slice(0, 8).join(" ") + " Nothing was imported.");
        await store.saveMany(result.changes);
        toast(`Imported ${plural(result.created, "earning")}; skipped ${plural(result.skipped, "duplicate")}.`);
        navigate("/earnings");
    });
}
