// CSV export (same columns as the web app, so files open in Excel/Numbers and
// can be re-imported) and CSV import of transactions.

import { centsToInput, toCents, isDay, fold } from "./util.js";

export const TRANSACTION_HEADERS = ["Date", "Description", "Amount (USD)", "Category", "Subcategory", "Payment Method", "Notes"];
export const ACTIVITY_HEADERS = ["Date", "Card", "Description", "Type", "Amount (USD)", "Balance change (USD)", "Added on"];

/** Keep user text from being run as a spreadsheet formula. */
function safe(value) {
    let text = String(value ?? "");
    if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers, rows) {
    // A BOM helps Excel recognise UTF-8.
    return "﻿" + [headers, ...rows].map((row) => row.map((v, i) => (typeof v === "number" ? String(v) : safe(v))).join(",")).join("\r\n") + "\r\n";
}

export function transactionsCsv(items, lookup) {
    return toCsv(TRANSACTION_HEADERS, items.map((t) => [
        t.date,
        t.description,
        centsToInput(t.amountCents),
        lookup.category(t.categoryId),
        lookup.subcategory(t.subcategoryId),
        lookup.account(t.accountId),
        t.notes || "",
    ]));
}

export function cardActivityCsv(entries, cardName) {
    return toCsv(ACTIVITY_HEADERS, entries.map((e) => [
        e.date,
        cardName(e.cardId),
        e.description,
        e.changeCents > 0 ? "Charge" : "Payment / refund",
        centsToInput(Math.abs(e.changeCents)),
        centsToInput(e.changeCents),
        e.createdAt ? new Date(e.createdAt).toLocaleString("sv-SE").slice(0, 16) : "",
    ]));
}

/** RFC-4180-ish parser: quotes, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    const input = text.replace(/^﻿/, "");
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (quoted) {
            if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && input[i + 1] === "\n") i++;
            row.push(field); rows.push(row); row = []; field = "";
        } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * Turn a transactions CSV into new records. Missing categories, subcategories
 * and payment methods are created. Same rules as the web app's importer.
 * Returns { changes, created, skipped, errors }.
 */
export function buildCsvImport(text, live, { skipDuplicates = true, newId }) {
    const rows = parseCsv(text);
    const header = (rows.shift() || []).map((h) => h.trim());
    const col = (name) => header.indexOf(name);
    const missing = ["Date", "Description", "Amount (USD)", "Category"].filter((h) => col(h) < 0);
    if (missing.length) return { errors: [`Missing column(s): ${missing.join(", ")}.`], created: 0, skipped: 0 };

    const now = new Date().toISOString();
    const changes = { categories: [], subcategories: [], accounts: [], transactions: [] };
    const categories = new Map(live.categories.map((c) => [fold(c.name), c.id]));
    const subs = new Map(live.subcategories.map((s) => [`${s.categoryId}|${fold(s.name)}`, s.id]));
    const accounts = new Map(live.accounts.map((a) => [fold(a.name), a.id]));
    const existing = new Set(live.transactions.map((t) => `${t.date}|${t.description}|${t.amountCents}`));
    const errors = [];
    let created = 0, skipped = 0;

    rows.forEach((row, index) => {
        const value = (name) => (col(name) >= 0 ? (row[col(name)] || "").trim() : "");
        const line = index + 2;
        const date = value("Date");
        const amountCents = toCents(value("Amount (USD)"));
        if (!isDay(date) || !amountCents || amountCents <= 0) {
            errors.push(`Row ${line}: needs a YYYY-MM-DD date and a positive amount.`);
            return;
        }
        const description = value("Description").slice(0, 200) || "Imported";
        let notes = value("Notes");
        if (notes.startsWith("'")) notes = notes.slice(1);
        const dupKey = `${date}|${description}|${amountCents}`;
        if (skipDuplicates && existing.has(dupKey)) { skipped += 1; return; }
        existing.add(dupKey);

        const categoryName = value("Category").slice(0, 60) || "Uncategorized";
        let categoryId = categories.get(fold(categoryName));
        if (!categoryId) {
            categoryId = newId();
            categories.set(fold(categoryName), categoryId);
            changes.categories.push({ id: categoryId, name: categoryName });
        }
        let subcategoryId = null;
        const subName = value("Subcategory").slice(0, 60);
        if (subName) {
            subcategoryId = subs.get(`${categoryId}|${fold(subName)}`);
            if (!subcategoryId) {
                subcategoryId = newId();
                subs.set(`${categoryId}|${fold(subName)}`, subcategoryId);
                changes.subcategories.push({ id: subcategoryId, categoryId, name: subName });
            }
        }
        let accountId = null;
        const accountName = value("Payment Method").slice(0, 60);
        if (accountName && accountName !== "—") {
            accountId = accounts.get(fold(accountName));
            if (!accountId) {
                accountId = newId();
                accounts.set(fold(accountName), accountId);
                changes.accounts.push({ id: accountId, name: accountName, kind: "other", archived: false });
            }
        }
        changes.transactions.push({ id: newId(), date, description, amountCents, categoryId, subcategoryId, accountId, notes, createdAt: now });
        created += 1;
    });
    return { changes, created, skipped, errors };
}

/** Save a text file: the share sheet on phones, a download elsewhere. */
export async function saveFile(name, text, type = "text/csv") {
    const blob = new Blob([text], { type });
    const file = typeof File === "function" ? new File([blob], name, { type }) : null;
    const touch = matchMedia("(pointer: coarse)").matches;
    if (touch && file && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: name });
            return;
        } catch (error) {
            if (error?.name === "AbortError") return;
        }
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}
