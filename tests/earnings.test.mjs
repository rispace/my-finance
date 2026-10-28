import assert from "node:assert/strict";
import { earningsSummary, filterEarnings, EARNING_TYPES } from "../js/calc.js";
import { earningsCsv, buildEarningsCsvImport } from "../js/csv.js";
import { COLLECTIONS } from "../js/db.js";

const empty = Object.fromEntries(COLLECTIONS.map((n) => [n, []]));
const e = (id, date, cents, type = "salary", extra = {}) => ({ id, date, description: `Pay ${id}`, amountCents: cents, type, accountId: null, notes: "", createdAt: `${date}T12:00:00Z`, ...extra });
const t = (id, date, cents) => ({ id, date, description: "x", amountCents: cents, categoryId: "c", createdAt: `${date}T12:00:00Z` });
const data = {
    ...empty,
    earnings: [e("1", "2026-10-01", 250000), e("2", "2026-10-15", 250000), e("3", "2026-10-20", 1234, "investment"), e("4", "2026-09-15", 400000), e("5", "2025-12-15", 100000)],
    transactions: [t("a", "2026-10-03", 300000), t("b", "2026-09-03", 500000)],
};
const s = earningsSummary(data, "2026-10", "2026-10-28");
assert.equal(s.monthTotal, 501234);
assert.equal(s.previousTotal, 400000);
assert.equal(s.changePct.toFixed(2), (101234 / 400000 * 100).toFixed(2));
assert.equal(s.spent, 300000);
assert.equal(s.saved, 201234);
assert.equal(s.savingsRate.toFixed(2), (201234 / 501234 * 100).toFixed(2));
assert.equal(s.yearToDate, 901234);                       // Dec 2025 excluded
assert.equal(s.averageMonth, Math.round((501234 + 400000 + 100000) / 3));
assert.equal(s.trend.length, 12);
assert.deepEqual(s.trend.at(-2), { month: "2026-09", earned: 400000, spent: 500000, selected: false, earnedHeight: 400000 / 501234 * 100, spentHeight: 500000 / 501234 * 100, saved: -100000 });
assert.deepEqual(s.byType.map((r) => [r.key, r.total]), [["salary", 500000], ["investment", 1234]]);
assert.equal(filterEarnings(data.earnings, { type: "investment" }).length, 1);
assert.equal(filterEarnings(data.earnings, { q: "pay 4" }).length, 1);
assert.equal(filterEarnings(data.earnings, { from: "2026-10-01", to: "2026-10-31" }).length, 3);
const csv = earningsCsv(data.earnings, (k) => EARNING_TYPES.find(([x]) => x === k)[1], () => "Chase debit");
let n = 0;
const imp = buildEarningsCsvImport(csv, empty, { newId: () => `n${n++}`, types: EARNING_TYPES });
assert.deepEqual(imp.errors, []);
assert.equal(imp.created, 5);
assert.equal(imp.changes.accounts.length, 1);
assert.deepEqual(imp.changes.earnings.map((x) => x.type), ["salary", "salary", "investment", "salary", "salary"]);
assert.equal(buildEarningsCsvImport(csv, { ...empty, earnings: data.earnings }, { newId: () => "z", types: EARNING_TYPES }).created, 0);
assert.match(buildEarningsCsvImport("Date,Amount (USD)\n", empty, { newId: () => "z", types: EARNING_TYPES }).errors[0], /Missing column/);
console.log("earnings unit tests passed");
