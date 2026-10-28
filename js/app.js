import * as db from "./db.js";
import * as auth from "./auth.js";
import * as drive from "./drive.js";
import { syncNow } from "./sync.js";
import { buildImport, buildStarter, toCents } from "./importer.js";

const APP_VERSION = "0.1.0 (proof of concept)";
const PALETTE = ["#2f6f4f", "#3b82c4", "#d08a2c", "#8b5cc6", "#cc5a4f", "#2a9d9b", "#c2558f", "#6b7a8f", "#7aa33b", "#b5793e"];
const SYNC_DELAY_MS = 2000;

const $view = document.getElementById("view");
const $chip = document.getElementById("sync-chip");
const $sheet = document.getElementById("sheet");

const state = {
    live: { categories: new Map(), subcategories: new Map(), accounts: new Map(), transactions: new Map() },
    view: "activity",
    month: monthOf(today()),
    query: "",
    editingId: null,
    revision: 0,          // bumps on every local change
    syncing: false,
    syncAgain: false,
    syncError: "",
    dirty: false,
    lastSyncAt: null,
    lastSyncMs: null,
    hiddenAt: null,
    timings: {},
};

// ------------------------------------------------------------- helpers

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fmtMoney = (cents) => money.format((cents || 0) / 100);

function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthOf(day) { return day.slice(0, 7); }
function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function dateObj(day) { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d); }
const fmtMonth = (month) => dateObj(`${month}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
const fmtDayLong = (day) => dateObj(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
const fmtDayShort = (day) => dateObj(day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function ago(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    if (s < 90) return "1 min ago";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 5400) return "1 hr ago";
    if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function initials(name) {
    const words = String(name).replace(/&/g, " ").split(/\s+/).filter((w) => /^[a-z0-9]/i.test(w));
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
}

function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function sortedByName(map) {
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function categoryColor(categoryId) {
    const index = sortedByName(state.live.categories).findIndex((c) => c.id === categoryId);
    return PALETTE[(index < 0 ? 0 : index) % PALETTE.length];
}

let toastTimer;
function toast(message) {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ------------------------------------------------------------- data

function setLive(all) {
    for (const name of db.COLLECTIONS) {
        state.live[name] = new Map((all[name] || []).filter((r) => !r.deleted).map((r) => [r.id, r]));
    }
}

async function reload() {
    setLive(await db.readAll());
}

async function save(collection, record) {
    record.updatedAt = Date.now();
    await db.putRecords({ [collection]: [record] });
    if (record.deleted) state.live[collection].delete(record.id);
    else state.live[collection].set(record.id, record);
    await markChanged();
}

async function remove(collection, id) {
    // Keep only a tombstone so the delete reaches your other devices.
    await save(collection, { id, deleted: true });
}

async function markChanged() {
    state.revision += 1;
    state.dirty = true;
    await db.setMeta("dirty", true);
    scheduleSync();
    renderChip();
}

// ------------------------------------------------------------- sync

let syncTimer;
function scheduleSync(delay = SYNC_DELAY_MS) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, delay);
}

async function runSync() {
    const token = auth.token();
    if (!token || !navigator.onLine) { renderChip(); return; }
    if (state.syncing) { state.syncAgain = true; return; }
    state.syncing = true;
    state.syncError = "";
    renderChip();
    const revision = state.revision;
    const started = performance.now();
    try {
        const { pulled } = await syncNow(token);
        state.lastSyncAt = Date.now();
        state.lastSyncMs = Math.round(performance.now() - started);
        await db.setMeta("lastSyncAt", state.lastSyncAt);
        if (state.revision === revision) {
            state.dirty = false;
            await db.setMeta("dirty", false);
        } else {
            state.syncAgain = true;
        }
        if (pulled) {
            await reload();
            // Don't wipe a form you're typing in; refresh the other screens.
            if (state.view !== "add") render();
            toast(`${pulled} update${pulled === 1 ? "" : "s"} from your other devices`);
        } else if (state.view === "settings") {
            render();
        }
    } catch (error) {
        if (error instanceof drive.AuthError) {
            auth.clearToken();
        } else {
            state.syncError = error.message || String(error);
        }
    } finally {
        state.syncing = false;
        renderChip();
        if (state.syncAgain) { state.syncAgain = false; scheduleSync(300); }
    }
}

/** What the chip in the top bar says, and what tapping it does. */
function chipState() {
    if (!auth.isConfigured()) return { text: "On this device only", state: "idle", action: "settings" };
    if (!auth.wasSignedIn()) return { text: "Sign in to sync", state: "attention", action: "settings" };
    if (state.syncing) return { text: "Syncing…", state: "busy" };
    if (!navigator.onLine) return { text: state.dirty ? "Offline · will sync later" : "Offline", state: "idle" };
    if (!auth.token()) {
        return { text: state.dirty ? "Changes waiting · tap to sync" : "Tap to sync", state: "attention", action: "renew" };
    }
    if (state.syncError) return { text: "Sync failed · tap to retry", state: "error", action: "sync" };
    if (state.dirty) return { text: "Saving…", state: "busy" };
    if (state.lastSyncAt) return { text: `Synced ${ago(state.lastSyncAt)}`, state: "ok", action: "sync" };
    return { text: "Ready to sync", state: "idle", action: "sync" };
}

function renderChip() {
    const chip = chipState();
    $chip.textContent = chip.text;
    $chip.dataset.state = chip.state;
    $chip.dataset.action = chip.action || "";
}

$chip.addEventListener("click", () => {
    const action = $chip.dataset.action;
    if (action === "settings") go("settings");
    else if (action === "renew") auth.signIn({ silent: !auth.needsTap() });
    else if (action === "sync") runSync();
});

// ------------------------------------------------------------- navigation

function go(view, options = {}) {
    state.view = view;
    state.editingId = options.editingId || null;
    render();
    window.scrollTo(0, 0);
}

document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.view));
});

function render() {
    document.querySelectorAll("[data-view]").forEach((b) => {
        b.classList.toggle("active", b.dataset.view === state.view && !(state.view === "add" && state.editingId));
    });
    if (state.view === "add") renderForm();
    else if (state.view === "settings") renderSettings();
    else renderActivity();
    renderChip();
}

// ------------------------------------------------------------- activity

function labelFor(t) {
    const category = state.live.categories.get(t.categoryId);
    const sub = t.subcategoryId ? state.live.subcategories.get(t.subcategoryId) : null;
    return (category ? category.name : "Uncategorized") + (sub ? ` / ${sub.name}` : "");
}

function accountName(t) {
    const account = t.accountId ? state.live.accounts.get(t.accountId) : null;
    return account ? account.name : "—";
}

function byNewest(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
}

function renderActivity() {
    const query = state.query.trim().toLowerCase();
    const all = [...state.live.transactions.values()];
    let items;
    let heading;
    if (query) {
        items = all.filter((t) => t.description.toLowerCase().includes(query) || (t.notes || "").toLowerCase().includes(query));
        heading = `${items.length} match${items.length === 1 ? "" : "es"} in all months`;
    } else {
        items = all.filter((t) => monthOf(t.date) === state.month);
        heading = `Spent in ${fmtMonth(state.month).split(" ")[0]}`;
    }
    items.sort(byNewest);
    const total = items.reduce((sum, t) => sum + t.amountCents, 0);
    const shown = items.slice(0, 300);

    const groups = [];
    for (const t of shown) {
        if (!groups.length || groups[groups.length - 1].day !== t.date) groups.push({ day: t.date, items: [], total: 0 });
        groups[groups.length - 1].items.push(t);
        groups[groups.length - 1].total += t.amountCents;
    }

    const noCategories = state.live.categories.size === 0;
    $view.innerHTML = `
        <div class="page-head">
            <h1>Activity</h1>
            <div class="month-switch" ${query ? "hidden" : ""}>
                <button type="button" data-month="-1" aria-label="Previous month">‹</button>
                <strong>${esc(fmtMonth(state.month))}</strong>
                <button type="button" data-month="1" aria-label="Next month">›</button>
            </div>
        </div>
        ${noCategories ? `<div class="notice">Nothing here yet. <a href="#" data-go="settings">Import your backup</a> from the web app, or add starter categories in Settings.</div>` : ""}
        <section class="card">
            <div class="stat-label">${esc(heading)}</div>
            <div class="stat-value">${fmtMoney(total)}</div>
            <div class="muted small">${items.length} transaction${items.length === 1 ? "" : "s"}</div>
        </section>
        <div class="search"><input type="search" id="search" placeholder="Search description or notes" value="${esc(state.query)}" aria-label="Search"></div>
        <section class="card" style="margin-top:10px">
            ${groups.length ? groups.map((g) => `
                <div class="day-group">
                    <div class="day-head"><span>${esc(fmtDayLong(g.day))}</span><span class="num">${fmtMoney(g.total)}</span></div>
                    ${g.items.map((t) => `
                        <button type="button" class="row" data-tx="${esc(t.id)}">
                            <span class="dot" style="background:${categoryColor(t.categoryId)}" aria-hidden="true">${esc(initials(state.live.categories.get(t.categoryId)?.name || "?"))}</span>
                            <span class="row-main">
                                <span class="row-title">${esc(t.description)}</span>
                                <span class="row-sub">${query ? esc(fmtDayShort(t.date)) + " · " : ""}${esc(labelFor(t))}${t.accountId && state.live.accounts.get(t.accountId) ? " · " + esc(accountName(t)) : ""}${t.notes ? " · " + esc(t.notes) : ""}</span>
                            </span>
                            <span class="row-amount">${fmtMoney(t.amountCents)}</span>
                        </button>`).join("")}
                </div>`).join("") : `<div class="empty"><strong>No transactions${query ? " match" : ` in ${esc(fmtMonth(state.month))}`}</strong>${query ? "" : '<a href="#" data-go="add">Add one</a>'}</div>`}
            ${items.length > shown.length ? `<p class="faint small" style="margin:10px 0 0">Showing the newest ${shown.length}. Narrow your search to see more.</p>` : ""}
        </section>`;

    $view.querySelectorAll("[data-month]").forEach((b) => b.addEventListener("click", () => {
        state.month = shiftMonth(state.month, Number(b.dataset.month));
        renderActivity();
    }));
    const search = $view.querySelector("#search");
    search.addEventListener("input", () => {
        state.query = search.value;
        const position = search.selectionStart;
        renderActivity();
        const again = $view.querySelector("#search");
        again.focus();
        again.setSelectionRange(position, position);
    });
    $view.querySelectorAll("[data-tx]").forEach((b) => b.addEventListener("click", () => openTransaction(b.dataset.tx)));
    bindGoLinks();
}

function bindGoLinks() {
    $view.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.go); }));
}

// ------------------------------------------------------------- sheet

function openSheet(title, html, bind) {
    document.getElementById("sheet-title").textContent = title;
    const body = document.getElementById("sheet-body");
    body.innerHTML = html;
    if (bind) bind(body);
    if (!$sheet.open) $sheet.showModal();
}
function closeSheet() { if ($sheet.open) $sheet.close(); }
$sheet.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-sheet]") || event.target === $sheet) closeSheet();
});

function openTransaction(id) {
    const t = state.live.transactions.get(id);
    if (!t) return;
    openSheet(t.description, `
        <div class="stat-value" style="margin-bottom:10px">${fmtMoney(t.amountCents)}</div>
        <dl class="detail-list">
            <dt>Date</dt><dd>${esc(dateObj(t.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))}</dd>
            <dt>Category</dt><dd>${esc(labelFor(t))}</dd>
            <dt>Paid with</dt><dd>${esc(accountName(t))}</dd>
            <dt>Notes</dt><dd>${esc(t.notes || "—")}</dd>
            <dt>Added</dt><dd>${t.createdAt ? esc(new Date(t.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })) : "—"}</dd>
        </dl>
        <div class="form-actions">
            <button type="button" class="btn" data-edit>Edit</button>
            <button type="button" class="btn btn-danger" data-delete>Delete</button>
        </div>`, (body) => {
        body.querySelector("[data-edit]").addEventListener("click", () => { closeSheet(); go("add", { editingId: id }); });
        body.querySelector("[data-delete]").addEventListener("click", async () => {
            if (!confirm(`Delete “${t.description}” (${fmtMoney(t.amountCents)})?`)) return;
            await remove("transactions", id);
            closeSheet();
            render();
            toast("Transaction deleted");
        });
    });
}

// ------------------------------------------------------------- add / edit

function descriptionSuggestions() {
    const counts = new Map();
    for (const t of state.live.transactions.values()) counts.set(t.description, (counts.get(t.description) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([d]) => d);
}

function lastAccountId() {
    try { return localStorage.getItem("fd_last_account") || ""; } catch { return ""; }
}

function renderForm() {
    const editing = state.editingId ? state.live.transactions.get(state.editingId) : null;
    if (state.editingId && !editing) { go("activity"); return; }
    const t = editing || { date: today(), accountId: lastAccountId(), categoryId: "", subcategoryId: "", notes: "" };
    const categories = sortedByName(state.live.categories);
    const accounts = sortedByName(state.live.accounts).filter((a) => !a.archived || a.id === t.accountId);

    $view.innerHTML = `
        <section class="card">
            <div class="card-head"><h1 style="font-size:22px">${editing ? "Edit transaction" : "Add transaction"}</h1></div>
            ${categories.length ? "" : `<div class="notice">You don’t have any categories yet. <a href="#" data-go="settings">Import your backup or add starter categories</a> first.</div>`}
            <form id="tx-form" novalidate>
                <div class="field">
                    <label for="f-amount">Amount (USD)</label>
                    <input id="f-amount" class="amount-input" inputmode="decimal" placeholder="0.00" autocomplete="off" value="${editing ? (t.amountCents / 100).toFixed(2) : ""}">
                </div>
                <div class="field">
                    <label for="f-description">Description</label>
                    <input id="f-description" list="desc-suggestions" placeholder="e.g. Weekly groceries" autocomplete="off" maxlength="200" value="${esc(t.description || "")}">
                    <datalist id="desc-suggestions">${descriptionSuggestions().map((d) => `<option value="${esc(d)}">`).join("")}</datalist>
                </div>
                <div class="field-row">
                    <div class="field">
                        <label for="f-category">Category</label>
                        <select id="f-category">
                            <option value="">Choose a category</option>
                            ${categories.map((c) => `<option value="${esc(c.id)}" ${c.id === t.categoryId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
                        </select>
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
                    </div>
                    <div class="field">
                        <label for="f-account">Paid with</label>
                        <select id="f-account">
                            <option value="">Not specified</option>
                            ${accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === t.accountId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <div class="field">
                    <label for="f-notes">Notes</label>
                    <textarea id="f-notes" rows="2" placeholder="Optional">${esc(t.notes || "")}</textarea>
                </div>
                <p class="error" id="f-error" hidden></p>
                <div class="form-actions">
                    ${editing
                        ? `<button type="submit" class="btn" data-then="list">Save changes</button>
                           <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
                           <button type="button" class="btn btn-danger" data-delete style="margin-left:auto">Delete</button>`
                        : `<button type="submit" class="btn" data-then="add">Save &amp; add another</button>
                           <button type="submit" class="btn btn-secondary" data-then="list">Save &amp; view list</button>`}
                </div>
            </form>
        </section>`;

    const form = $view.querySelector("#tx-form");
    const category = form.querySelector("#f-category");
    const sub = form.querySelector("#f-subcategory");
    const fillSubs = (selected) => {
        const subs = sortedByName(state.live.subcategories).filter((s) => s.categoryId === category.value);
        sub.innerHTML = `<option value="">${subs.length ? "No subcategory" : "—"}</option>` +
            subs.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
        sub.disabled = !subs.length;
    };
    fillSubs(t.subcategoryId);
    category.addEventListener("change", () => fillSubs(""));

    let then = "add";
    form.querySelectorAll("[data-then]").forEach((b) => b.addEventListener("click", () => { then = b.dataset.then; }));
    form.querySelector("[data-cancel]")?.addEventListener("click", () => go("activity"));
    form.querySelector("[data-delete]")?.addEventListener("click", async () => {
        if (!confirm(`Delete “${editing.description}”?`)) return;
        await remove("transactions", editing.id);
        toast("Transaction deleted");
        go("activity");
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const error = form.querySelector("#f-error");
        const amountCents = toCents(form.querySelector("#f-amount").value);
        const description = form.querySelector("#f-description").value.trim();
        const date = form.querySelector("#f-date").value;
        const problems = [];
        if (!amountCents || amountCents <= 0) problems.push("Enter an amount greater than 0.");
        if (!description) problems.push("Add a description.");
        if (!category.value) problems.push("Choose a category.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push("Choose a date.");
        if (problems.length) {
            error.textContent = problems.join(" ");
            error.hidden = false;
            return;
        }
        const accountId = form.querySelector("#f-account").value || null;
        const record = {
            ...(editing || { id: newId(), createdAt: new Date().toISOString() }),
            date,
            description,
            amountCents,
            categoryId: category.value,
            subcategoryId: sub.value || null,
            accountId,
            notes: form.querySelector("#f-notes").value.trim(),
        };
        delete record.deleted;
        await save("transactions", record);
        try { if (accountId) localStorage.setItem("fd_last_account", accountId); } catch { /* ignore */ }
        toast(`Saved ${fmtMoney(amountCents)} · ${description}`);
        if (editing || then === "list") {
            state.month = monthOf(date);
            go("activity");
        } else {
            renderForm();
            $view.querySelector("#f-amount").focus();
        }
    });

    if (!editing) $view.querySelector("#f-amount").focus({ preventScroll: true });
    bindGoLinks();
}

// ------------------------------------------------------------- settings

function renderSettings() {
    const configured = auth.isConfigured();
    const signedIn = auth.wasSignedIn();
    const who = auth.account();
    const autoRenew = localStorage.getItem("fd_auto_renew") !== "0";
    const silent = auth.lastSilent();
    const expires = auth.tokenExpiresAt();
    const counts = db.COLLECTIONS.map((n) => `${state.live[n].size} ${n}`).join(" · ");

    $view.innerHTML = `
        <div class="page-head"><h1>Settings</h1></div>

        <section class="card">
            <div class="card-head"><h2>Google Drive sync</h2></div>
            ${!configured ? `
                <div class="notice">Sync isn’t set up yet: paste your Google client ID into <code>config.js</code> (see README → “Google setup”). Until then everything stays on this device.</div>
            ` : signedIn ? `
                <div class="list-row"><div><div class="title">${esc(who?.email || "Signed in")}</div><div class="sub">Data is saved in a hidden app folder in your Google Drive</div></div>
                    <button type="button" class="btn btn-secondary btn-small" data-signout>Sign out</button></div>
                <div class="list-row"><div><div class="title">Last synced</div><div class="sub">${state.lastSyncAt ? esc(new Date(state.lastSyncAt).toLocaleString()) : "Not yet"}${state.syncError ? ` · <span class="bad">${esc(state.syncError)}</span>` : ""}</div></div>
                    <button type="button" class="btn btn-small" data-sync ${state.syncing ? "disabled" : ""}>Sync now</button></div>
                <div class="list-row"><div><div class="title">Renew sign-in automatically</div><div class="sub">When the 1-hour Google pass has expired, quickly bounce through Google on open instead of waiting for a tap</div></div>
                    <input type="checkbox" class="switch" data-auto ${autoRenew ? "checked" : ""} aria-label="Renew sign-in automatically"></div>
            ` : `
                <p class="muted">Sign in to keep this device and your other devices in sync. The app only gets access to its own hidden folder in your Drive — not your other files.</p>
                <button type="button" class="btn" data-signin>Sign in with Google</button>
            `}
        </section>

        <section class="card">
            <div class="card-head"><h2>Your data</h2></div>
            <div class="list-row"><div><div class="title">Import backup</div><div class="sub">The JSON from the web app (Settings → Full backup). Safe to repeat.</div></div>
                <label class="btn btn-secondary btn-small" style="cursor:pointer">Choose file<input type="file" accept="application/json,.json" data-import hidden></label></div>
            ${state.live.categories.size ? "" : `<div class="list-row"><div><div class="title">Starter categories</div><div class="sub">Housing, Food, Transportation… edit later</div></div>
                <button type="button" class="btn btn-secondary btn-small" data-starter>Add</button></div>`}
            <div class="list-row"><div><div class="title">Download a copy</div><div class="sub">Everything on this device as JSON</div></div>
                <button type="button" class="btn btn-secondary btn-small" data-export>Download</button></div>
            <div class="list-row"><div><div class="title">Erase this device</div><div class="sub">Removes local data only. Your Drive copy stays and syncs back after sign-in.</div></div>
                <button type="button" class="btn btn-danger btn-small" data-erase>Erase…</button></div>
        </section>

        <section class="card">
            <div class="card-head"><h2>Experiment numbers</h2></div>
            <dl class="diag">
                <dt>App ready in</dt><dd>${state.timings.ready ? `${state.timings.ready} ms after launch` : "—"}</dd>
                <dt>Last sync took</dt><dd>${state.lastSyncMs != null ? `${state.lastSyncMs} ms` : "—"}</dd>
                <dt>Google pass</dt><dd>${expires ? (expires > Date.now() ? `valid for ${Math.round((expires - Date.now()) / 60000)} more min` : "expired") : "none"}</dd>
                <dt>Last silent renewal</dt><dd>${silent ? `${silent.ok ? "worked" : `needed a tap (${esc(silent.error)})`} · ${(silent.ms / 1000).toFixed(1)} s · ${esc(ago(silent.at))}` : "not tried yet"}</dd>
                <dt>Stored here</dt><dd>${esc(counts)}</dd>
                <dt>Version</dt><dd>${esc(APP_VERSION)}</dd>
            </dl>
        </section>`;

    const q = (sel) => $view.querySelector(sel);
    q("[data-signin]")?.addEventListener("click", () => auth.signIn({ silent: false }));
    q("[data-signout]")?.addEventListener("click", async () => {
        if (!confirm("Sign out of Google on this device? Your data stays here.")) return;
        await auth.signOut();
        await db.setMeta("driveFileId", null);
        render();
    });
    q("[data-sync]")?.addEventListener("click", () => { if (auth.token()) runSync(); else auth.signIn({ silent: !auth.needsTap() }); });
    q("[data-auto]")?.addEventListener("change", (e) => localStorage.setItem("fd_auto_renew", e.target.checked ? "1" : "0"));
    q("[data-import]").addEventListener("change", (e) => importFile(e.target.files[0]));
    q("[data-starter]")?.addEventListener("click", async () => {
        const changes = buildStarter(newId);
        await db.putRecords(changes);
        await reload();
        await markChanged();
        render();
        toast("Starter categories added");
    });
    q("[data-export]").addEventListener("click", exportData);
    q("[data-erase]").addEventListener("click", async () => {
        if (!confirm("Erase all finance data stored on this device? (Your Google Drive copy is not touched.)")) return;
        await db.eraseDevice();
        await auth.signOut();
        location.reload();
    });
}

async function importFile(file) {
    if (!file) return;
    try {
        const backup = JSON.parse(await file.text());
        const live = Object.fromEntries(db.COLLECTIONS.map((n) => [n, [...state.live[n].values()]]));
        const { changes, summary } = buildImport(backup, live);
        const written = await db.putIfNewer(changes);
        await reload();
        if (written) await markChanged();
        render();
        openSheet("Import finished", `
            <p>${summary.transactions} transactions, ${summary.categories} new categories, ${summary.subcategories} new subcategories and ${summary.accounts} new payment methods.</p>
            <p class="muted small">${written} record${written === 1 ? "" : "s"} written${written === 0 ? " — everything was already here" : ""}.${summary.skipped ? ` ${summary.skipped} rows were skipped (bad date or amount).` : ""}</p>
            ${summary.notImported.length ? `<p class="muted small">Not imported in this proof of concept: ${esc(summary.notImported.join(", ").replace(/_/g, " "))}.</p>` : ""}
            <div class="form-actions"><button type="button" class="btn" data-close-sheet>Done</button></div>`);
    } catch (error) {
        toast(error.message || "That file couldn't be read.");
    }
}

async function exportData() {
    const all = await db.readAll();
    const data = Object.fromEntries(db.COLLECTIONS.map((n) => [n, all[n].filter((r) => !r.deleted)]));
    const blob = new Blob([JSON.stringify({ format: "finance-drive-export", exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `finance-${today()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ------------------------------------------------------------- start-up

function wantsAutoRenew() {
    return localStorage.getItem("fd_auto_renew") !== "0" && navigator.onLine && auth.canAutoRenew();
}

async function boot() {
    const redirect = auth.handleRedirect();
    await reload();
    state.dirty = !!(await db.getMeta("dirty"));
    state.lastSyncAt = await db.getMeta("lastSyncAt");
    render();
    state.timings.ready = Math.round(performance.now());

    if (redirect?.kind === "error" && !redirect.silent) {
        toast(redirect.error === "access_denied" ? "Google sign-in was cancelled" : `Google sign-in failed (${redirect.error})`);
    }
    if (redirect?.kind === "token" && !auth.account()) {
        drive.whoAmI(auth.token()).then((who) => { if (who) { auth.setAccount(who); if (state.view === "settings") render(); } });
    }

    if (auth.token()) {
        runSync();
    } else if (wantsAutoRenew()) {
        // Show your data first, then bounce through Google for a fresh pass.
        setTimeout(() => auth.signIn({ silent: true }), 150);
    }

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { state.hiddenAt = Date.now(); return; }
        const away = state.hiddenAt ? Date.now() - state.hiddenAt : 0;
        if (auth.token()) {
            if (!state.lastSyncAt || Date.now() - state.lastSyncAt > 30000) runSync();
        } else if (away > 5 * 60 * 1000 && state.view !== "add" && wantsAutoRenew()) {
            auth.signIn({ silent: true });
        }
        renderChip();
    });
    window.addEventListener("online", () => { renderChip(); runSync(); });
    window.addEventListener("offline", renderChip);
    setInterval(renderChip, 30000);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
        navigator.serviceWorker.register("sw.js").catch(() => { /* offline mode unavailable */ });
    }
}

boot();
