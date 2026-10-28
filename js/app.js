// App start-up, navigation (hash routes like #/loan/abc), the sync status
// chip, and when to sync. Screens live in js/views/.

import * as db from "./db.js";
import * as store from "./store.js";
import * as auth from "./auth.js";
import * as drive from "./drive.js";
import { syncNow } from "./sync.js";
import { initSheet, closeSheet, toast } from "./ui.js";
import { timeAgo } from "./util.js";
import * as quotes from "./quotes.js";

import { overviewView } from "./views/overview.js";
import { activityView, transactionFormView } from "./views/activity.js";
import { budgetView } from "./views/budget.js";
import { cardsView, cardFormView, cardEditView, cardRecordView, cardActivityEditView, loansView, loanDetailView, loanFormView, loanPaymentView } from "./views/debt.js";
import { assetsView, assetFormView, assetValueView, stockFormView, cashFormView } from "./views/assets.js";
import { settingsView, categoryFormView, categoryDeleteView, subcategoryFormView, subcategoryDeleteView, accountFormView, csvImportView, finnhubView } from "./views/settings.js";

export const APP_VERSION = "1.0.0";
const SYNC_DELAY_MS = 2000;

// ------------------------------------------------------------- routes
// [pattern, view, nav section, isForm (don't re-render while typing)]
const ROUTES = [
    ["", overviewView, "overview"],
    ["activity", activityView, "activity"],
    ["add", transactionFormView, "add", true],
    ["tx/:id", transactionFormView, "activity", true],
    ["budget", budgetView, "overview", true],
    ["cards", cardsView, "debt"],
    ["card/new", cardFormView, "debt", true],
    ["card/:id/edit", cardEditView, "debt", true],
    ["card/:id/record", cardRecordView, "debt", true],
    ["record", cardRecordView, "debt", true],
    ["card-activity/:id", cardActivityEditView, "debt", true],
    ["loans", loansView, "debt"],
    ["loan/new", loanFormView, "debt", true],
    ["loan/:id", loanDetailView, "debt"],
    ["loan/:id/edit", loanFormView, "debt", true],
    ["loan/:id/pay", loanPaymentView, "debt", true],
    ["assets", assetsView, "assets"],
    ["asset/new", assetFormView, "assets", true],
    ["asset/:id/edit", assetFormView, "assets", true],
    ["asset/:id/value", assetValueView, "assets", true],
    ["stock/new", stockFormView, "assets", true],
    ["stock/:id", stockFormView, "assets", true],
    ["cash", cashFormView, "assets", true],
    ["settings", settingsView, "settings"],
    ["category/new", categoryFormView, "settings", true],
    ["category/:id", categoryFormView, "settings", true],
    ["category/:id/delete", categoryDeleteView, "settings", true],
    ["category/:id/sub/new", subcategoryFormView, "settings", true],
    ["sub/:id", subcategoryFormView, "settings", true],
    ["sub/:id/delete", subcategoryDeleteView, "settings", true],
    ["account/new", accountFormView, "settings", true],
    ["account/:id", accountFormView, "settings", true],
    ["import-csv", csvImportView, "settings", true],
    ["finnhub", finnhubView, "settings", true],
];

function matchRoute(path) {
    const parts = path.split("/").filter(Boolean);
    for (const [pattern, view, nav, isForm] of ROUTES) {
        const want = pattern.split("/").filter(Boolean);
        if (want.length !== parts.length) continue;
        const params = {};
        if (want.every((w, i) => (w.startsWith(":") ? ((params[w.slice(1)] = decodeURIComponent(parts[i])), true) : w === parts[i]))) {
            return { view, nav, isForm: !!isForm, params };
        }
    }
    return { view: overviewView, nav: "overview", isForm: false, params: {} };
}

function currentRoute() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [path, search = ""] = hash.split("?");
    return { ...matchRoute(path), query: Object.fromEntries(new URLSearchParams(search)), hash };
}

let route = null;
const $view = document.getElementById("view");

/** Show the screen for the current address. keepScroll: re-render in place. */
export function render({ keepScroll = false } = {}) {
    route = currentRoute();
    document.querySelectorAll("[data-nav]").forEach((el) => el.classList.toggle("active", el.dataset.nav === route.nav));
    document.querySelector(".tab-add")?.classList.toggle("active", route.nav === "add");
    const y = window.scrollY;
    try {
        route.view({ el: $view, params: route.params, query: route.query, rerender: () => render({ keepScroll: true }) });
    } catch (error) {
        console.error(error);
        $view.innerHTML = `<section class="card"><div class="empty"><strong>Something went wrong on this screen</strong>${String(error.message || error)}</div></section>`;
    }
    window.scrollTo(0, keepScroll ? y : 0);
    renderChip();
}

export function navigate(hash, { replace = false } = {}) {
    if (replace) {
        history.replaceState(null, "", `#${hash.replace(/^#/, "")}`);
        render();
    } else if (location.hash === `#${hash.replace(/^#/, "")}`) {
        render();
    } else {
        location.hash = hash.replace(/^#/, "");
    }
}

window.addEventListener("hashchange", () => { closeSheet(); render(); });

// ------------------------------------------------------------- sync

const sync = { running: false, again: false, error: "", dirty: false, lastAt: null, lastMs: null, timer: null };
export const syncState = sync;

export function scheduleSync(delay = SYNC_DELAY_MS) {
    clearTimeout(sync.timer);
    sync.timer = setTimeout(runSync, delay);
}

export async function runSync() {
    const token = auth.token();
    if (!token || !navigator.onLine) { renderChip(); return; }
    if (sync.running) { sync.again = true; return; }
    sync.running = true;
    sync.error = "";
    renderChip();
    const revision = store.revision;
    const started = performance.now();
    try {
        const { pulled } = await syncNow(token);
        sync.lastAt = Date.now();
        sync.lastMs = Math.round(performance.now() - started);
        await db.setMeta("lastSyncAt", sync.lastAt);
        if (store.revision === revision) {
            sync.dirty = false;
            await db.setMeta("dirty", false);
        } else {
            sync.again = true;
        }
        if (pulled) {
            await store.load();
            if (!route?.isForm) render({ keepScroll: true });
            toast(`${pulled} update${pulled === 1 ? "" : "s"} from your other devices`);
        } else if (route?.nav === "settings" && !route.isForm) {
            render({ keepScroll: true });
        }
    } catch (error) {
        if (error instanceof drive.AuthError) auth.clearToken();
        else sync.error = error.message || String(error);
    } finally {
        sync.running = false;
        renderChip();
        if (sync.again) { sync.again = false; scheduleSync(300); }
    }
}

/** Go to Google for a (silent if possible) sign-in, then come back to this screen. */
export function startSignIn({ silent = false } = {}) {
    try { localStorage.setItem("fd_return_route", location.hash || "#/"); } catch { /* ignore */ }
    auth.signIn({ silent });
}

store.onChange(() => {
    sync.dirty = true;
    scheduleSync();
    renderChip();
});

function chipState() {
    if (!auth.isConfigured()) return { text: "On this device only", state: "idle", action: "settings" };
    if (!auth.wasSignedIn()) return { text: "Sign in to sync", state: "attention", action: "settings" };
    if (sync.running) return { text: "Syncing…", state: "busy" };
    if (!navigator.onLine) return { text: sync.dirty ? "Offline · will sync later" : "Offline", state: "idle" };
    if (!auth.token()) return { text: sync.dirty ? "Changes waiting · tap to sync" : "Tap to sync", state: "attention", action: "renew" };
    if (sync.error) return { text: "Sync failed · tap to retry", state: "error", action: "sync" };
    if (sync.dirty) return { text: "Saving…", state: "busy" };
    if (sync.lastAt) return { text: `Synced ${timeAgo(sync.lastAt).replace(" minutes", " min").replace(" minute", " min").replace(" hours", " hr").replace(" hour", " hr")}`, state: "ok", action: "sync" };
    return { text: "Ready to sync", state: "idle", action: "sync" };
}

export function renderChip() {
    const chip = chipState();
    document.querySelectorAll("[data-sync-chip]").forEach((el) => {
        el.textContent = chip.text;
        el.dataset.state = chip.state;
        el.dataset.action = chip.action || "";
        el.title = sync.error || chip.text;
    });
}

document.querySelectorAll("[data-sync-chip]").forEach((el) => el.addEventListener("click", () => {
    const action = el.dataset.action;
    if (action === "settings") navigate("/settings");
    else if (action === "renew") startSignIn({ silent: !auth.needsTap() });
    else if (action === "sync") runSync();
}));

// ------------------------------------------------------------- stock prices

let refreshing = false;
/** Refresh stale prices in the background (Overview and Assets call this). */
export async function refreshQuotesIfStale() {
    if (refreshing || !navigator.onLine || !quotes.apiKey() || !store.all("stocks").length) return;
    refreshing = true;
    try {
        const result = await quotes.refreshAll();
        if (result.updated || result.failed) {
            if (route && !route.isForm && (route.nav === "assets" || route.nav === "overview")) render({ keepScroll: true });
        }
    } finally {
        refreshing = false;
    }
}

// ------------------------------------------------------------- start-up

export const timings = {};

function wantsAutoRenew() {
    let off = false;
    try { off = localStorage.getItem("fd_auto_renew") === "0"; } catch { /* ignore */ }
    return !off && navigator.onLine && auth.canAutoRenew();
}

async function boot() {
    initSheet();
    const redirect = auth.handleRedirect();
    if (redirect) {
        let back = "#/";
        try { back = localStorage.getItem("fd_return_route") || "#/"; localStorage.removeItem("fd_return_route"); } catch { /* ignore */ }
        history.replaceState(null, "", location.pathname + location.search + back);
    }
    await store.load();
    sync.dirty = !!(await db.getMeta("dirty"));
    sync.lastAt = await db.getMeta("lastSyncAt");
    render();
    timings.ready = Math.round(performance.now());

    if (redirect?.kind === "error" && !redirect.silent) {
        toast(redirect.error === "access_denied" ? "Google sign-in was cancelled" : `Google sign-in failed (${redirect.error})`, "error");
    }
    if (redirect?.kind === "token" && !auth.account()) {
        drive.whoAmI(auth.token()).then((who) => {
            if (who) { auth.setAccount(who); if (route?.nav === "settings" && !route.isForm) render({ keepScroll: true }); }
        });
    }

    if (auth.token()) runSync();
    else if (wantsAutoRenew()) setTimeout(() => startSignIn({ silent: true }), 150);

    let hiddenAt = null;
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
        const away = hiddenAt ? Date.now() - hiddenAt : 0;
        if (auth.token()) {
            if (!sync.lastAt || Date.now() - sync.lastAt > 30000) runSync();
        } else if (away > 5 * 60 * 1000 && !route?.isForm && wantsAutoRenew()) {
            startSignIn({ silent: true });
        }
        renderChip();
        if (away > 60000) refreshQuotesIfStale();
    });
    window.addEventListener("online", () => { renderChip(); runSync(); });
    window.addEventListener("offline", renderChip);
    setInterval(renderChip, 30000);

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
        // When a new version finishes installing, switch to it right away
        // unless you're in the middle of filling in a form.
        const hadController = !!navigator.serviceWorker.controller;
        let reloading = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (!hadController || reloading) return;
            if (route?.isForm) { toast("A new version is ready — it loads next time you open the app."); return; }
            reloading = true;
            location.reload();
        });
        navigator.serviceWorker.register("sw.js").catch(() => { /* offline mode unavailable */ });
    }
}

boot();
