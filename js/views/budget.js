// Monthly budget editor (budget_form.html + budget_views.edit_budget).
//
// Each month has an optional overall amount plus any budget lines you type,
// e.g. "Groceries", "Eating out", "Netflix, YouTube". A line's spending is
// matched from that month's transactions by category name, then subcategory
// name, then words in the description or notes.

import * as store from "../store.js";
import { previousBudgetMonth } from "../calc.js";
import { esc, today, monthOf, isMonth, fmtMonthLong, fmtMonthName, fmtMonthYear, toCents, centsToInput, squash, fold, byName } from "../util.js";
import { toast, confirmAction } from "../ui.js";
import { navigate } from "../app.js";
import { budgetId } from "../importer.js";

export function budgetView({ el, query }) {
    const data = store.snapshot();
    const month = isMonth(query.m) ? query.m : monthOf(today());
    const existing = data.budgets.filter((b) => b.month === month);
    const previous = previousBudgetMonth(data.budgets, month);
    let source = existing;
    let copyFrom = null;
    if (!existing.length && query.copy === "1" && previous) {
        copyFrom = previous;
        source = data.budgets.filter((b) => b.month === previous);
    }
    const overallValue = source.find((b) => !b.name);
    const rows = source.filter((b) => b.name).sort((a, b) => a.name.localeCompare(b.name)).map((b) => [b.name, centsToInput(b.amountCents)]);
    const suggestionNames = [...new Set([
        ...data.categories.map((c) => c.name),
        ...data.subcategories.map((s) => s.name),
        ...data.budgets.filter((b) => b.name).map((b) => b.name),
    ])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const budgetMonths = [...new Set(data.budgets.map((b) => b.month))].sort().reverse();
    const rowHtml = ([name, amount] = ["", ""]) => `
        <div class="budget-row">
            <input type="text" name="name" value="${esc(name)}" placeholder="e.g. Groceries" list="budget-suggestions" maxlength="80" aria-label="Budget line name" autocomplete="off">
            <input type="text" inputmode="decimal" name="amount" value="${esc(amount)}" placeholder="Amount" aria-label="Amount">
            <button type="button" class="btn-ghost remove-row" aria-label="Remove row">×</button>
        </div>`;

    el.innerHTML = `
    <section class="card form-card">
        <div class="card-head" style="margin-bottom:6px">
            <h1 style="font-size:22px">Budget · ${esc(fmtMonthLong(month))}</h1>
        </div>
        <p class="muted">Pick a month, set an overall limit, and type the budget lines you want — they don’t have to be existing categories.</p>
        <ul class="errorlist nonfield" data-errors hidden></ul>
        ${copyFrom ? `<div class="notice">Copied from ${esc(fmtMonthLong(copyFrom))} — review and save to use it for ${esc(fmtMonthLong(month))}.</div>` : ""}

        <div class="budget-month-picker">
            <div class="field" style="margin:0;flex:1">
                <label for="month-pick">Month</label>
                <input type="month" id="month-pick" value="${month}">
            </div>
        </div>
        ${budgetMonths.length ? `<div class="tag-list" style="margin:-4px 0 14px">
            ${budgetMonths.slice(0, 8).map((m) => `<a class="tag ${m === month ? "active-tag" : ""}" href="#/budget?m=${m}">${esc(fmtMonthYear(m))}</a>`).join("")}
        </div>` : ""}
        ${!existing.length && !copyFrom && previous ? `<p style="margin-top:-4px"><a class="btn btn-secondary btn-small" href="#/budget?m=${month}&copy=1">Copy from ${esc(fmtMonthLong(previous))}</a></p>` : ""}

        <form data-form novalidate>
            <div class="field">
                <label for="overall">Overall budget for ${esc(fmtMonthName(month))} (USD)</label>
                <input type="text" inputmode="decimal" id="overall" value="${overallValue ? centsToInput(overallValue.amountCents) : ""}" placeholder="e.g. 3000">
                <p class="help">Leave blank to use the total of the budget lines below.</p>
            </div>
            <h3 style="margin:18px 0 6px">Budget lines</h3>
            <p class="help" style="margin:0 0 12px">Type any name, e.g. <em>Groceries</em>, <em>Eating out</em>, <em>Netflix, YouTube</em>.
                Spending is matched from your transactions by category, then subcategory, then words in the description or notes.
                Use commas to combine several in one line.</p>
            <datalist id="budget-suggestions">${suggestionNames.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
            <div data-rows>${(rows.length ? rows : [["", ""]]).map(rowHtml).join("")}</div>
            <button type="button" class="btn-secondary btn-small" data-add-row style="margin:4px 0 18px">+ Add line</button>
            <div class="form-actions">
                <button type="submit" class="btn">Save budget</button>
                <a class="btn btn-ghost" href="#/?m=${month}">Cancel</a>
                ${existing.length ? `<button type="button" class="btn-ghost" style="margin-left:auto;color:var(--danger)" data-clear>Remove this month’s budget</button>` : ""}
            </div>
        </form>
    </section>`;

    const rowsBox = el.querySelector("[data-rows]");
    el.querySelector("#month-pick").addEventListener("change", (e) => { if (isMonth(e.target.value)) navigate(`/budget?m=${e.target.value}`); });
    el.querySelector("[data-add-row]").addEventListener("click", () => {
        rowsBox.insertAdjacentHTML("beforeend", rowHtml());
        rowsBox.lastElementChild.querySelector("input").focus();
    });
    rowsBox.addEventListener("click", (e) => {
        const button = e.target.closest(".remove-row");
        if (!button) return;
        button.closest(".budget-row").remove();
        if (!rowsBox.children.length) rowsBox.insertAdjacentHTML("beforeend", rowHtml());
    });

    const saveLines = async (overall, wanted) => {
        const keep = new Set();
        const records = [];
        if (overall !== null) {
            keep.add(budgetId(month, ""));
            records.push({ id: budgetId(month, ""), month, name: "", amountCents: overall });
        }
        for (const [name, amountCents] of wanted) {
            const id = budgetId(month, name);
            keep.add(id);
            records.push({ id, month, name, amountCents });
        }
        const removed = existing.filter((b) => !keep.has(b.id)).map((b) => ({ id: b.id, deleted: true }));
        await store.saveMany({ budgets: [...records, ...removed] });
    };

    el.querySelector("[data-clear]")?.addEventListener("click", async () => {
        if (!confirmAction("Remove the whole budget for this month?")) return;
        await saveLines(null, []);
        toast(`Budget for ${fmtMonthLong(month)} removed.`);
        navigate(`/?m=${month}`);
    });

    el.querySelector("[data-form]").addEventListener("submit", async (event) => {
        event.preventDefault();
        const errors = [];
        const toAmount = (text) => {
            const cents = toCents(text);
            return cents !== null && cents >= 0 ? cents : null;
        };
        const overallText = el.querySelector("#overall").value.trim();
        let overall = null;
        if (overallText) {
            overall = toAmount(overallText);
            if (overall === null) errors.push("Overall budget must be a number of 0 or more.");
        }
        const wanted = [];
        const seen = new Set();
        for (const row of rowsBox.querySelectorAll(".budget-row")) {
            const name = squash(row.querySelector("[name=name]").value).slice(0, 80);
            const amountText = row.querySelector("[name=amount]").value.trim();
            if (!name && !amountText) continue;
            if (!name) { errors.push("Give every budget line a name (or remove the row)."); continue; }
            const amount = toAmount(amountText);
            if (amount === null) { errors.push(`Enter an amount for “${name}”.`); continue; }
            if (seen.has(fold(name))) { errors.push(`“${name}” is listed twice.`); continue; }
            seen.add(fold(name));
            wanted.push([name, amount]);
        }
        const box = el.querySelector("[data-errors]");
        box.innerHTML = errors.map((e) => `<li>${esc(e)}</li>`).join("");
        box.hidden = !errors.length;
        if (errors.length) { box.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
        await saveLines(overall, wanted);
        toast(`Budget for ${fmtMonthLong(month)} ${overall === null && !wanted.length ? "removed." : "saved."}`);
        navigate(`/?m=${month}`);
    });
}

