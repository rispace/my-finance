// Minimal Google Drive v3 client for the hidden "appDataFolder".
// Only this app can see files there; you can remove them any time from
// Google Drive → Settings → Manage apps.

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const FILE_NAME = "finance-data.json";

export class AuthError extends Error {}
export class NotFoundError extends Error {}

async function call(token, url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
        });
    } catch {
        throw new Error("Couldn't reach Google Drive. Check your connection.");
    }
    if (response.status === 401) throw new AuthError("Google sign-in expired.");
    if (response.status === 404) throw new NotFoundError("Sync file not found.");
    if (!response.ok) {
        let detail = "";
        try { detail = (await response.json())?.error?.message || ""; } catch { /* ignore */ }
        if (response.status === 403 && /has not been used|disabled/i.test(detail)) {
            throw new Error("The Google Drive API isn't enabled for this app's Google Cloud project.");
        }
        throw new Error(`Google Drive error ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response;
}

/** The sync file's { id, version }, or null if it doesn't exist yet. */
export async function findFile(token) {
    const params = new URLSearchParams({
        spaces: "appDataFolder",
        q: `name = '${FILE_NAME}' and trashed = false`,
        fields: "files(id, version, modifiedTime)",
        orderBy: "modifiedTime desc",
        pageSize: "10",
    });
    const { files } = await (await call(token, `${API}/files?${params}`)).json();
    return files && files.length ? { id: files[0].id, version: files[0].version } : null;
}

export async function getVersion(token, fileId) {
    const response = await call(token, `${API}/files/${fileId}?fields=version`);
    return (await response.json()).version;
}

export async function download(token, fileId) {
    const response = await call(token, `${API}/files/${fileId}?alt=media`);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

export async function create(token, payload) {
    const boundary = "fd" + Math.random().toString(16).slice(2);
    const metadata = { name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" };
    const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n` +
        `--${boundary}--`;
    const response = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id,version`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
    });
    return response.json();
}

export async function update(token, fileId, payload) {
    const response = await call(token, `${UPLOAD}/files/${fileId}?uploadType=media&fields=id,version`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return response.json();
}

/** Who is signed in (shown in Settings). Returns null if Google won't say. */
export async function whoAmI(token) {
    try {
        const response = await call(token, `${API}/about?fields=user(emailAddress,displayName)`);
        const { user } = await response.json();
        return user ? { email: user.emailAddress, name: user.displayName } : null;
    } catch {
        return null;
    }
}
