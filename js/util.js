// Small shared helpers: escaping, money, percentages, dates, colours.
// Money is always stored as integer cents to avoid floating-point drift.

export const PALETTE = [
    "#2f6f4f", "#3b82c4", "#d08a2c", "#8b5cc6",
    "#cc5a4f", "#2a9d9b", "#c2558f", "#6b7a8f",
    "#7aa33b", "#b5793e",
];

export function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ----------------------------------------------------------------- money

const formatters = new Map();
function currency(places) {
    if (!formatters.has(places)) {
        formatters.set(places, new Intl.NumberFormat("en-US", {
            style: "currency", currency: "USD", minimumFractionDigits: places, maximumFractionDigits: places,
        }));
    }
    return formatters.get(places);
}

/** 123456 -> "$1,234.56"; null -> "—" (same as the web app's |money filter). */
export function money(cents, places = 2) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
    return currency(places).format(cents / 100);
}

export function signedMoney(cents, places = 2) {
    if (cents === null || cents === undefined || Number.isNaN(cents)) return "—";
    return (cents > 0 ? "+" : "") + money(cents, places);
}

/** Plain number with grouping, e.g. 0.317177 -> "0.317177". */
export function num(value, maxPlaces = 6) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: maxPlaces });
}

export function pct(value, places = 1) {
    if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return "—";
    return Number(value).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places }) + "%";
}

export function signedPct(value, places = 1) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return (value > 0 ? "+" : "") + pct(value, places);
}

/** Clamp to 0–100 for CSS widths. */
export function cssPct(value) {
    const n = Number(value) || 0;
    return Math.max(0, Math.min(100, n)).toFixed(2);
}

/**
 * Parse money typed by a person: "12.34", "$1,234.5", "-50" -> cents.
 * Returns null when it isn't a number. Extra decimals are cut, not rounded.
 */
export function toCents(value) {
    const text = String(value ?? "").replace(/[$,\s]/g, "");
    const match = /^([-+])?(\d*)(?:\.(\d*))?$/.exec(text);
    if (!match || (match[2] === "" && !match[3])) return null;
    const cents = Number(match[2] || 0) * 100 + Number((match[3] || "").slice(0, 2).padEnd(2, "0"));
    return match[1] === "-" ? -cents : cents;
}

/** Cents -> "1234.56" for form inputs. */
export function centsToInput(cents) {
    if (cents === null || cents === undefined) return "";
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parse a decimal like "0.3171770000" -> number, or null. */
export function toDecimal(value) {
    const text = String(value ?? "").replace(/[$,\s]/g, "");
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
}

// ----------------------------------------------------------------- dates
// Days are "YYYY-MM-DD" strings and months "YYYY-MM", in your local time.

export function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const monthOf = (day) => day.slice(0, 7);
export const isDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text || "") && !Number.isNaN(dateObj(text).getTime());
export const isMonth = (text) => /^\d{4}-(0[1-9]|1[0-2])$/.test(text || "");

export function dateObj(day) {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d || 1);
}

export function shiftMonth(month, delta) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthIndex(month) {
    const [y, m] = month.split("-").map(Number);
    return y * 12 + (m - 1);
}

export function daysBetween(fromDay, toDay) {
    return Math.round((Date.UTC(...toDay.split("-").map((v, i) => (i === 1 ? v - 1 : +v))) -
        Date.UTC(...fromDay.split("-").map((v, i) => (i === 1 ? v - 1 : +v)))) / 86400000);
}

export function daysInMonth(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
}

const fmt = (day, options) => dateObj(day).toLocaleDateString("en-US", options);
export const fmtMonthLong = (month) => fmt(`${month}-01`, { month: "long", year: "numeric" });
export const fmtMonthName = (month) => fmt(`${month}-01`, { month: "long" });
export const fmtMonthShort = (month) => fmt(`${month}-01`, { month: "short" });
export const fmtMonthYearShort = (month) => fmt(`${month}-01`, { month: "short", year: "2-digit" }).replace(" ", " '");
export const fmtMonthYear = (month) => fmt(`${month}-01`, { month: "short", year: "numeric" });
export const fmtDay = (day) => day ? fmt(day, { month: "short", day: "numeric", year: "numeric" }) : "—";
export const fmtDayNoYear = (day) => fmt(day, { month: "short", day: "numeric" });
export const fmtDayLong = (day) => fmt(day, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
export const fmtDayFull = (day) => fmt(day, { month: "long", day: "numeric", year: "numeric" });

export function fmtDateTime(iso) {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Local calendar day of an ISO timestamp. */
export function localDayOf(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function timeAgo(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 45) return "just now";
    if (s < 90) return "1 minute ago";
    if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
    if (s < 5400) return "1 hour ago";
    if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
    const days = Math.round(s / 86400);
    return days === 1 ? "1 day ago" : `${days} days ago`;
}

// ----------------------------------------------------------------- misc

export function initials(name) {
    const words = String(name).replace(/&/g, " ").split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
    return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";
}

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;
export const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
export const fold = (text) => String(text || "").toLocaleLowerCase();
export const squash = (text) => String(text || "").split(/\s+/).filter(Boolean).join(" ");

export function newId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** SVG ring segments for a donut chart. items: [{ label, value, color, key }]. */
export function donutSegments(items, total) {
    const positive = items.filter((i) => i.value > 0);
    if (!total || !positive.length) return [];
    const outer = 50, inner = 33, c = 50;
    const point = (r, f) => {
        const a = f * 2 * Math.PI - Math.PI / 2;
        return [c + r * Math.cos(a), c + r * Math.sin(a)];
    };
    const arc = (f0, f1) => {
        const large = f1 - f0 > 0.5 ? 1 : 0;
        const [x0, y0] = point(outer, f0), [x1, y1] = point(outer, f1);
        const [x2, y2] = point(inner, f1), [x3, y3] = point(inner, f0);
        const f = (n) => n.toFixed(3);
        return `M${f(x0)} ${f(y0)}A${outer} ${outer} 0 ${large} 1 ${f(x1)} ${f(y1)}` +
            `L${f(x2)} ${f(y2)}A${inner} ${inner} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
    };
    let start = 0;
    return positive.map((item) => {
        const end = Math.min(start + item.value / total, 1);
        const path = end - start >= 0.9999 ? arc(0, 0.5) + arc(0.5, 0.99999) : arc(start, end);
        const segment = { ...item, share: (item.value / total) * 100, path };
        start = end;
        return segment;
    });
}
