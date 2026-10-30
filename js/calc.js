// All the money math, ported from the Django app's views (views.py,
// budget_views.py, debt_views.py, debt_forms.py, investment_views.py,
// asset_views.py). Pure functions over plain arrays, unit-tested in Node.
//
// `data` is { collection: [live records] } (tombstones already removed).

import {
    PALETTE, byName, fold, monthOf, shiftMonth, monthIndex, daysInMonth, daysBetween,
    donutSegments, localDayOf, fmtDayLong, isDay,
} from "./util.js";

export const QUOTE_MAX_AGE_MS = 15 * 60 * 1000;

export const ACCOUNT_KINDS = [["credit", "Credit card"], ["debit", "Debit card / checking"], ["cash", "Cash"], ["other", "Other"]];
export const LOAN_KINDS = [["auto", "Car loan"], ["mortgage", "Mortgage / home loan"], ["student", "Student loan"], ["personal", "Personal loan"], ["other", "Other loan"]];
export const ASSET_KINDS = [["vehicle", "Vehicle"], ["property", "Home / property"], ["cash", "Cash / savings"], ["other", "Other"]];
export const CARD_ACTIONS = [
    ["charge", "New charge / purchase"],
    ["payment", "Payment"],
    ["refund", "Refund"],
    ["interest", "Interest / fee"],
    ["increase", "Balance correction — increase"],
    ["decrease", "Balance correction — decrease"],
];
export const label = (pairs, key) => (pairs.find(([k]) => k === key) || [key, key])[1];

const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) || 0), 0);

// ------------------------------------------------------------ categories

/** Colour per category, by alphabetical position (same as the web app). */
export function categoryColors(categories) {
    const colors = new Map();
    [...categories].sort(byName).forEach((c, i) => colors.set(c.id, PALETTE[i % PALETTE.length]));
    return colors;
}

/** Newest first by date, then by when it was added. */
export function byDateDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
}

// ------------------------------------------------------------ dashboard

export function monthOptions(transactions, selected, todayMonth) {
    let first = selected, last = selected;
    for (const m of [todayMonth, ...transactions.map((t) => monthOf(t.date))]) {
        if (m < first) first = m;
        if (m > last) last = m;
    }
    const options = [];
    for (let m = last; m >= first; m = shiftMonth(m, -1)) options.push(m);
    return options;
}

export function dashboard(data, month, todayDay) {
    const { transactions, categories, subcategories } = data;
    const colors = categoryColors(categories);
    const inMonth = transactions.filter((t) => monthOf(t.date) === month);
    const monthTotal = sum(inMonth, (t) => t.amountCents);

    const spentBy = new Map();
    for (const t of inMonth) spentBy.set(t.categoryId, (spentBy.get(t.categoryId) || 0) + t.amountCents);
    const categoryTotals = categories.map((c) => ({
        category: c,
        color: colors.get(c.id),
        spent: spentBy.get(c.id) || 0,
    })).sort((a, b) => b.spent - a.spent || byName(a.category, b.category));
    for (const row of categoryTotals) row.share = monthTotal ? (row.spent / monthTotal) * 100 : 0;
    const largest = Math.max(0, ...categoryTotals.map((r) => r.spent));
    const donut = donutSegments(categoryTotals.map((r) => ({ label: r.category.name, value: r.spent, color: r.color, key: r.category.id })), monthTotal);

    const previousMonth = shiftMonth(month, -1);
    const previousTotal = sum(transactions.filter((t) => monthOf(t.date) === previousMonth), (t) => t.amountCents);
    const changePct = previousTotal ? ((monthTotal - previousTotal) / previousTotal) * 100 : null;

    // 12 months ending with the selected one.
    const chartMonths = [];
    for (let i = 11; i >= 0; i--) chartMonths.push(shiftMonth(month, -i));
    const chartSet = new Set(chartMonths);
    const history = new Map(); // "catId|month" -> cents
    const monthTotals = new Map(chartMonths.map((m) => [m, 0]));
    for (const t of transactions) {
        const m = monthOf(t.date);
        if (!chartSet.has(m)) continue;
        const key = `${t.categoryId}|${m}`;
        history.set(key, (history.get(key) || 0) + t.amountCents);
        monthTotals.set(m, monthTotals.get(m) + t.amountCents);
    }
    const trendMax = Math.max(0, ...monthTotals.values());
    const trend = chartMonths.map((m) => ({
        month: m,
        total: monthTotals.get(m),
        height: trendMax ? (monthTotals.get(m) / trendMax) * 100 : 0,
        selected: m === month,
    }));
    const withData = trend.filter((t) => t.total > 0);
    const averageMonth = withData.length ? Math.round(sum(withData, (t) => t.total) / withData.length) : 0;

    // Per-category detail sheets: subcategories this month + 12-month history.
    const pairTotals = new Map();
    for (const t of inMonth) {
        const key = `${t.categoryId}|${t.subcategoryId || ""}`;
        pairTotals.set(key, (pairTotals.get(key) || 0) + t.amountCents);
    }
    for (const row of categoryTotals) {
        const subs = subcategories.filter((s) => s.categoryId === row.category.id);
        const rows = subs.map((s) => ({ name: s.name, total: pairTotals.get(`${row.category.id}|${s.id}`) || 0 }));
        const unassigned = row.spent - sum(rows, (r) => r.total);
        if (unassigned) rows.push({ name: "No subcategory", total: unassigned });
        rows.sort((a, b) => b.total - a.total);
        rows.forEach((r, i) => {
            r.color = PALETTE[i % PALETTE.length];
            r.share = row.spent ? (r.total / row.spent) * 100 : 0;
        });
        row.monthlyRows = rows;
        row.donut = donutSegments(rows.map((r) => ({ label: r.name, value: r.total, color: r.color })), row.spent);
        row.historyRows = chartMonths.map((m) => ({ month: m, total: history.get(`${row.category.id}|${m}`) || 0 }));
        row.historyMax = Math.max(0, ...row.historyRows.map((r) => r.total));
        row.historyTotal = sum(row.historyRows, (r) => r.total);
    }

    const debt = debtData(data);
    const folio = portfolio(data);
    const investmentsValue = folio.totalValue !== null ? folio.totalValue : folio.pricedValue + folio.cashBalance;
    const hasInvestments = folio.holdings.length > 0 || folio.cashRecorded;
    const assets = liveAssets(data).sort(assetOrder);
    const assetsValue = sum(assets, (a) => a.valueCents);
    const recent = [...transactions].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 6);

    return {
        month,
        previousMonth,
        isCurrentMonth: month === monthOf(todayDay),
        monthEnd: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
        monthTotal,
        monthCount: inMonth.length,
        categoryTotals,
        largest,
        donut,
        previousTotal,
        changePct,
        trend,
        averageMonth,
        recent,
        colors,
        debt,
        portfolio: folio,
        investmentsValue,
        hasInvestments,
        assets,
        assetsValue,
        totalAssets: assetsValue + investmentsValue,
        netWorth: assetsValue + investmentsValue - debt.totalDebt,
        hasCategories: categories.length > 0,
        budget: budgetSummary(data, month, categoryTotals, monthTotal, todayDay),
        monthOptions: monthOptions(transactions, month, monthOf(todayDay)),
    };
}

// ------------------------------------------------------------ budget

export const budgetTerms = (name) => name.split(",").map((t) => t.trim()).filter(Boolean);

export function levelFor(spent, budget) {
    if (!budget) return spent ? "high" : "low";
    const ratio = spent / budget;
    return ratio > 1 ? "high" : ratio >= 0.85 ? "mid" : "low";
}

/** Transactions matched by a typed budget line: category, then subcategory, then words. */
export function matchBudgetLine(name, expenses, categoriesById, subcategoriesById) {
    const matched = new Map();
    const how = [];
    for (const term of budgetTerms(name)) {
        const key = fold(term);
        let hits = expenses.filter((e) => fold(categoriesById.get(e.categoryId)?.name) === key);
        let kind = "category";
        if (!hits.length) {
            hits = expenses.filter((e) => e.subcategoryId && fold(subcategoriesById.get(e.subcategoryId)?.name) === key);
            kind = "subcategory";
        }
        if (!hits.length) {
            hits = expenses.filter((e) => fold(e.description).includes(key) || fold(e.notes).includes(key));
            kind = "description";
        }
        if (hits.length) {
            how.push(kind);
            for (const e of hits) matched.set(e.id, e);
        }
    }
    return { matched: [...matched.values()], how };
}

/** "Bank of America" -> "boa" */
const initialsOf = (name) => fold(name).split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join("");

/** A credit card a budget line is named after: "AMEX", "Chase", "BoA" (Bank of America). */
export function cardForBudgetLine(name, cards) {
    for (const term of budgetTerms(name)) {
        const t = fold(term).trim();
        if (t.length < 2) continue;
        const card = cards.find((c) => fold(c.name) === t)
            || (t.length >= 3 && cards.find((c) => fold(c.name).startsWith(`${t} `) || t.startsWith(`${fold(c.name)} `)))
            || cards.find((c) => initialsOf(c.name).length > 1 && initialsOf(c.name) === t);
        if (card) return card;
    }
    return null;
}

/** Card payments that belong to a month's budget (their own budget month, else their date). */
export const isCardPayment = (a) => a.changeCents < 0 && /^payment\b/i.test(a.description || "");
export const paymentBudgetMonth = (a) => a.budgetMonth || monthOf(a.date);

export function budgetLinesFor(data, month) {
    return data.budgets.filter((b) => b.month === month);
}

export function budgetSummary(data, month, categoryTotals, monthTotal, todayDay) {
    const lines = budgetLinesFor(data, month);
    if (!lines.length) return null;
    const expenses = data.transactions.filter((t) => monthOf(t.date) === month);
    const categoriesById = new Map(data.categories.map((c) => [c.id, c]));
    const subcategoriesById = new Map(data.subcategories.map((s) => [s.id, s]));
    const colorByName = new Map(categoryTotals.map((r) => [fold(r.category.name), r.color]));
    const palette = PALETTE.slice(0, 8);

    const covered = new Set();
    const overallLine = lines.find((b) => !b.name);
    const named = lines.filter((b) => b.name).sort((a, b) => a.name.localeCompare(b.name));
    const payments = (data.cardActivity || []).filter((a) => isCardPayment(a) && paymentBudgetMonth(a) === month);
    const rows = named.map((line, index) => {
        const { matched, how } = matchBudgetLine(line.name, expenses, categoriesById, subcategoriesById);
        matched.forEach((e) => covered.add(e.id));
        const fromTransactions = sum(matched, (e) => e.amountCents);
        // Paying a card named in the line ("AMEX", "BoA") counts too.
        const card = cardForBudgetLine(line.name, data.cards || []);
        const cardPaid = card ? -sum(payments.filter((a) => a.cardId === card.id), (a) => a.changeCents) : 0;
        if (cardPaid) how.push("card payment");
        let spent = fromTransactions + cardPaid;
        // "Mark paid": counts the full budget even when nothing was recorded.
        const manual = line.paid && spent < line.amountCents ? line.amountCents - spent : 0;
        spent += manual;
        const firstTerm = fold(budgetTerms(line.name)[0] || "");
        return {
            id: line.id,
            name: line.name,
            note: line.note || "",
            paid: !!line.paid,
            card,
            cardPaid,
            manual,
            extra: cardPaid + manual, // spending that isn't in the transactions list
            budget: line.amountCents,
            spent,
            remaining: line.amountCents - spent,
            pct: line.amountCents ? (spent / line.amountCents) * 100 : (spent ? 100 : 0),
            // A bill paid in full (marked, or by card payment) is done, not a warning.
            level: (line.paid || (cardPaid && spent === line.amountCents)) ? "low" : levelFor(spent, line.amountCents),
            color: colorByName.get(firstTerm) || palette[index % palette.length],
            matched: matched.length + (cardPaid ? 1 : 0) + (manual ? 1 : 0),
            how,
        };
    }).sort((a, b) => b.pct - a.pct);
    // Card payments and lines marked paid count toward the month as well.
    monthTotal += sum(rows, (r) => r.extra);

    const linesSum = sum(rows, (r) => r.budget);
    const overall = overallLine ? overallLine.amountCents : linesSum;
    const unbudgeted = sum(expenses.filter((e) => !covered.has(e.id)), (e) => e.amountCents);

    const todayMonth = monthOf(todayDay);
    const days = daysInMonth(month);
    const dayOfMonth = Number(todayDay.slice(8, 10));
    const elapsed = month === todayMonth ? dayOfMonth / days : month < todayMonth ? 1 : 0;
    const inProgress = elapsed > 0 && elapsed < 1;
    const daysLeft = inProgress ? days - dayOfMonth + 1 : 0;

    return {
        overall,
        overallIsSum: !overallLine,
        spent: monthTotal,
        remaining: overall - monthTotal,
        pct: overall ? (monthTotal / overall) * 100 : 0,
        level: levelFor(monthTotal, overall),
        elapsedPct: elapsed * 100,
        ahead: monthTotal - overall * elapsed,
        inProgress,
        daysLeft,
        perDayLeft: inProgress && overall > monthTotal ? (overall - monthTotal) / daysLeft : null,
        rows,
        unbudgeted: rows.length ? unbudgeted : 0,
    };
}

/** The most recent month before `month` that has a budget, or null. */
export function previousBudgetMonth(budgets, month) {
    let best = null;
    for (const b of budgets) if (b.month < month && (!best || b.month > best)) best = b.month;
    return best;
}

// ------------------------------------------------------------ transactions list

export const SORTS = [
    ["added", "Recently added"],
    ["date_desc", "Date: newest first"],
    ["date_asc", "Date: oldest first"],
    ["amount_desc", "Amount: largest first"],
];

export function filterTransactions(transactions, f) {
    const q = fold(f.q || "").trim();
    return transactions.filter((t) =>
        (!q || fold(t.description).includes(q) || fold(t.notes).includes(q)) &&
        (!f.category || t.categoryId === f.category) &&
        (!f.subcategory || t.subcategoryId === f.subcategory) &&
        (!f.account || t.accountId === f.account) &&
        (!f.from || t.date >= f.from) &&
        (!f.to || t.date <= f.to));
}

export function sortTransactions(items, sort) {
    const list = [...items];
    const added = (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || (a.id < b.id ? 1 : -1);
    if (sort === "date_desc") list.sort(byDateDesc);
    else if (sort === "date_asc") list.sort((a, b) => -byDateDesc(a, b));
    else if (sort === "amount_desc") list.sort((a, b) => b.amountCents - a.amountCents || byDateDesc(a, b));
    else list.sort(added);
    return list;
}

export function groupTransactions(items, sort, todayDay) {
    const groups = [];
    const yesterday = (() => { const d = new Date(`${todayDay}T12:00:00`); d.setDate(d.getDate() - 1); return localDayOf(d.toISOString()); })();
    for (const t of items) {
        let key, title;
        if (sort === "amount_desc") {
            key = "all"; title = null;
        } else if (sort === "date_desc" || sort === "date_asc") {
            key = t.date; title = fmtDayLong(t.date);
        } else {
            key = t.createdAt ? localDayOf(t.createdAt) : t.date;
            title = key === todayDay ? "Added today" : key === yesterday ? "Added yesterday"
                : "Added " + new Date(`${key}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
        }
        if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, title, items: [], total: 0 });
        const group = groups[groups.length - 1];
        group.items.push(t);
        group.total += t.amountCents;
    }
    return groups;
}

// ------------------------------------------------------------ debt

export function cardBalance(card, activity) {
    return card.openingCents + sum(activity.filter((a) => a.cardId === card.id), (a) => a.changeCents);
}

export function loanBalance(loan, payments) {
    return loan.openingCents - sum(payments.filter((p) => p.loanId === loan.id), (p) => p.principalCents);
}

const utilizationLevel = (u) => (u >= 50 ? "high" : u >= 30 ? "mid" : "low");
const loanKindOrder = new Map(LOAN_KINDS.map(([k], i) => [k, i]));
export const loanOrder = (a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || byName(a, b) || (a.createdAt || "").localeCompare(b.createdAt || "");

export function loanRow(loan, payments) {
    const balance = loanBalance(loan, payments);
    const paid = loan.financedCents - balance;
    return {
        loan,
        balance,
        paidPct: loan.financedCents ? Math.max(Math.min((paid / loan.financedCents) * 100, 100), 0) : 0,
    };
}

export function debtData(data) {
    const cards = [...data.cards].sort(byName).map((card) => {
        const balance = cardBalance(card, data.cardActivity);
        const used = Math.max(balance, 0);
        const available = Math.max(card.limitCents - used, 0);
        const utilization = card.limitCents ? (used / card.limitCents) * 100 : 0;
        return { card, balance, used, available, utilization, barWidth: Math.min(utilization, 100), level: utilizationLevel(utilization) };
    });
    const loans = [...data.loans].sort(loanOrder).map((loan) => loanRow(loan, data.loanPayments));
    const totalUsed = sum(cards, (c) => c.used);
    const totalLimit = sum(cards, (c) => c.card.limitCents);
    const totalAvailable = sum(cards, (c) => c.available);
    const utilization = totalLimit ? (totalUsed / totalLimit) * 100 : 0;
    const loansTotal = sum(loans, (l) => l.balance);
    return {
        cards, loans, totalUsed, totalLimit, totalAvailable, utilization,
        utilizationLevel: utilizationLevel(utilization),
        loansTotal,
        totalDebt: totalUsed + loansTotal,
        hasAccounts: cards.length > 0 || loans.length > 0,
    };
}

export function filterCardActivity(activity, f) {
    return activity.filter((a) =>
        (!f.card || a.cardId === f.card) && (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to))
        .sort(byDateDesc);
}

/** Per month: charges (balance went up) vs payments & refunds (went down). */
export function monthlyCardSummary(entries) {
    const byMonth = new Map();
    for (const e of entries) {
        const m = monthOf(e.date);
        const row = byMonth.get(m) || { month: m, charges: 0, payments: 0, count: 0 };
        if (e.changeCents > 0) row.charges += e.changeCents;
        else row.payments += -e.changeCents;
        row.count += 1;
        byMonth.set(m, row);
    }
    return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).map((r) => ({ ...r, net: r.charges - r.payments }));
}

/** "9.64" -> 9640 (APR in thousandths of a percent), or null. */
export function toMilli(text) {
    const match = /^(\d+)(?:\.(\d{0,3})\d*)?$/.exec(String(text ?? "").trim().replace(/%$/, ""));
    if (!match) return null;
    return Number(match[1]) * 1000 + Number((match[2] || "").padEnd(3, "0"));
}
export const milliToText = (milli, places = 3) => (milli / 1000).toFixed(places);

/** balance × APR/100 × days/365, rounded half-up to the cent (exact, via BigInt). */
export function estimateInterest(balanceCents, aprMilli, days) {
    if (balanceCents <= 0 || days <= 0 || aprMilli <= 0) return 0;
    const numerator = BigInt(balanceCents) * BigInt(aprMilli) * BigInt(days);
    const denominator = 100n * 1000n * 365n;
    return Number((2n * numerator + denominator) / (2n * denominator));
}

export function lastLoanPayment(loan, payments) {
    return payments.filter((p) => p.loanId === loan.id).sort(byDateDesc)[0] || null;
}

/**
 * Allocate a loan payment between interest, fees and principal (same rules
 * as the web app's CarPaymentForm). input: { date, totalCents, interestFrom,
 * interestCents (null = estimate), feesCents }.
 * Returns { ok: true, interest, principal, fees, remaining, days, estimated } or { ok: false, errors }.
 */
export function allocateLoanPayment(loan, payments, input, todayDay) {
    const balance = loanBalance(loan, payments);
    const last = lastLoanPayment(loan, payments);
    const errors = [];
    if (balance <= 0) return { ok: false, errors: ["There is no remaining principal to pay."] };
    if (!isDay(input.date)) errors.push("Choose the payment date.");
    else if (input.date > todayDay) errors.push("Choose today or an earlier date.");
    if (!(input.totalCents > 0)) errors.push("Enter the installment amount.");
    const startsOn = last ? last.date : input.interestFrom;
    if (!last) {
        if (!isDay(input.interestFrom)) errors.push("Enter the date interest starts from.");
        else if (input.interestFrom > todayDay) errors.push("Interest start: choose today or an earlier date.");
    }
    if (input.interestCents !== null && input.interestCents < 0) errors.push("Interest can't be negative.");
    if (input.feesCents < 0) errors.push("Fees can't be negative.");
    if (errors.length) return { ok: false, errors };
    if (input.date < loan.openingDate) return { ok: false, errors: ["Payment cannot precede the opening balance date."] };
    if (input.date < startsOn) return { ok: false, errors: ["Payment cannot precede the previous payment or interest start date."] };

    const days = daysBetween(startsOn, input.date);
    const estimated = estimateInterest(balance, loan.aprMilli, days);
    const overridden = input.interestCents !== null;
    const interest = overridden ? input.interestCents : estimated;
    const fees = input.feesCents || 0;
    const principal = input.totalCents - interest - fees;
    if (principal < 0) {
        return { ok: false, errors: ["This payment does not cover interest and fees. This calculator does not carry unpaid interest forward; use your lender's allocation and reconcile the loan before recording a partial payment."] };
    }
    if (principal > balance) {
        return { ok: false, errors: ["Principal exceeds the remaining balance. Check the amount and lender's payoff details."] };
    }
    return { ok: true, interest, fees, principal, remaining: balance - principal, days, estimated: !overridden, balance };
}

// ------------------------------------------------------------ investments

export const quoteId = (symbol) => `q-${symbol}`;
export const INVESTMENT_CASH_ID = "investment-cash";
export const FINNHUB_PREF_ID = "finnhub";
export const CURRENCY_PREF_ID = "currency";

/**
 * Combine another purchase into a holding: shares add up and the average
 * cost becomes the share-weighted average of the old cost and the new price.
 * 2 @ 25 + 2 @ 27 -> 4 @ 26.
 */
export function combinePurchase(shares, averageCost, boughtShares, price) {
    const total = shares + boughtShares;
    if (!(total > 0)) return { shares: 0, averageCost: 0 };
    const round = (x, places) => Math.round(x * 10 ** places) / 10 ** places;
    return {
        shares: round(total, 6),
        averageCost: round((shares * averageCost + boughtShares * price) / total, 6),
    };
}

export function isStale(quote, now = Date.now()) {
    return !quote || quote.price == null || !quote.checkedAt || now - quote.checkedAt > QUOTE_MAX_AGE_MS;
}
export function recentlyAttempted(quote, now = Date.now()) {
    return !!(quote && quote.failed && quote.attemptAt && now - quote.attemptAt < QUOTE_MAX_AGE_MS);
}

export function portfolio(data, now = Date.now()) {
    const quotes = new Map(data.quotes.map((q) => [q.id, q]));
    const cash = data.prefs.find((p) => p.id === INVESTMENT_CASH_ID);
    const cashBalance = cash ? cash.balanceCents || 0 : 0;
    const holdings = [...data.stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((stock) => {
        const quote = quotes.get(quoteId(stock.symbol)) || null;
        const invested = Math.round(stock.shares * stock.averageCost * 100);
        const price = quote && quote.price != null ? quote.price : null;
        const marketValue = price === null ? null : Math.round(stock.shares * price * 100);
        const gainLoss = marketValue === null ? null : marketValue - invested;
        return { stock, quote, price, invested, marketValue, gainLoss };
    });
    const totalInvested = sum(holdings, (h) => h.invested);
    const missingQuotes = holdings.filter((h) => h.price === null).length;
    const pricedValue = sum(holdings, (h) => h.marketValue);
    const complete = missingQuotes === 0;
    const gainLoss = complete ? pricedValue - totalInvested : null;
    for (const h of holdings) {
        h.weight = pricedValue && h.marketValue !== null ? (h.marketValue / pricedValue) * 100 : null;
        h.gainPct = h.gainLoss !== null && h.invested ? (h.gainLoss / h.invested) * 100 : null;
    }
    const checked = holdings.map((h) => h.quote?.checkedAt).filter(Boolean);
    return {
        holdings,
        totalInvested,
        pricedValue,
        missingQuotes,
        complete,
        cashBalance,
        cashRecorded: !!cash,
        cashUpdatedAt: cash ? cash.updatedAt : null,
        totalValue: complete ? pricedValue + cashBalance : null,
        gainLoss,
        gainPct: gainLoss !== null && totalInvested ? (gainLoss / totalInvested) * 100 : null,
        hasFailedRefresh: holdings.some((h) => h.quote?.failed),
        needsRefresh: holdings.some((h) => isStale(h.quote, now) && !recentlyAttempted(h.quote, now)),
        lastChecked: checked.length ? Math.max(...checked) : null,
    };
}

// ------------------------------------------------------------ assets

const assetKindOrder = (k) => k;
export const assetOrder = (a, b) => (assetKindOrder(a.kind) < assetKindOrder(b.kind) ? -1 : a.kind > b.kind ? 1 : 0) || byName(a, b);

/** Which optional fields make sense for each asset type. */
// ------------------------------------------------- bank-linked cash assets
//
// A "Cash / savings" asset can be linked to bank accounts / debit cards from
// the payment-method list. Its balance then starts from the value you last
// entered and moves with what happens in those accounts afterwards:
// spending paid from them takes money out, earnings deposited into them add it.

/** Payment-method kinds that hold money (not credit cards). */
export const BANK_ACCOUNT_KINDS = ["debit", "cash", "other"];

/** Where an earning's money went: [{ accountId, amountCents }]. */
export function depositsOf(e) {
    if (Array.isArray(e.splits) && e.splits.length) return e.splits.filter((s) => s.accountId);
    return e.accountId ? [{ accountId: e.accountId, amountCents: e.amountCents }] : [];
}

/** Did this happen after the balance was last set? Same-day items count if added later. */
function afterAnchor(item, asset) {
    if (item.date > asset.valueDate) return true;
    return item.date === asset.valueDate && !!asset.valueSetAt && (item.createdAt || "") > asset.valueSetAt;
}

/** Live balance of a linked cash asset, with what moved it. */
export function linkedBalance(asset, data) {
    const linked = new Set(asset.kind === "cash" && Array.isArray(asset.accountIds) ? asset.accountIds : []);
    if (!linked.size) return null;
    const items = [];
    for (const t of data.transactions) {
        if (linked.has(t.accountId) && afterAnchor(t, asset)) items.push({ kind: "spend", id: t.id, date: t.date, label: t.description, accountId: t.accountId, amountCents: -t.amountCents });
    }
    for (const e of data.earnings) {
        if (!afterAnchor(e, asset)) continue;
        for (const d of depositsOf(e)) {
            if (linked.has(d.accountId)) items.push({ kind: "deposit", id: e.id, date: e.date, label: e.description, accountId: d.accountId, amountCents: d.amountCents });
        }
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    const spent = -sum(items.filter((i) => i.kind === "spend"), (i) => i.amountCents);
    const deposited = sum(items.filter((i) => i.kind === "deposit"), (i) => i.amountCents);
    return { startCents: asset.valueCents, startDate: asset.valueDate, spent, deposited, valueCents: asset.valueCents - spent + deposited, items };
}

/** Assets with linked cash balances brought up to date (valueCents = live value). */
export function liveAssets(data) {
    return data.assets.map((a) => {
        const flow = linkedBalance(a, data);
        return flow ? { ...a, valueCents: flow.valueCents, flow } : a;
    });
}

export const ASSET_FIELDS_BY_KIND = {
    vehicle: ["purchaseDate", "purchaseCents", "loanId"],
    property: ["purchaseDate", "purchaseCents", "loanId"],
    cash: [],
    other: ["purchaseDate", "purchaseCents"],
};

export function assetRows(data) {
    return liveAssets(data).sort(assetOrder).map((asset) => {
        const loan = asset.loanId ? data.loans.find((l) => l.id === asset.loanId) : null;
        const loanBal = loan ? loanBalance(loan, data.loanPayments) : null;
        const change = asset.purchaseCents ? asset.valueCents - asset.purchaseCents : null;
        const history = data.assetValuations.filter((v) => v.assetId === asset.id).sort(byDateDesc).slice(0, 6);
        return {
            asset,
            loan,
            loanBalance: loanBal,
            equity: loanBal !== null ? asset.valueCents - loanBal : null,
            change,
            changePct: change !== null && asset.purchaseCents ? (change / asset.purchaseCents) * 100 : null,
            history,
        };
    });
}

/** After a valuation is added or removed: the newest dated one is the current value. */
export function currentValuation(valuations, assetId) {
    return valuations.filter((v) => v.assetId === assetId).sort(byDateDesc)[0] || null;
}

// ------------------------------------------------------------ misc

export function uniqueName(list, name, exceptId, scope = () => true) {
    const key = fold(name);
    return !list.some((item) => item.id !== exceptId && scope(item) && fold(item.name) === key);
}

export { monthIndex };

// ------------------------------------------------------------ earnings

export const EARNING_TYPES = [
    ["salary", "Salary / wages"],
    ["side", "Side income / freelance"],
    ["investment", "Interest & dividends"],
    ["refund", "Refunds & reimbursements"],
    ["gift", "Gifts"],
    ["other", "Other"],
];
export const EARNING_COLORS = { salary: "#2f6f4f", side: "#3b82c4", investment: "#8b5cc6", refund: "#d08a2c", gift: "#c2558f", other: "#6b7a8f" };

export function filterEarnings(earnings, f) {
    const q = fold(f.q || "").trim();
    return earnings.filter((e) =>
        (!q || fold(e.description).includes(q) || fold(e.notes).includes(q)) &&
        (!f.type || e.type === f.type) &&
        (!f.account || depositsOf(e).some((d) => d.accountId === f.account)) &&
        (!f.from || e.date >= f.from) &&
        (!f.to || e.date <= f.to));
}

/** Monthly earnings picture: totals, 12-month earned-vs-spent trend, by type. */
export function earningsSummary(data, month, todayDay) {
    const sumIn = (list, m) => sum(list.filter((x) => monthOf(x.date) === m), (x) => x.amountCents);
    const inMonth = data.earnings.filter((e) => monthOf(e.date) === month);
    const monthTotal = sum(inMonth, (e) => e.amountCents);
    const previousMonth = shiftMonth(month, -1);
    const previousTotal = sumIn(data.earnings, previousMonth);
    const spent = sumIn(data.transactions, month);
    const year = month.slice(0, 4);
    const yearToDate = sum(data.earnings.filter((e) => e.date.slice(0, 4) === year && monthOf(e.date) <= month), (e) => e.amountCents);

    const trend = [];
    for (let i = 11; i >= 0; i--) {
        const m = shiftMonth(month, -i);
        trend.push({ month: m, earned: sumIn(data.earnings, m), spent: sumIn(data.transactions, m), selected: m === month });
    }
    const trendMax = Math.max(0, ...trend.map((t) => Math.max(t.earned, t.spent)));
    for (const t of trend) {
        t.earnedHeight = trendMax ? (t.earned / trendMax) * 100 : 0;
        t.spentHeight = trendMax ? (t.spent / trendMax) * 100 : 0;
        t.saved = t.earned - t.spent;
    }
    const withData = trend.filter((t) => t.earned > 0);
    const averageMonth = withData.length ? Math.round(sum(withData, (t) => t.earned) / withData.length) : 0;

    const byType = EARNING_TYPES.map(([key, name]) => {
        const total = sum(inMonth.filter((e) => (e.type || "other") === key), (e) => e.amountCents);
        return { key, name, total, color: EARNING_COLORS[key], share: monthTotal ? (total / monthTotal) * 100 : 0 };
    }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total);

    const saved = monthTotal - spent;
    return {
        month, previousMonth, monthTotal, monthCount: inMonth.length, previousTotal,
        changePct: previousTotal ? ((monthTotal - previousTotal) / previousTotal) * 100 : null,
        spent, saved, savingsRate: monthTotal ? (saved / monthTotal) * 100 : null,
        yearToDate, averageMonth, trend, byType,
        isCurrentMonth: month === monthOf(todayDay),
        monthEnd: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
        monthOptions: monthOptions([...data.earnings, ...data.transactions], month, monthOf(todayDay)),
    };
}
