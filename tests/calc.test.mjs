import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as calc from "../js/calc.js";
import { buildImport, budgetId } from "../js/importer.js";
import { toCents, donutSegments, daysBetween } from "../js/util.js";
import { buildCsvImport, parseCsv, transactionsCsv } from "../js/csv.js";
import { mergeData } from "../js/merge.js";
import { COLLECTIONS } from "../js/db.js";

const backup = JSON.parse(readFileSync(new URL("./fixture-backup.json", import.meta.url), "utf8"));
const empty = Object.fromEntries(COLLECTIONS.map((n) => [n, []]));
const { changes, summary } = buildImport(backup, empty);
assert.equal(summary.transactions, 400); assert.equal(summary.cards, 3); assert.equal(summary.loans, 1); assert.equal(summary.stocks, 2);
const data = changes; // live arrays

// --- debt (compare with Decimal results)
const debt = calc.debtData(data);
const bal = Object.fromEntries(debt.cards.map((c) => [c.card.name, c.balance]));
assert.deepEqual(bal, { "Capital One": 721119, "Chase": 53163, "Discover": 780153 });
assert.equal(debt.totalUsed, 1554435);
assert.equal(debt.utilization.toFixed(1), "68.0");
assert.equal(debt.utilizationLevel, "high");
assert.equal(debt.loans[0].balance, 2776302);
assert.equal(debt.loans[0].paidPct.toFixed(1), "0.8");
assert.equal(debt.totalDebt, 1554435 + 2776302);
assert.equal(data.loans[0].aprMilli, 9640);

// --- loan payment allocation
const loan = data.loans[0];
const r = calc.allocateLoanPayment(loan, data.loanPayments, { date: "2026-10-31", totalCents: 50003, interestFrom: "", interestCents: null, feesCents: 0 }, "2026-11-01");
assert.ok(r.ok, JSON.stringify(r));
assert.equal(r.days, 31); assert.equal(r.interest, 22731); assert.equal(r.principal, 50003 - 22731); assert.equal(r.remaining, 2776302 - (50003 - 22731));
assert.equal(calc.allocateLoanPayment(loan, data.loanPayments, { date: "2026-09-29", totalCents: 50003, interestCents: null, feesCents: 0 }, "2026-11-01").ok, false);
assert.match(calc.allocateLoanPayment(loan, data.loanPayments, { date: "2026-10-31", totalCents: 100, interestCents: null, feesCents: 0 }, "2026-11-01").errors[0], /does not cover interest/);
assert.match(calc.allocateLoanPayment(loan, data.loanPayments, { date: "2026-12-31", totalCents: 50003, interestCents: null, feesCents: 0 }, "2026-11-01").errors[0], /today or an earlier/);
const firstLoan = { ...loan, id: "L2" };
assert.match(calc.allocateLoanPayment(firstLoan, [], { date: "2026-10-01", totalCents: 50003, interestFrom: "", interestCents: null, feesCents: 0 }, "2026-11-01").errors[0], /interest starts/i);
const fr = calc.allocateLoanPayment(firstLoan, [], { date: "2026-10-13", totalCents: 50003, interestFrom: "2026-09-13", interestCents: 28815, feesCents: 0 }, "2026-11-01");
assert.equal(fr.principal, 21188); assert.equal(fr.estimated, false);
// half-up rounding exactness
assert.equal(calc.estimateInterest(36500, 1000, 1), 1);   // 365.00*1%/365 = 0.01
assert.equal(calc.estimateInterest(18250, 1000, 1), 1);   // 0.005 -> 0.01 (half up)
assert.equal(calc.estimateInterest(18249, 1000, 1), 0);

// --- portfolio
const folio = calc.portfolio(data, Date.parse(backup.exported_at) + 1000);
assert.equal(folio.totalInvested, 15752); assert.equal(folio.pricedValue, 15777); assert.equal(folio.totalValue, 17027);
assert.equal(folio.gainLoss, 25); assert.equal(folio.cashBalance, 1250);
assert.equal(calc.portfolio(data, Date.parse(backup.exported_at) + 16 * 60000).needsRefresh, true);

// --- card summary
const s = calc.monthlyCardSummary(calc.filterCardActivity(data.cardActivity, {}));
assert.deepEqual(s.map((x) => [x.month, x.charges, x.payments, x.net]), [["2026-10", 3053, 0, 3053], ["2026-09", 41226, 51829, -10603]]);

// --- dashboard
const d = calc.dashboard(data, "2026-10", "2026-10-28");
const octTotal = data.transactions.filter((t) => t.date.startsWith("2026-10")).reduce((a, t) => a + t.amountCents, 0);
assert.equal(d.monthTotal, octTotal);
assert.equal(d.categoryTotals.reduce((a, r) => a + r.spent, 0), octTotal);
assert.equal(d.trend.length, 12); assert.equal(d.trend[11].month, "2026-10"); assert.equal(d.trend[0].month, "2025-11");
for (const row of d.categoryTotals) assert.equal(row.monthlyRows.reduce((a, x) => a + x.total, 0), row.spent);
assert.equal(d.netWorth, 0 + 17027 - (1554435 + 2776302));
assert.equal(d.recent.length, 6);
assert.ok(d.monthOptions[0] >= "2026-10" && d.monthOptions.at(-1) === "2025-09");
assert.equal(d.budget, null);
// donut segments cover 100%
assert.ok(Math.abs(d.donut.reduce((a, x) => a + x.share, 0) - 100) < 1e-6);
assert.equal(donutSegments([{ label: "a", value: 5, color: "#000" }], 5)[0].path.split("M").length, 3); // full ring = 2 arcs

// --- budget (port of budget_summary)
const food = data.categories.find((c) => c.name === "Food");
const budgets = [
  { id: budgetId("2026-10", ""), month: "2026-10", name: "", amountCents: 300000 },
  { id: budgetId("2026-10", "Food"), month: "2026-10", name: "Food", amountCents: 50000 },
  { id: budgetId("2026-10", "Netflix, Haircut"), month: "2026-10", name: "Netflix, Haircut", amountCents: 3000 },
  { id: budgetId("2026-10", "Walmart"), month: "2026-10", name: "Walmart", amountCents: 1000 },
  { id: budgetId("2026-10", "Nonexistent"), month: "2026-10", name: "Nonexistent", amountCents: 1000 },
];
const bd = { ...data, budgets };
const b = calc.budgetSummary(bd, "2026-10", d.categoryTotals, d.monthTotal, "2026-10-28");
const foodSpent = data.transactions.filter((t) => t.date.startsWith("2026-10") && t.categoryId === food.id).reduce((a, t) => a + t.amountCents, 0);
assert.equal(b.rows.find((x) => x.name === "Food").spent, foodSpent);
assert.deepEqual(b.rows.find((x) => x.name === "Food").how, ["category"]);
assert.ok(b.rows.find((x) => x.name === "Netflix, Haircut").how.every((h) => h === "subcategory"));
assert.equal(b.rows.find((x) => x.name === "Nonexistent").matched, 0);
assert.equal(b.overall, 300000); assert.equal(b.inProgress, true); assert.equal(b.daysLeft, 4);
assert.equal(b.elapsedPct.toFixed(4), (28 / 31 * 100).toFixed(4));
for (let i = 1; i < b.rows.length; i++) assert.ok(b.rows[i - 1].pct >= b.rows[i].pct);
assert.equal(calc.levelFor(86, 100), "mid"); assert.equal(calc.levelFor(101, 100), "high"); assert.equal(calc.levelFor(5, 0), "high");
assert.equal(calc.previousBudgetMonth(budgets, "2026-12"), "2026-10");
const past = calc.budgetSummary(bd, "2026-10", d.categoryTotals, d.monthTotal, "2026-11-05");
assert.equal(past.inProgress, false); assert.equal(past.elapsedPct, 100);

// --- transactions list
const filtered = calc.filterTransactions(data.transactions, { q: "walmart", category: "", from: "2026-01-01", to: "2026-12-31" });
assert.ok(filtered.every((t) => /walmart/i.test(t.notes + t.description) && t.date >= "2026-01-01"));
const groups = calc.groupTransactions(calc.sortTransactions(data.transactions, "date_desc").slice(0, 30), "date_desc", "2026-10-28");
assert.ok(groups[0].title.includes(","));
assert.equal(calc.groupTransactions(data.transactions.slice(0, 5), "amount_desc", "2026-10-28").length, 1);
const sorted = calc.sortTransactions(data.transactions, "amount_desc");
for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].amountCents >= sorted[i].amountCents);

// --- CSV round trip
const names = { category: (id) => data.categories.find((c) => c.id === id)?.name || "", subcategory: (id) => data.subcategories.find((x) => x.id === id)?.name || "", account: (id) => data.accounts.find((a) => a.id === id)?.name || "" };
const csv = transactionsCsv(data.transactions, names);
assert.equal(parseCsv(csv).length, 401);
let n = 0; const ci = buildCsvImport(csv, empty, { skipDuplicates: true, newId: () => "n" + n++ });
assert.deepEqual(ci.errors, []);
assert.equal(ci.changes.transactions.reduce((a, t) => a + t.amountCents, 0), data.transactions.reduce((a, t) => a + t.amountCents, 0));
const ci2 = buildCsvImport(csv, data, { skipDuplicates: true, newId: () => "m" + n++ });
assert.equal(ci2.created, 0);
assert.ok(ci.changes.transactions.some((t) => t.notes === 'note with "quotes" & <tags>'));
assert.match(transactionsCsv([{ date: "2026-01-01", description: "=HYPERLINK()", amountCents: 100, notes: "" }], names), /'=HYPERLINK/);

// --- sync keeps unknown collections; v1-only remote merges with v2 local
const local = { ...empty, cards: data.cards };
const remote = { transactions: [], futureThing: [{ id: "x" }] };
const m = mergeData(local, remote, COLLECTIONS);
assert.equal(m.remoteChanged, true); assert.equal(m.merged.cards.length, 3);

// --- import twice is idempotent; restore format round trip
assert.deepEqual(buildImport(backup, empty), buildImport(backup, empty));
const restore = buildImport({ format: "finance-drive-export", data: changes }, empty);
assert.equal(restore.changes.loans.length, 1); assert.equal(restore.summary.kind, "restore");
assert.equal(calc.toMilli("9.64"), 9640); assert.equal(calc.toMilli("6.499"), 6499); assert.equal(calc.toMilli("x"), null);
assert.equal(daysBetween("2026-09-30", "2026-10-31"), 31); assert.equal(daysBetween("2026-03-07", "2026-03-09"), 2);
assert.equal(toCents("-50"), -5000);
console.log("calc/import/csv unit tests passed");
