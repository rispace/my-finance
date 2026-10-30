// Importing data:
//  1. the JSON backup from the Django web app (Settings → Full backup), and
//  2. this app's own backup ("Download full backup"), for restoring.
//
// Web-app records get ids derived from the web app's ids ("tx-123") and the
// backup's export time as their updatedAt. So importing the same backup
// twice, or on two devices, gives identical records instead of duplicates.

import { toCents, toDecimal, fold, isDay } from "./util.js";
import { toMilli, quoteId, INVESTMENT_CASH_ID } from "./calc.js";
import { COLLECTIONS } from "./db.js";

export const LEGACY_PAYMENT_LABELS = {
    chase_credit: "Chase credit", chase_debit: "Chase debit", amex: "Amex",
    boa: "Bank of America", discover: "Discover", citibank: "Citibank",
    capital_one: "Capital One", wells_fargo: "Wells Fargo", csb: "CSB",
    credit_card: "Credit card", debit_card: "Debit card", cash: "Cash",
    bank_transfer: "Bank transfer", other: "Other",
};

export const STARTER_CATEGORIES = {
    "Housing": ["Rent / Mortgage", "Utilities", "Insurance", "Maintenance", "Furniture"],
    "Food": ["Groceries", "Dining out", "Coffee"],
    "Transportation": ["Fuel", "Loan payment", "Insurance", "Maintenance", "Public transit"],
    "Bills & Subscriptions": ["Phone", "Internet", "Streaming", "Software"],
    "Personal": ["Health", "Clothing", "Grooming", "Entertainment", "Education"],
    "Family & Giving": ["Family support", "Gifts", "Donations"],
    "Travel": ["Flights", "Lodging", "Activities"],
};
export const STARTER_ACCOUNTS = [["Cash", "cash"], ["Debit card", "debit"], ["Credit card", "credit"]];

export { toCents };

const key = (text) => fold(String(text || "").trim());
const slug = (text) => key(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const emptyChanges = () => Object.fromEntries(COLLECTIONS.map((n) => [n, []]));
const noonIso = (day) => `${day}T12:00:00.000Z`;

/** Decide which importer a parsed file needs. */
export function buildImport(backup, live) {
    if (backup && backup.format === "finance-drive-export" && backup.data) return buildRestore(backup);
    if (backup && backup.format === "personal-finance-backup" && Array.isArray(backup.transactions)) return buildWebImport(backup, live);
    throw new Error("This isn't a backup from the Personal Finance web app or from this app.");
}

/** This app's own backup: records already have ids and timestamps. */
function buildRestore(backup) {
    const changes = emptyChanges();
    for (const name of COLLECTIONS) {
        const records = backup.data[name];
        if (!Array.isArray(records)) continue;
        changes[name] = records.filter((r) => r && typeof r.id === "string" && typeof r.updatedAt === "number");
    }
    const summary = Object.fromEntries(COLLECTIONS.map((n) => [n, changes[n].length]));
    return { changes, summary: { ...summary, skipped: 0, notImported: [], kind: "restore" } };
}

function buildWebImport(backup, live) {
    const stamp = Date.parse(backup.exported_at) || Date.now();
    const createdFallback = new Date(stamp).toISOString();
    const changes = emptyChanges();

    // Reuse what's already on the device when names match, so importing on
    // top of your own categories doesn't create look-alike duplicates.
    const categoryByName = new Map(live.categories.map((c) => [key(c.name), c.id]));
    const subByName = new Map(live.subcategories.map((s) => [`${s.categoryId}|${key(s.name)}`, s.id]));
    const accountByName = new Map(live.accounts.map((a) => [key(a.name), a.id]));
    const stockBySymbol = new Map((live.stocks || []).map((s) => [s.symbol, s.id]));

    const addCategory = (name, id) => {
        if (categoryByName.has(key(name))) return categoryByName.get(key(name));
        categoryByName.set(key(name), id);
        changes.categories.push({ id, updatedAt: stamp, name: name.trim() });
        return id;
    };
    const addSub = (categoryId, name, id) => {
        const k = `${categoryId}|${key(name)}`;
        if (subByName.has(k)) return subByName.get(k);
        subByName.set(k, id);
        changes.subcategories.push({ id, updatedAt: stamp, categoryId, name: name.trim() });
        return id;
    };
    const addAccount = (name, id, kind = "other", archived = false) => {
        if (accountByName.has(key(name))) return accountByName.get(key(name));
        accountByName.set(key(name), id);
        changes.accounts.push({ id, updatedAt: stamp, name: name.trim(), kind: kind || "other", archived: !!archived });
        return id;
    };

    // ---- categories, subcategories, payment methods
    const categoryNameById = new Map();
    for (const c of backup.categories || []) {
        categoryNameById.set(c.id, c.name);
        addCategory(c.name, `cat-${c.id}`);
    }
    for (const s of backup.subcategories || []) {
        const categoryName = categoryNameById.get(s.category_id);
        if (categoryName) addSub(categoryByName.get(key(categoryName)), s.name, `sub-${s.id}`);
    }
    for (const a of backup.payment_methods || []) addAccount(a.name, `acc-${a.id}`, a.kind, a.is_archived);

    // ---- transactions
    let skipped = 0;
    const seen = new Set();
    for (const t of backup.transactions) {
        const amountCents = toCents(t.amount);
        if (!isDay(t.date) || !amountCents || amountCents <= 0) { skipped += 1; continue; }
        const categoryName = (t.category__name || "Uncategorized").trim();
        const categoryId = addCategory(categoryName, `cat-n-${slug(categoryName)}`);
        const subcategoryId = t.subcategory__name
            ? addSub(categoryId, t.subcategory__name, `sub-n-${slug(categoryName)}-${slug(t.subcategory__name)}`)
            : null;
        const accountName = t.payment_account__name || LEGACY_PAYMENT_LABELS[t.payment_method] || "";
        const accountId = accountName ? addAccount(accountName, `acc-n-${slug(accountName)}`) : null;
        const id = `tx-${t.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        changes.transactions.push({
            id, updatedAt: stamp, date: t.date,
            description: String(t.description || "Imported").slice(0, 200),
            amountCents, categoryId, subcategoryId, accountId,
            notes: String(t.notes || ""),
            createdAt: t.created_at || createdFallback,
        });
    }

    // ---- credit cards, activity, limit history
    for (const c of backup.credit_cards || []) {
        changes.cards.push({
            id: `card-${c.id}`, updatedAt: stamp, name: String(c.name).trim(),
            limitCents: toCents(c.credit_limit) || 0, openingCents: toCents(c.opening_balance) || 0,
            openingDate: c.opening_date, createdAt: noonIso(c.opening_date),
        });
    }
    for (const a of backup.credit_card_activity || []) {
        changes.cardActivity.push({
            id: `cact-${a.id}`, updatedAt: stamp, cardId: `card-${a.card_id}`, date: a.date,
            description: String(a.description || ""), changeCents: toCents(a.change) || 0,
            createdAt: a.created_at || noonIso(a.date),
        });
    }
    for (const l of backup.credit_limit_changes || []) {
        changes.limitChanges.push({
            id: `clim-${l.id}`, updatedAt: stamp, cardId: `card-${l.card_id}`, date: l.date,
            oldCents: toCents(l.old_limit) || 0, newCents: toCents(l.new_limit) || 0,
            note: String(l.note || ""), createdAt: l.created_at || noonIso(l.date),
        });
    }

    // ---- loans and payments
    for (const l of backup.loans || []) {
        changes.loans.push({
            id: `loan-${l.id}`, updatedAt: stamp, name: String(l.name || "Car loan").trim(), kind: l.kind || "auto",
            financedCents: toCents(l.amount_financed) || 0, aprMilli: toMilli(l.apr) ?? 0,
            monthlyCents: toCents(l.monthly_payment) || 0, termMonths: Number(l.term_months) || 0,
            openingCents: toCents(l.opening_balance) || 0, openingDate: l.opening_date,
            createdAt: noonIso(l.opening_date),
        });
    }
    for (const p of backup.loan_payments || []) {
        changes.loanPayments.push({
            id: `lpay-${p.id}`, updatedAt: stamp, loanId: `loan-${p.loan_id}`, date: p.date,
            totalCents: toCents(p.total) || 0, interestCents: toCents(p.interest) || 0,
            feesCents: toCents(p.fees) || 0, principalCents: toCents(p.principal) || 0,
            createdAt: p.created_at || noonIso(p.date),
        });
    }

    // ---- investments
    for (const s of backup.stocks || []) {
        const symbol = String(s.symbol || "").trim().toUpperCase();
        if (!symbol) continue;
        const id = stockBySymbol.get(symbol) || `stk-${symbol}`;
        stockBySymbol.set(symbol, id);
        const liveStock = (live.stocks || []).find((x) => x.id === id);
        changes.stocks.push({
            ...(liveStock?.purchases ? { purchases: liveStock.purchases } : {}),
            id, updatedAt: stamp, symbol,
            shares: toDecimal(s.shares) ?? 0, averageCost: toDecimal(s.average_cost) ?? 0,
            createdAt: createdFallback,
        });
        const price = toDecimal(s.last_price);
        if (price !== null) {
            changes.quotes.push({
                id: quoteId(symbol), updatedAt: stamp, symbol, price,
                date: s.quote_date || null, source: s.quote_source || "",
                checkedAt: stamp, failed: false, error: "", attemptAt: stamp,
            });
        }
    }
    const cash = (backup.investment_cash || [])[0];
    if (cash) changes.prefs.push({ id: INVESTMENT_CASH_ID, updatedAt: stamp, balanceCents: toCents(cash.balance) || 0 });

    // ---- budgets and assets (included by newer web-app backups)
    for (const b of backup.budgets || []) {
        const month = String(b.month || "").slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const name = String(b.name || "").trim();
        const id = budgetId(month, name);
        const note = (live.budgets || []).find((x) => x.id === id)?.note;
        changes.budgets.push({ id, updatedAt: stamp, month, name, amountCents: toCents(b.amount) || 0, ...(note ? { note } : {}) });
    }
    for (const a of backup.assets || []) {
        changes.assets.push({
            id: `asset-${a.id}`, updatedAt: stamp, name: String(a.name || "").trim(), kind: a.kind || "other",
            valueCents: toCents(a.value) || 0, valueDate: a.value_date, purchaseDate: a.purchase_date || null,
            purchaseCents: a.purchase_price != null ? toCents(a.purchase_price) : null,
            loanId: a.loan_id ? `loan-${a.loan_id}` : null, notes: String(a.notes || ""),
            createdAt: a.created_at || createdFallback,
        });
    }
    for (const v of backup.asset_valuations || []) {
        changes.assetValuations.push({
            id: `aval-${v.id}`, updatedAt: stamp, assetId: `asset-${v.asset_id}`, date: v.date,
            valueCents: toCents(v.value) || 0, note: String(v.note || ""), createdAt: v.created_at || noonIso(v.date),
        });
    }

    return {
        changes,
        summary: {
            kind: "web",
            transactions: changes.transactions.length,
            categories: changes.categories.length,
            subcategories: changes.subcategories.length,
            accounts: changes.accounts.length,
            cards: changes.cards.length,
            cardActivity: changes.cardActivity.length,
            limitChanges: changes.limitChanges.length,
            loans: changes.loans.length,
            loanPayments: changes.loanPayments.length,
            stocks: changes.stocks.length,
            budgets: changes.budgets.length,
            assets: changes.assets.length,
            skipped,
            hasBudgetsAndAssets: "budgets" in backup || "assets" in backup,
            notImported: [],
        },
    };
}

/** One record per month and line name, so two devices never duplicate a line. */
export function budgetId(month, name) {
    return `bud-${month}-${name ? encodeURIComponent(key(name)) : "overall"}`;
}

/** Starter categories for someone starting from scratch. */
export function buildStarter(newId) {
    const now = Date.now();
    const changes = emptyChanges();
    for (const [name, subs] of Object.entries(STARTER_CATEGORIES)) {
        const id = newId();
        changes.categories.push({ id, updatedAt: now, name });
        for (const sub of subs) changes.subcategories.push({ id: newId(), updatedAt: now, categoryId: id, name: sub });
    }
    for (const [name, kind] of STARTER_ACCOUNTS) {
        changes.accounts.push({ id: newId(), updatedAt: now, name, kind, archived: false });
    }
    return changes;
}
