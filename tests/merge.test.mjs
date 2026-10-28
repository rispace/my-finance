import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeData, pickNewer } from "../js/merge.js";
import { buildImport, toCents } from "../js/importer.js";
const C = ["transactions"];
// merge basics
const a = { id: "1", updatedAt: 10, description: "old" }, b = { id: "1", updatedAt: 20, description: "new" };
let r = mergeData({ transactions: [a] }, { transactions: [b] }, C);
assert.equal(r.merged.transactions[0].description, "new"); assert.equal(r.localChanges.transactions.length, 1); assert.equal(r.remoteChanged, false);
r = mergeData({ transactions: [b] }, { transactions: [a] }, C);
assert.equal(r.localChanges.transactions.length, 0); assert.equal(r.remoteChanged, true);
r = mergeData({ transactions: [{ id: "2", updatedAt: 5 }] }, {}, C); assert.equal(r.remoteChanged, true);
r = mergeData({}, { transactions: [{ id: "2", updatedAt: 5 }] }, C); assert.equal(r.localChanges.transactions.length, 1); assert.equal(r.remoteChanged, false);
r = mergeData({ transactions: [a] }, { transactions: [a] }, C); assert.equal(r.remoteChanged, false); assert.equal(r.localChanges.transactions.length, 0);
assert.equal(pickNewer({ id: "x", updatedAt: 5, deleted: true }, { id: "x", updatedAt: 5, v: 1 }).deleted, true);
const t1 = { id: "z", updatedAt: 5, v: 1 }, t2 = { id: "z", updatedAt: 5, v: 2 };
assert.deepEqual(pickNewer(t1, t2), pickNewer(t2, t1));
// cents
for (const [i, o] of [["34.36", 3436], ["$1,234.5", 123450], ["7", 700], ["0.01", 1], ["abc", null], ["", null], [".5", 50], ["12.345", 1234]]) assert.equal(toCents(i), o, i);
// importer
const backup = JSON.parse(readFileSync(new URL("./fixture-backup.json", import.meta.url), "utf8"));
const empty = { categories: [], subcategories: [], accounts: [], transactions: [] };
const imp = buildImport(backup, empty);
assert.equal(imp.summary.transactions, 400);
const catIds = new Set(imp.changes.categories.map(c => c.id));
const subIds = new Set(imp.changes.subcategories.map(s => s.id));
const accIds = new Set(imp.changes.accounts.map(s => s.id));
for (const t of imp.changes.transactions) {
  assert.ok(catIds.has(t.categoryId), "cat " + t.categoryId);
  if (t.subcategoryId) assert.ok(subIds.has(t.subcategoryId));
  if (t.accountId) assert.ok(accIds.has(t.accountId), t.accountId);
}
const sumBackup = backup.transactions.reduce((s, t) => s + toCents(t.amount), 0);
assert.equal(imp.changes.transactions.reduce((s, t) => s + t.amountCents, 0), sumBackup);
// legacy payment method mapped
assert.ok(imp.changes.accounts.some(a => a.name === "Cash" || a.name === "Chase credit"));
// re-import on top: nothing new besides same records (deterministic)
const imp2 = buildImport(backup, empty);
assert.deepEqual(imp, imp2);
// reuse existing categories by name
const live = { ...empty, categories: [{ id: "mine", name: "food", updatedAt: 1 }] };
const imp3 = buildImport(backup, live);
assert.ok(!imp3.changes.categories.some(c => c.name === "Food"));
assert.ok(imp3.changes.transactions.some(t => t.categoryId === "mine"));
assert.throws(() => buildImport([], empty));
console.log("unit tests passed; total", sumBackup / 100);
