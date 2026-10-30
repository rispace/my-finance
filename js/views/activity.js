// Transactions list (transactions.html) and Add / Edit (add_transaction.html).

import * as store from "../store.js";
import { SORTS, filterTransactions, sortTransactions, groupTransactions, categoryColors } from "../calc.js";
import {
    esc, money, today, fmtDay, fmtDayFull, fmtDateTime, initials, byName, newId, centsToInput, toCents, isDay, plural, monthOf,
} from "../util.js";
import { openSheet, closeSheet, toast, confirmAction } from "../ui.js";
import { navigate } from "../app.js";
import { transactionsCsv, saveFile } from "../csv.js";

const PAGE = 30;
const filters = { q: "", category: "", subcategory: "", account: "", from: "", to: "", sort: "added" };
let shown = PAGE;

/** Used by Overview's "See all" and category sheets. */
export function setActivityFilters(values) {
    Object.assign(filters, { q: "", category: "", subcategory: "", account: "", from: "", to: "" }, values);
    shown = PAGE;
}

const activeCount = () => ["q", "category", "subcategory", "account", "from", "to"].filter((k) => filters[k]).length;

export function lookups() {
    return {
        category: (id) => store.get("categories", id)?.name || "Uncategorized",
        subcategory: (id) => store.get("subcategories", id)?.name || "",
        account: (id) => store.get("accounts", id)?.name || "",
    };
}

export function activityView({ el, rerender }) {
    const data = store.snapshot();
    const categories = [...data.categories].sort(byName);
    const subcategories = data.subcategories.filter((s) => s.categoryId === filters.category).sort(byName);
    const accounts = [...data.accounts].sort((a, b) => (a.archived - b.archived) || byName(a, b));
    if (filters.subcategory && !subcategories.some((s) => s.id === filters.subcategory)) filters.subcategory = "";
    const badRange = filters.from && filters.to && filters.from > filters.to;

    const matching = badRange ? [] : sortTransactions(filterTransactions(data.transactions, filters), filters.sort);
    const total = matching.reduce((s, t) => s + t.amountCents, 0);
    const page = matching.slice(0, shown);
    const groups = groupTransactions(page, filters.sort, today());
    const colors = categoryColors(data.categories);
    const name = lookups();
    const dateSorted = filters.sort === "date_desc" || filters.sort === "date_asc";

    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Transactions</h1>
            <p class="muted">${matching.length} matching · total <strong class="num">${money(total)}</strong></p>
        </div>
        <div class="page-actions">
            <button type="button" class="btn btn-secondary" data-export>Export CSV</button>
            <a class="btn" href="#/add"><svg><use href="#i-plus"/></svg>Add</a>
        </div>
    </div>

    <section class="card">
        <form class="filters" data-filters>
            <div class="field search"><label for="q">Search</label><input type="search" id="q" name="q" placeholder="Search description or notes" value="${esc(filters.q)}"></div>
            <div class="field"><label for="fc">Category</label><select id="fc" name="category"><option value="">All categories</option>
                ${categories.map((c) => `<option value="${esc(c.id)}" ${c.id === filters.category ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
            <div class="field"><label for="fs">Subcategory</label><select id="fs" name="subcategory" ${filters.category ? "" : "disabled"}><option value="">All subcategories</option>
                ${subcategories.map((s) => `<option value="${esc(s.id)}" ${s.id === filters.subcategory ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
            <div class="field"><label for="fa">Paid with</label><select id="fa" name="account"><option value="">All payment methods</option>
                ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === filters.account ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
            <div class="field"><label for="ff">From</label><input type="date" id="ff" name="from" value="${esc(filters.from)}"></div>
            <div class="field"><label for="ft">To</label><input type="date" id="ft" name="to" value="${esc(filters.to)}">
                ${badRange ? `<ul class="errorlist"><li>“To” must be on or after “From”.</li></ul>` : ""}</div>
            <div class="form-actions" style="grid-column:1/-1;margin:0">
                ${activeCount() ? `<button type="button" class="btn btn-ghost" data-clear>Clear filters</button>` : ""}
                <label class="sort-label" for="sort">Sort</label>
                <select name="sort" id="sort" class="sort-select">
                    ${SORTS.map(([v, l]) => `<option value="${v}" ${v === filters.sort ? "selected" : ""}>${esc(l)}</option>`).join("")}
                </select>
            </div>
        </form>
    </section>

    <section class="card">
        ${groups.map((g) => `
        <div class="day-group">
            ${g.title ? `<div class="day-head"><span>${esc(g.title)}</span><span class="num">${money(g.total)}</span></div>` : ""}
            ${g.items.map((t) => `
            <button type="button" class="row" data-tx="${esc(t.id)}" aria-haspopup="dialog">
                <span class="dot" style="background:${colors.get(t.categoryId) || "var(--accent)"}" aria-hidden="true">${esc(initials(name.category(t.categoryId)))}</span>
                <span class="row-main">
                    <span class="row-title" style="display:block">${esc(t.description)}</span>
                    <span class="row-sub" style="display:block">${dateSorted ? "" : `${esc(fmtDay(t.date))} · `}${esc(name.category(t.categoryId))}${t.subcategoryId ? ` / ${esc(name.subcategory(t.subcategoryId))}` : ""} · ${esc(name.account(t.accountId) || "—")}${t.notes ? ` · ${esc(t.notes)}` : ""}</span>
                </span>
                <span class="row-end row-amount">${money(t.amountCents)}</span>
            </button>`).join("")}
        </div>`).join("") || `
        <div class="empty">
            <strong>No transactions match</strong>
            ${activeCount() ? `<button type="button" class="link" data-clear>Clear filters</button>` : `<a href="#/add">Add your first one</a> or <a href="#/import-csv">import a CSV</a>.`}
        </div>`}
        ${matching.length > page.length ? `<div class="show-more"><button type="button" class="btn btn-secondary btn-small" data-more>Show ${Math.min(PAGE, matching.length - page.length)} more (${matching.length - page.length} left)</button></div>` : ""}
    </section>`;

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
            const q = el.querySelector("#q");
            q.focus();
            q.setSelectionRange(pos, pos);
        }, 200);
    });
    form.addEventListener("change", (e) => {
        if (e.target.name === "q") return;
        filters[e.target.name] = e.target.value;
        if (e.target.name === "category") filters.subcategory = "";
        shown = PAGE;
        rerender();
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    el.querySelectorAll("[data-clear]").forEach((b) => b.addEventListener("click", () => { setActivityFilters({ sort: filters.sort }); rerender(); }));
    el.querySelector("[data-more]")?.addEventListener("click", () => { shown += PAGE; rerender(); });
    el.querySelectorAll("[data-tx]").forEach((b) => b.addEventListener("click", () => openTransaction(b.dataset.tx, rerender)));
    el.querySelector("[data-export]").addEventListener("click", () => {
        saveFile(`expenses-${today()}.csv`, transactionsCsv(matching, name));
    });
}

function openTransaction(id, rerender) {
    const t = store.get("transactions", id);
    if (!t) return;
    const name = lookups();
    openSheet(esc(t.description), `
        <div class="stat-value" style="margin-bottom:10px">${money(t.amountCents)}</div>
        <dl class="detail-list">
            <dt>Date</dt><dd>${esc(fmtDayFull(t.date))}</dd>
            <dt>Category</dt><dd>${esc(name.category(t.categoryId))}${t.subcategoryId ? ` / ${esc(name.subcategory(t.subcategoryId))}` : ""}</dd>
            <dt>Paid with</dt><dd>${esc(name.account(t.accountId) || "—")}</dd>
            <dt>Notes</dt><dd>${esc(t.notes || "—")}</dd>
            <dt>Added</dt><dd>${esc(fmtDateTime(t.createdAt))}</dd>
        </dl>
        <div class="form-actions" style="margin-top:16px">
            <a class="btn" href="#/tx/${encodeURIComponent(id)}">Edit</a>
            <button type="button" class="btn btn-secondary" data-delete>Delete</button>
        </div>`, (body) => {
        body.querySelector("[data-delete]").addEventListener("click", async () => {
            if (!confirmAction(`Delete “${t.description}” (${money(t.amountCents)})? This can’t be undone.`)) return;
            await store.remove("transactions", id);
            closeSheet();
            toast("Transaction deleted.");
            rerender();
        });
    });
}

// ------------------------------------------------------------- add / edit

function suggestions(transactions) {
    const counts = new Map();
    for (const t of transactions) counts.set(t.description, (counts.get(t.description) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([d]) => d);
}

function lastAccountId(transactions) {
    const last = [...transactions].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];
    return last?.accountId || "";
}

export function transactionFormView({ el, params, query = {} }) {
    // Opened from another screen (e.g. a category on Overview)? Go back there afterwards.
    const back = typeof query.back === "string" && query.back.startsWith("/") ? query.back : "/activity";
    const data = store.snapshot();
    const editing = params.id ? store.get("transactions", params.id) : null;
    if (params.id && !editing) {
        el.innerHTML = `<section class="card"><div class="empty"><strong>That transaction no longer exists</strong><a href="#/activity">Back to transactions</a></div></section>`;
        return;
    }
    const t = editing || { date: today(), accountId: lastAccountId(data.transactions), categoryId: "", subcategoryId: "", notes: "", description: "" };
    const categories = [...data.categories].sort(byName);
    // Archived methods are hidden, except on transactions that already use them.
    const accounts = [...data.accounts].sort(byName).filter((a) => !a.archived || a.id === t.accountId);

    el.innerHTML = `
    <section class="card form-card">
        <div class="card-head">
            <h1 style="font-size:22px">${editing ? "Edit transaction" : "Add transaction"}</h1>
            ${editing ? `<button type="button" class="btn btn-ghost btn-small" style="color:var(--danger)" data-delete>Delete</button>` : ""}
        </div>
        ${categories.length ? "" : `<div class="notice">You don’t have any categories yet. <a href="#/category/new">Create one</a> first, or <a href="#/settings">import your backup</a>.</div>`}
        <form novalidate data-form>
            <ul class="errorlist nonfield" data-error-for="__all__" hidden></ul>
            <div class="field">
                <label for="f-amount">Amount (USD)</label>
                <input id="f-amount" class="amount-input" inputmode="decimal" placeholder="0.00" autocomplete="off" value="${editing ? centsToInput(t.amountCents) : ""}">
                <ul class="errorlist" data-error-for="amount"></ul>
            </div>
            <div class="field">
                <label for="f-description">Description</label>
                <input id="f-description" list="description-suggestions" placeholder="e.g. Weekly groceries" autocomplete="off" maxlength="200" value="${esc(t.description)}">
                <datalist id="description-suggestions">${suggestions(data.transactions).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
                <ul class="errorlist" data-error-for="description"></ul>
            </div>
            <div class="field-row">
                <div class="field">
                    <label for="f-category">Category</label>
                    <select id="f-category"><option value="">Choose a category</option>
                        ${categories.map((c) => `<option value="${esc(c.id)}" ${c.id === t.categoryId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                    </select>
                    <ul class="errorlist" data-error-for="category"></ul>
                </div>
                <div class="field">
                    <label for="f-subcategory">Subcategory</label>
                    <select id="f-subcategory"></select>
                </div>
            </div>
            <div class="field-row">
                <div class="field">
                    <label for="f-date">Date</label>
                    <input id="f-date" type="date" value="${esc(t.date)}">
                    <ul class="errorlist" data-error-for="date"></ul>
                </div>
                <div class="field">
                    <label for="f-account">Paid with</label>
                    <select id="f-account"><option value="">Not specified</option>
                        ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === t.accountId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
                    </select>
                    <p class="help"><a href="#/settings">Manage payment methods</a></p>
                </div>
            </div>
            <div class="field">
                <label for="f-notes">Notes</label>
                <textarea id="f-notes" rows="2" placeholder="Optional">${esc(t.notes || "")}</textarea>
            </div>
            <div class="form-actions">
                ${editing
                    ? `<button type="submit" class="btn" data-then="list">Save changes</button>
                       <a class="btn btn-ghost" href="#${esc(back)}">Cancel</a>`
                    : `<button type="submit" class="btn" data-then="add">Save &amp; add another</button>
                       <button type="submit" class="btn btn-secondary" data-then="list">Save &amp; view list</button>`}
            </div>
        </form>
    </section>`;

    const form = el.querySelector("[data-form]");
    const $ = (id) => form.querySelector(id);
    const category = $("#f-category");
    const sub = $("#f-subcategory");
    const fillSubs = (selected) => {
        const subs = data.subcategories.filter((s) => s.categoryId === category.value).sort(byName);
        sub.innerHTML = `<option value="">${category.value ? "---------" : "Choose a category first"}</option>` +
            subs.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
        sub.disabled = !category.value;
    };
    fillSubs(t.subcategoryId);
    category.addEventListener("change", () => fillSubs(""));

    let then = "add";
    form.querySelectorAll("[data-then]").forEach((b) => b.addEventListener("click", () => { then = b.dataset.then; }));
    el.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!confirmAction(`Delete “${editing.description}” (${money(editing.amountCents)})? This can’t be undone.`)) return;
        await store.remove("transactions", editing.id);
        toast("Transaction deleted.");
        navigate(back);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const errors = {};
        const amountCents = toCents($("#f-amount").value);
        const description = $("#f-description").value.trim();
        const date = $("#f-date").value;
        if ($("#f-amount").value.trim() === "") errors.amount = "This field is required.";
        else if (amountCents === null) errors.amount = "Enter a number.";
        else if (amountCents < 1) errors.amount = "Ensure this value is greater than or equal to 0.01.";
        if (!description) errors.description = "This field is required.";
        if (!category.value) errors.category = "This field is required.";
        if (!isDay(date)) errors.date = "Enter a valid date.";
        form.querySelectorAll("[data-error-for]").forEach((ul) => { ul.innerHTML = errors[ul.dataset.errorFor] ? `<li>${esc(errors[ul.dataset.errorFor])}</li>` : ""; });
        if (Object.keys(errors).length) return;

        const record = {
            ...(editing || { id: newId(), createdAt: new Date().toISOString() }),
            date, description, amountCents,
            categoryId: category.value,
            subcategoryId: sub.value || null,
            accountId: $("#f-account").value || null,
            notes: $("#f-notes").value.trim(),
        };
        await store.save("transactions", record);
        if (editing) {
            toast("Transaction updated.");
            navigate(back);
        } else {
            toast(`Saved ${money(amountCents)} · ${description}.`);
            if (then === "list") navigate("/activity");
            else {
                transactionFormView({ el, params: {} });
                el.querySelector("#f-amount").focus();
            }
        }
    });

    if (!editing && matchMedia("(pointer: fine)").matches) $("#f-amount").focus({ preventScroll: true });
}

