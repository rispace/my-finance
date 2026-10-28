// Settings (settings.html + settings_views.py): Google Drive sync, categories,
// subcategories, payment methods, import/export, stock prices, diagnostics.

import * as db from "../db.js";
import * as store from "../store.js";
import * as auth from "../auth.js";
import { ACCOUNT_KINDS, FINNHUB_PREF_ID, uniqueName } from "../calc.js";
import { esc, today, timeAgo, byName, newId, plural, squash } from "../util.js";
import { formPageHtml, readForm, showErrors, parse, openSheet, toast, confirmAction } from "../ui.js";
import { navigate, startSignIn, runSync, syncState, timings, APP_VERSION } from "../app.js";
import { buildImport, buildStarter } from "../importer.js";
import { buildCsvImport, transactionsCsv, saveFile } from "../csv.js";
import { lookups } from "./activity.js";
import * as quotes from "../quotes.js";

export function settingsView({ el, rerender }) {
    const data = store.snapshot();
    const configured = auth.isConfigured();
    const signedIn = auth.wasSignedIn();
    const who = auth.account();
    let autoRenew = true;
    try { autoRenew = localStorage.getItem("fd_auto_renew") !== "0"; } catch { /* ignore */ }
    const silent = auth.lastSilent();
    const expires = auth.tokenExpiresAt();
    const used = (field, id) => data.transactions.filter((t) => t[field] === id).length;
    const categories = [...data.categories].sort(byName);
    const accounts = [...data.accounts].sort((a, b) => (a.archived - b.archived) || byName(a, b));
    const totalRecords = db.COLLECTIONS.reduce((s, n) => s + data[n].length, 0);

    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Settings</h1>
            <p class="muted">${who?.email ? `Syncing with ${esc(who.email)}` : "Your data lives on this device" + (configured ? " and in your Google Drive" : "")}</p>
        </div>
    </div>

    <div class="grid grid-main">
        <div class="stack">
            <section class="card">
                <div class="card-head">
                    <h2>Categories</h2>
                    <a class="btn btn-small" href="#/category/new"><svg width="16" height="16"><use href="#i-plus"/></svg>Category</a>
                </div>
                <p class="muted small">Rename freely — past transactions follow along. Deleting asks where to move existing transactions.</p>
                ${categories.map((c) => `
                <div class="row" style="align-items:flex-start">
                    <div class="row-main">
                        <div class="row-title">${esc(c.name)} <span class="faint small">· ${plural(used("categoryId", c.id), "transaction")}</span></div>
                        <div class="tag-list">
                            ${data.subcategories.filter((s) => s.categoryId === c.id).sort(byName).map((s) => `<a class="tag" href="#/sub/${encodeURIComponent(s.id)}" title="Rename or delete">${esc(s.name)}</a>`).join("")}
                            <a class="tag" href="#/category/${encodeURIComponent(c.id)}/sub/new" style="color:var(--accent)">+ Add</a>
                        </div>
                    </div>
                    <div class="row-end">
                        <a class="btn btn-ghost btn-small" href="#/category/${encodeURIComponent(c.id)}">Rename</a>
                        <a class="btn btn-ghost btn-small" style="color:var(--danger)" href="#/category/${encodeURIComponent(c.id)}/delete">Delete</a>
                    </div>
                </div>`).join("") || `
                <div class="empty"><strong>No categories yet</strong><a href="#/category/new">Create your first category</a>, import your backup, or
                    <button type="button" class="link" data-starter>add starter categories</button>.</div>`}
                <p class="faint small" style="margin-top:10px">To remove a subcategory, open it and choose Delete.</p>
            </section>

            <section class="card">
                <div class="card-head"><h2>Google Drive sync</h2></div>
                ${!configured ? `
                    <div class="notice">Sync isn’t set up: paste your Google client ID into <code>config.js</code> (see README → “Google setup”). Until then everything stays on this device.</div>
                ` : signedIn ? `
                    <ul class="list">
                        <li class="row"><div class="row-main"><div class="row-title">${esc(who?.email || "Signed in")}</div><div class="row-sub">Saved in a hidden app folder in your Google Drive — only this app can see it</div></div>
                            <button type="button" class="btn btn-secondary btn-small" data-signout>Sign out</button></li>
                        <li class="row"><div class="row-main"><div class="row-title">Last synced</div><div class="row-sub">${syncState.lastAt ? esc(new Date(syncState.lastAt).toLocaleString()) : "Not yet"}${syncState.error ? ` · <span class="bad">${esc(syncState.error)}</span>` : ""}</div></div>
                            <button type="button" class="btn btn-small" data-sync ${syncState.running ? "disabled" : ""}>Sync now</button></li>
                        <li class="row"><div class="row-main"><div class="row-title">Renew sign-in automatically</div><div class="row-sub">When the 1-hour Google pass has expired, bounce through Google on open instead of waiting for a tap</div></div>
                            <input type="checkbox" data-auto ${autoRenew ? "checked" : ""} aria-label="Renew sign-in automatically"></li>
                    </ul>
                ` : `
                    <p class="muted">Sign in to keep your phone and computer in sync. The app only gets access to its own hidden folder in your Drive — not your other files.</p>
                    <button type="button" class="btn" data-signin>Sign in with Google</button>
                `}
            </section>
        </div>

        <div class="stack">
            <section class="card" id="payment-methods">
                <div class="card-head">
                    <h2>Payment methods</h2>
                    <a class="btn btn-small" href="#/account/new"><svg width="16" height="16"><use href="#i-plus"/></svg>Add</a>
                </div>
                <div class="tag-list">
                    ${accounts.map((a) => `<a class="tag ${a.archived ? "archived" : ""}" href="#/account/${encodeURIComponent(a.id)}">${esc(a.name)} <span class="faint">· ${used("accountId", a.id)}</span></a>`).join("") || `<span class="muted small">None yet.</span>`}
                </div>
            </section>

            <section class="card">
                <div class="card-head"><h2>Your data</h2></div>
                <ul class="list">
                    <li class="row"><div class="row-main"><div class="row-title">Import backup (JSON)</div><div class="row-sub">From the old web app (Settings → Full backup) or from this app. Safe to repeat.</div></div>
                        <label class="btn btn-secondary btn-small file-button">Choose file<input type="file" accept="application/json,.json" data-import></label></li>
                    <li class="row"><div class="row-main"><div class="row-title">Full backup (JSON)</div><div class="row-sub">Everything: transactions, budgets, cards, loans, assets, holdings</div></div>
                        <button type="button" class="btn btn-secondary btn-small" data-backup>Download</button></li>
                    <li class="row"><div class="row-main"><div class="row-title">Transactions (CSV)</div><div class="row-sub">Opens in Excel / Numbers</div></div>
                        <button type="button" class="btn btn-secondary btn-small" data-csv>Download</button></li>
                    <li class="row"><div class="row-main"><div class="row-title">Import transactions</div><div class="row-sub">From a CSV in the same format</div></div>
                        <a class="btn btn-secondary btn-small" href="#/import-csv">Import</a></li>
                    ${categories.length ? "" : `<li class="row"><div class="row-main"><div class="row-title">Starter categories</div><div class="row-sub">Housing, Food, Transportation… edit later</div></div>
                        <button type="button" class="btn btn-secondary btn-small" data-starter>Add</button></li>`}
                </ul>
            </section>

            <section class="card">
                <div class="card-head"><h2>Stock prices</h2></div>
                <ul class="list">
                    <li class="row"><div class="row-main"><div class="row-title">Finnhub API key</div><div class="row-sub">${quotes.apiKey() ? "Set — live prices are on" : "Not set — live prices are off (free at finnhub.io)"}</div></div>
                        <a class="btn btn-secondary btn-small" href="#/finnhub">${quotes.apiKey() ? "Change" : "Add"}</a></li>
                </ul>
            </section>

            <section class="card">
                <div class="card-head"><h2>This device</h2></div>
                <dl class="diag">
                    <dt>App opened in</dt><dd>${timings.ready ? `${timings.ready} ms` : "—"}</dd>
                    <dt>Last sync took</dt><dd>${syncState.lastMs != null ? `${syncState.lastMs} ms` : "—"}</dd>
                    <dt>Google pass</dt><dd>${expires ? (expires > Date.now() ? `valid for ${Math.round((expires - Date.now()) / 60000)} more min` : "expired") : "none"}</dd>
                    <dt>Last silent renewal</dt><dd>${silent ? `${silent.ok ? "worked" : `needed a tap (${esc(silent.error)})`} · ${(silent.ms / 1000).toFixed(1)} s · ${esc(timeAgo(silent.at))}` : "not tried yet"}</dd>
                    <dt>Records stored</dt><dd>${totalRecords.toLocaleString()} (${plural(data.transactions.length, "transaction")})</dd>
                    <dt>Version</dt><dd>${esc(APP_VERSION)}</dd>
                </dl>
                <div class="form-actions" style="margin-top:14px">
                    <button type="button" class="btn btn-ghost btn-small" style="color:var(--danger)" data-erase>Erase this device…</button>
                </div>
            </section>
        </div>
    </div>`;

    const q = (sel) => el.querySelector(sel);
    q("[data-signin]")?.addEventListener("click", () => startSignIn({ silent: false }));
    q("[data-signout]")?.addEventListener("click", async () => {
        if (!confirmAction("Sign out of Google on this device? Your data stays here; syncing stops until you sign in again.")) return;
        await auth.signOut();
        await db.setMeta("driveFileId", null);
        rerender();
    });
    q("[data-sync]")?.addEventListener("click", () => (auth.token() ? runSync() : startSignIn({ silent: !auth.needsTap() })));
    q("[data-auto]")?.addEventListener("change", (e) => { try { localStorage.setItem("fd_auto_renew", e.target.checked ? "1" : "0"); } catch { /* ignore */ } });
    q("[data-import]").addEventListener("change", (e) => importBackupFile(e.target.files[0], rerender));
    el.querySelectorAll("[data-starter]").forEach((b) => b.addEventListener("click", async () => {
        await store.mergeIn(buildStarter(newId));
        toast("Starter categories added.");
        rerender();
    }));
    q("[data-backup]").addEventListener("click", downloadBackup);
    q("[data-csv]").addEventListener("click", () => {
        const items = [...data.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        saveFile(`expenses-${today()}.csv`, transactionsCsv(items, lookups()));
    });
    q("[data-erase]").addEventListener("click", async () => {
        if (!confirmAction("Erase all finance data stored on this device and sign out? Your Google Drive copy is not touched and comes back when you sign in again.")) return;
        await db.eraseDevice();
        await auth.signOut();
        location.hash = "#/";
        location.reload();
    });
}

async function importBackupFile(file, rerender) {
    if (!file) return;
    try {
        if (file.size > 20 * 1024 * 1024) throw new Error("Please choose a file smaller than 20 MB.");
        const backup = JSON.parse(await file.text());
        const { changes, summary } = buildImport(backup, store.snapshot());
        const written = await store.mergeIn(changes);
        rerender();
        const lines = summary.kind === "restore"
            ? [`Restored from this app’s backup.`]
            : [
                `${plural(summary.transactions, "transaction")}, ${plural(summary.cards, "credit card")} (${plural(summary.cardActivity, "activity entry", "activity entries")}), ${plural(summary.loans, "loan")} (${plural(summary.loanPayments, "payment")}) and ${plural(summary.stocks, "holding")}.`,
                summary.hasBudgetsAndAssets ? `${plural(summary.budgets, "budget line")} and ${plural(summary.assets, "asset")}.` : "This backup has no budgets or assets (the web app didn’t export them) — set those up here.",
            ];
        openSheet("Import finished", `
            ${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
            <p class="muted small">${plural(written, "record")} written${written === 0 ? " — everything was already here" : ""}.${summary.skipped ? ` ${plural(summary.skipped, "row")} skipped (bad date or amount).` : ""}</p>
            <div class="form-actions"><button type="button" class="btn" data-close-sheet>Done</button></div>`);
    } catch (error) {
        toast(error instanceof SyntaxError ? "That file isn’t valid JSON." : (error.message || "That file couldn’t be read."), "error");
    }
}

async function downloadBackup() {
    const all = await db.readAll();
    const data = Object.fromEntries(db.COLLECTIONS.map((n) => [n, all[n].filter((r) => !r.deleted)]));
    const text = JSON.stringify({ format: "finance-drive-export", version: 2, exportedAt: new Date().toISOString(), data }, null, 2);
    await saveFile(`finance-backup-${today()}.json`, text, "application/json");
}

// ------------------------------------------------------------- categories

export function categoryFormView({ el, params }) {
    const category = params.id ? store.get("categories", params.id) : null;
    if (params.id && !category) return navigate("/settings", { replace: true });
    el.innerHTML = formPageHtml({
        title: category ? "Rename category" : "New category",
        fields: [{ name: "name", label: "Category name", value: category?.name || "", maxlength: 60 }],
        cancelHref: "#/settings", deleteLabel: category ? "Delete" : "",
    });
    const form = el.querySelector("[data-form]");
    el.querySelector("[data-delete]")?.addEventListener("click", () => navigate(`/category/${encodeURIComponent(category.id)}/delete`));
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = squash(readForm(form).name).slice(0, 60);
        const error = !name ? "This field is required." : !uniqueName(store.all("categories"), name, category?.id) ? "That name is already in use." : "";
        if (showErrors(form, error ? { name: error } : {})) return;
        await store.save("categories", { ...(category || { id: newId() }), name });
        toast(`Category “${name}” saved.`);
        navigate("/settings");
    });
}

export function categoryDeleteView({ el, params }) {
    const category = store.get("categories", params.id);
    if (!category) return navigate("/settings", { replace: true });
    const transactions = store.all("transactions").filter((t) => t.categoryId === category.id);
    const others = store.all("categories").filter((c) => c.id !== category.id).sort(byName);
    const used = transactions.length;
    el.innerHTML = formPageHtml({
        title: `Delete category “${category.name}”`,
        description: used ? `${plural(used, "transaction")} use this category. Choose where they should go — nothing is lost.` : "No transactions use this category.",
        fields: used ? [{ name: "target", label: "Move its transactions to", type: "select", emptyLabel: "Choose a category", options: others.map((c) => [c.id, c.name]) }] : [],
        submitLabel: "Delete", cancelHref: "#/settings",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const targetId = used ? readForm(form).target : null;
        if (used && !targetId) { showErrors(form, { target: "This field is required." }); return; }
        const subs = store.all("subcategories").filter((s) => s.categoryId === category.id);
        const changes = { transactions: [], subcategories: subs.map((s) => ({ id: s.id, deleted: true })), categories: [{ id: category.id, deleted: true }] };
        if (used) {
            // Keep subcategory names by recreating them under the target.
            const targetSubs = store.all("subcategories").filter((s) => s.categoryId === targetId);
            const subMap = new Map();
            for (const sub of subs) {
                let match = targetSubs.find((s) => s.name.toLowerCase() === sub.name.toLowerCase());
                if (!match) {
                    match = { id: newId(), categoryId: targetId, name: sub.name };
                    changes.subcategories.push(match);
                    targetSubs.push(match);
                }
                subMap.set(sub.id, match.id);
            }
            changes.transactions = transactions.map((t) => ({ ...t, categoryId: targetId, subcategoryId: t.subcategoryId ? subMap.get(t.subcategoryId) || null : null }));
        }
        await store.saveMany(changes);
        const target = store.get("categories", targetId);
        toast(`Deleted “${category.name}”` + (used ? ` and moved ${plural(used, "transaction")} to “${target?.name}”.` : "."));
        navigate("/settings");
    });
}

export function subcategoryFormView({ el, params }) {
    // "category/:id/sub/new" passes the category id; "sub/:id" the subcategory id.
    const isNew = location.hash.includes("/sub/new");
    const editing = isNew ? null : store.get("subcategories", params.id);
    const owner = isNew ? store.get("categories", params.id) : store.get("categories", editing?.categoryId);
    if (!owner || (!isNew && !editing)) return navigate("/settings", { replace: true });
    el.innerHTML = formPageHtml({
        title: editing ? `Rename subcategory in ${owner.name}` : `New subcategory in ${owner.name}`,
        fields: [{ name: "name", label: "Subcategory name", value: editing?.name || "", maxlength: 60 }],
        cancelHref: "#/settings", deleteLabel: editing ? "Delete" : "",
    });
    const form = el.querySelector("[data-form]");
    el.querySelector("[data-delete]")?.addEventListener("click", () => navigate(`/sub/${encodeURIComponent(editing.id)}/delete`));
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = squash(readForm(form).name).slice(0, 60);
        const error = !name ? "This field is required."
            : !uniqueName(store.all("subcategories"), name, editing?.id, (s) => s.categoryId === owner.id) ? "That name is already in use." : "";
        if (showErrors(form, error ? { name: error } : {})) return;
        await store.save("subcategories", { ...(editing || { id: newId(), categoryId: owner.id }), name });
        toast(`“${name}” saved under ${owner.name}.`);
        navigate("/settings");
    });
}

export function subcategoryDeleteView({ el, params }) {
    const sub = store.get("subcategories", params.id);
    if (!sub) return navigate("/settings", { replace: true });
    const category = store.get("categories", sub.categoryId);
    const transactions = store.all("transactions").filter((t) => t.subcategoryId === sub.id);
    const siblings = store.all("subcategories").filter((s) => s.categoryId === sub.categoryId && s.id !== sub.id).sort(byName);
    el.innerHTML = formPageHtml({
        title: `Delete subcategory “${sub.name}”`,
        description: transactions.length
            ? `${plural(transactions.length, "transaction")} use it. They stay in ${esc(category?.name || "their category")}; choose a subcategory to move them to, or leave them without one.`
            : "No transactions use this subcategory.",
        fields: transactions.length ? [{ name: "target", label: "Move its transactions to", type: "select", emptyLabel: "No subcategory", options: siblings.map((s) => [s.id, s.name]) }] : [],
        submitLabel: "Delete", cancelHref: "#/settings",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const target = transactions.length ? readForm(form).target || null : null;
        await store.saveMany({
            transactions: transactions.map((t) => ({ ...t, subcategoryId: target })),
            subcategories: [{ id: sub.id, deleted: true }],
        });
        toast(`Deleted “${sub.name}”.`);
        navigate("/settings");
    });
}

// ------------------------------------------------------------- payment methods

export function accountFormView({ el, params }) {
    const account = params.id ? store.get("accounts", params.id) : null;
    if (params.id && !account) return navigate("/settings", { replace: true });
    el.innerHTML = formPageHtml({
        title: account ? "Edit payment method" : "New payment method",
        description: "Archive a card you no longer use: old transactions keep it, but it disappears from the add form.",
        fields: [
            { name: "name", label: "Name", value: account?.name || "", maxlength: 60 },
            { name: "kind", label: "Type", type: "select", options: ACCOUNT_KINDS, value: account?.kind || "other" },
            { name: "archived", label: "Archived", type: "checkbox", value: !!account?.archived },
        ],
        cancelHref: "#/settings",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const name = squash(v.name).slice(0, 60);
        const error = !name ? "This field is required." : !uniqueName(store.all("accounts"), name, account?.id) ? "That name is already in use." : "";
        if (showErrors(form, error ? { name: error } : {})) return;
        await store.save("accounts", { ...(account || { id: newId() }), name, kind: v.kind, archived: !!v.archived });
        toast(`Payment method “${name}” saved.`);
        navigate("/settings");
    });
}

// ------------------------------------------------------------- CSV import, Finnhub key

export function csvImportView({ el }) {
    el.innerHTML = formPageHtml({
        title: "Import transactions",
        description: "Upload a CSV (for example, one you exported earlier). Missing categories, subcategories and payment methods are created automatically.",
        fields: [{ name: "skip", label: "Skip rows that already exist (same date, description and amount)", type: "checkbox", value: true }],
        extraHtml: `<div class="field"><label for="csv-file">CSV file</label><input type="file" id="csv-file" accept=".csv,text/csv">
            <p class="help">Use the same columns as this app's CSV export: Date, Description, Amount (USD), Category, Subcategory, Payment Method, Notes.</p></div>`,
        submitLabel: "Import", cancelHref: "#/settings",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const file = el.querySelector("#csv-file").files[0];
        if (!file) { showErrors(form, { __all__: "Choose a CSV file." }); return; }
        if (file.size > 5 * 1024 * 1024) { showErrors(form, { __all__: "Please upload a file smaller than 5 MB." }); return; }
        const result = buildCsvImport(await file.text(), store.snapshot(), { skipDuplicates: readForm(form).skip, newId });
        if (result.errors.length) {
            showErrors(form, { __all__: result.errors.slice(0, 8).join(" ") + " Nothing was imported. Fix the rows and try again." });
            return;
        }
        await store.saveMany(result.changes);
        toast(`Imported ${plural(result.created, "transaction")}; skipped ${plural(result.skipped, "duplicate")}.`);
        navigate("/activity");
    });
}

export function finnhubView({ el }) {
    const pref = store.get("prefs", FINNHUB_PREF_ID);
    el.innerHTML = formPageHtml({
        title: "Stock prices",
        description: `Live prices come from <a href="https://finnhub.io/register" target="_blank" rel="noopener">Finnhub</a> (free account). Paste your API key below. It’s stored with your data — on this device and in your own Google Drive — so your other devices get it too.`,
        fields: [{ name: "key", label: "Finnhub API key", value: pref?.key || "", placeholder: "e.g. c1a2b3c4d5…", maxlength: 100, attrs: 'autocapitalize="off" spellcheck="false"' }],
        cancelHref: "#/settings",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const key = readForm(form).key.trim();
        if (key && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) { showErrors(form, { key: "That doesn’t look like a Finnhub key (letters and numbers only)." }); return; }
        await store.save("prefs", { id: FINNHUB_PREF_ID, key });
        toast(key ? "Finnhub key saved. Prices will refresh automatically." : "Finnhub key removed.");
        navigate(key ? "/assets" : "/settings");
    });
}

