// Import the JSON backup downloaded from the Django web app
// (Settings → Full backup). This proof of concept imports categories,
// subcategories, payment methods and transactions; cards, loans and
// investments come later.
//
// Records get ids derived from the web app's ids ("tx-123"), and their
// updatedAt is the backup's export time. So importing the same backup on
// two devices produces identical records instead of duplicates.

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

/** "12.34" / "$1,234.5" -> cents (integer), or null if not a valid amount. */
export function toCents(value) {
    const text = String(value ?? "").replace(/[$,\s]/g, "");
    const match = /^(-)?(\d*)(?:\.(\d{0,2})\d*)?$/.exec(text);
    if (!match || (match[2] === "" && !match[3])) return null;
    const cents = Number(match[2] || 0) * 100 + Number((match[3] || "").padEnd(2, "0"));
    return match[1] ? -cents : cents;
}

const key = (text) => String(text || "").trim().toLowerCase();
const slug = (text) => key(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";

/**
 * backup: parsed JSON. live: current records on this device { name: [records] }.
 * Returns { changes: { name: [records] }, summary }.
 */
export function buildImport(backup, live) {
    if (!backup || backup.format !== "personal-finance-backup" || !Array.isArray(backup.transactions)) {
        throw new Error("This isn't a backup from the Personal Finance web app (Settings → Full backup).");
    }
    const stamp = Date.parse(backup.exported_at) || Date.now();
    const changes = { categories: [], subcategories: [], accounts: [], transactions: [] };

    // Reuse what's already on the device when names match, so an import on
    // top of your own categories doesn't create look-alike duplicates.
    const categoryByName = new Map(live.categories.map((c) => [key(c.name), c.id]));
    const subByName = new Map(live.subcategories.map((s) => [`${s.categoryId}|${key(s.name)}`, s.id]));
    const accountByName = new Map(live.accounts.map((a) => [key(a.name), a.id]));
    const seen = new Set();

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
        changes.accounts.push({ id, updatedAt: stamp, name: name.trim(), kind, archived: !!archived });
        return id;
    };

    const categoryNameById = new Map();
    for (const c of backup.categories || []) {
        categoryNameById.set(c.id, c.name);
        addCategory(c.name, `cat-${c.id}`);
    }
    for (const s of backup.subcategories || []) {
        const categoryName = categoryNameById.get(s.category_id);
        if (!categoryName) continue;
        addSub(categoryByName.get(key(categoryName)), s.name, `sub-${s.id}`);
    }
    for (const a of backup.payment_methods || []) {
        addAccount(a.name, `acc-${a.id}`, a.kind, a.is_archived);
    }

    let skipped = 0;
    for (const t of backup.transactions) {
        const amountCents = toCents(t.amount);
        if (!t.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || !amountCents || amountCents <= 0) {
            skipped += 1;
            continue;
        }
        const categoryName = (t.category__name || "Uncategorized").trim();
        const categoryId = addCategory(categoryName, `cat-n-${slug(categoryName)}`);
        let subcategoryId = null;
        if (t.subcategory__name) {
            subcategoryId = addSub(categoryId, t.subcategory__name, `sub-n-${slug(categoryName)}-${slug(t.subcategory__name)}`);
        }
        const accountName = t.payment_account__name || LEGACY_PAYMENT_LABELS[t.payment_method] || "";
        const accountId = accountName ? addAccount(accountName, `acc-n-${slug(accountName)}`) : null;
        const id = `tx-${t.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        changes.transactions.push({
            id,
            updatedAt: stamp,
            date: t.date,
            description: String(t.description || "Imported").slice(0, 200),
            amountCents,
            categoryId,
            subcategoryId,
            accountId,
            notes: String(t.notes || ""),
            createdAt: t.created_at || new Date(stamp).toISOString(),
        });
    }

    const notImported = ["credit_cards", "credit_card_activity", "loans", "loan_payments", "stocks"]
        .filter((name) => Array.isArray(backup[name]) && backup[name].length);
    return {
        changes,
        summary: {
            categories: changes.categories.length,
            subcategories: changes.subcategories.length,
            accounts: changes.accounts.length,
            transactions: changes.transactions.length,
            skipped,
            notImported,
        },
    };
}

/** Starter categories for someone starting from scratch. */
export function buildStarter(newId) {
    const now = Date.now();
    const changes = { categories: [], subcategories: [], accounts: [], transactions: [] };
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
