// Google sign-in for a server-less web app.
//
// We use Google's OAuth "token" redirect flow: the page goes to Google and
// comes straight back with a 1-hour access token in the URL fragment.
// When the token expires, we renew it *silently* (prompt=none): if you are
// still signed in to Google in this browser, Google redirects back
// immediately without showing anything. If it can't (signed out, cookies
// cleared), the app asks for one tap instead.
//
// Only the drive.appdata scope is requested: the app can read and write its
// own hidden folder in your Drive, and nothing else.

const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const KEYS = {
    token: "fd_token",            // { accessToken, expiresAt }
    account: "fd_account",        // { email, name }
    signedIn: "fd_signed_in",     // "1" once you have signed in on this device
    pending: "fd_oauth_pending",  // { state, silent, startedAt }
    needsTap: "fd_needs_tap",     // silent renewal failed; wait for a tap
    lastSilent: "fd_last_silent", // { startedAt, ms, ok, error } for diagnostics
    silentAttemptAt: "fd_silent_attempt_at",
};
const SILENT_RETRY_MS = 2 * 60 * 1000; // never auto-redirect more often than this

function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
    try {
        if (value === null || value === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage unavailable: sync just won't persist sign-in */ }
}

export function clientId() {
    return (window.FINANCE_CONFIG && window.FINANCE_CONFIG.googleClientId) || "";
}

export function isConfigured() {
    const id = clientId();
    return id.endsWith(".apps.googleusercontent.com") && !id.startsWith("PASTE-");
}

/** The exact page address Google sends you back to (must be registered in Google Cloud). */
export function redirectUri() {
    return location.origin + location.pathname.replace(/index\.html$/, "");
}

export function wasSignedIn() { return read(KEYS.signedIn) === 1; }
export function account() { return read(KEYS.account); }
export function setAccount(value) { write(KEYS.account, value); }
export function needsTap() { return read(KEYS.needsTap) === 1; }
export function lastSilent() { return read(KEYS.lastSilent); }

/** A still-valid access token, or null. */
export function token() {
    const saved = read(KEYS.token);
    if (!saved || !saved.accessToken || Date.now() >= saved.expiresAt) return null;
    return saved.accessToken;
}

export function tokenExpiresAt() {
    const saved = read(KEYS.token);
    return saved ? saved.expiresAt : null;
}

export function clearToken() { write(KEYS.token, null); }

/** True if an automatic silent renewal is worth trying right now. */
export function canAutoRenew() {
    if (!isConfigured() || !wasSignedIn() || needsTap() || token()) return false;
    const last = read(KEYS.silentAttemptAt) || 0;
    return Date.now() - last > SILENT_RETRY_MS;
}

function randomState() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Go to Google. silent=true tries prompt=none (no UI if you're signed in);
 * otherwise Google shows the account chooser / consent screen as needed.
 */
export function signIn({ silent = false } = {}) {
    const state = randomState();
    write(KEYS.pending, { state, silent, startedAt: Date.now() });
    if (silent) write(KEYS.silentAttemptAt, Date.now());
    const params = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(),
        response_type: "token",
        scope: SCOPE,
        include_granted_scopes: "true",
        state,
    });
    const known = account();
    if (silent) {
        params.set("prompt", "none");
        if (known?.email) params.set("login_hint", known.email);
    } else if (known?.email) {
        params.set("login_hint", known.email);
    } else {
        params.set("prompt", "select_account");
    }
    location.assign(`${AUTH_URL}?${params}`);
}

/**
 * Call once at start-up. If we just came back from Google, store the token
 * (or note the failure) and clean the address bar.
 * Returns null, { kind: "token", silent, ms } or { kind: "error", silent, error }.
 */
export function handleRedirect() {
    const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
    if (!hash || !/(access_token|error)=/.test(hash)) return null;
    const params = new URLSearchParams(hash);
    history.replaceState(null, "", location.pathname + location.search);

    const pending = read(KEYS.pending);
    write(KEYS.pending, null);
    if (!pending || params.get("state") !== pending.state) {
        return { kind: "error", silent: false, error: "state_mismatch" };
    }
    const ms = Date.now() - pending.startedAt;

    if (params.get("access_token")) {
        const seconds = Number(params.get("expires_in")) || 3600;
        write(KEYS.token, {
            accessToken: params.get("access_token"),
            // renew a minute early so a sync never starts with a dying token
            expiresAt: Date.now() + (seconds - 60) * 1000,
        });
        write(KEYS.signedIn, 1);
        write(KEYS.needsTap, null);
        if (pending.silent) write(KEYS.lastSilent, { at: Date.now(), ms, ok: true });
        return { kind: "token", silent: pending.silent, ms };
    }

    const error = params.get("error") || "unknown_error";
    if (pending.silent) {
        write(KEYS.needsTap, 1);
        write(KEYS.lastSilent, { at: Date.now(), ms, ok: false, error });
    }
    return { kind: "error", silent: pending.silent, error };
}

/** Forget the Google connection on this device (data on the device stays). */
export async function signOut() {
    const current = read(KEYS.token);
    for (const key of Object.values(KEYS)) write(key, null);
    if (current?.accessToken) {
        try {
            await fetch("https://oauth2.googleapis.com/revoke", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({ token: current.accessToken }),
            });
        } catch { /* offline: the token simply expires within the hour */ }
    }
}
