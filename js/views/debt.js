// Debt: credit cards (credit_cards.html) and loans (loans.html,
// loan_detail.html, car_payment.html), with their forms.

import * as store from "../store.js";
import {
    debtData, cardBalance, filterCardActivity, monthlyCardSummary, CARD_ACTIONS, LOAN_KINDS, label,
    loanRow, allocateLoanPayment, lastLoanPayment, toMilli, milliToText, uniqueName, byDateDesc,
} from "../calc.js";
import {
    esc, money, signedMoney, pct, cssPct, today, fmtDay, fmtDayNoYear, fmtDayFull, fmtDateTime, fmtMonthYear,
    centsToInput, byName, newId, plural,
} from "../util.js";
import { formPageHtml, readForm, showErrors, parse, openSheet, closeSheet, toast, confirmAction } from "../ui.js";
import { navigate } from "../app.js";
import { cardActivityCsv, saveFile } from "../csv.js";

const pillFor = (level) => (level === "high" ? "loss" : level === "mid" ? "warn" : "gain");
const segmented = (active) => `
    <nav class="segmented" aria-label="Debt type">
        <a href="#/cards" class="${active === "cards" ? "active" : ""}">Credit cards</a>
        <a href="#/loans" class="${active === "loans" ? "active" : ""}">Loans</a>
    </nav>`;
const notFound = (el, what, back) => {
    el.innerHTML = `<section class="card"><div class="empty"><strong>That ${what} no longer exists</strong><a href="${back}">Go back</a></div></section>`;
};

// ============================================================= credit cards

const activityFilter = { card: "", from: "", to: "" };
let activityShown = 20;

export function cardsView({ el, rerender }) {
    const data = store.snapshot();
    const debt = debtData(data);
    const cardsSorted = [...data.cards].sort(byName);
    const badRange = activityFilter.from && activityFilter.to && activityFilter.from > activityFilter.to;
    const entries = badRange ? [] : filterCardActivity(data.cardActivity, activityFilter);
    const summary = monthlyCardSummary(entries).slice(0, 12);
    const totals = summary.reduce((t, r) => ({ charges: t.charges + r.charges, payments: t.payments + r.payments, net: t.net + r.net }), { charges: 0, payments: 0, net: 0 });
    const cardName = (id) => store.get("cards", id)?.name || "—";
    const limits = [...data.limitChanges].sort(byDateDesc).slice(0, 10);
    const filtered = activityFilter.card || activityFilter.from || activityFilter.to;

    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Debt</h1>
            <p class="muted">Credit cards and loans · USD</p>
        </div>
        <div class="page-actions">
            <a class="btn btn-secondary" href="#/card/new"><svg><use href="#i-plus"/></svg>Add card</a>
            ${debt.cards.length ? `<a class="btn" href="#/record">Record charge or payment</a>` : ""}
        </div>
    </div>
    ${segmented("cards")}

    ${debt.cards.length ? `
    <div class="grid grid-3">
        <section class="card stat">
            <div class="stat-label">Balance owed</div>
            <div class="stat-value">${money(debt.totalUsed)}</div>
            <div class="stat-sub">Across ${plural(debt.cards.length, "card")}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Available credit</div>
            <div class="stat-value">${money(debt.totalAvailable)}</div>
            <div class="stat-sub">Total limit ${money(debt.totalLimit, 0)}</div>
        </section>
        <section class="card stat">
            <div class="stat-label">Utilization</div>
            <div class="stat-value ${debt.utilizationLevel === "high" ? "bad" : ""}">${pct(debt.utilization)}</div>
            <div class="bar thick" style="margin-top:8px"><span class="${debt.utilizationLevel}" style="width:${cssPct(debt.utilization)}%"></span></div>
            <div class="stat-sub" style="margin-top:6px">Under 30% is generally best for your score</div>
        </section>
    </div>

    <div class="grid grid-main" style="margin-top:16px">
        <div class="grid grid-2" style="align-content:start">
            ${debt.cards.map((item) => `
            <section class="card cc-tile">
                <div class="cc-top">
                    <span class="cc-name">${esc(item.card.name)}</span>
                    <span class="pill ${pillFor(item.level)}">${pct(item.utilization, 0)} used</span>
                </div>
                <div class="bar thick"><span class="${item.level}" style="width:${cssPct(item.barWidth)}%"></span></div>
                <div class="cc-figures">
                    <div><span>Balance</span><strong>${money(item.balance)}</strong></div>
                    <div><span>Limit</span><strong>${money(item.card.limitCents, 0)}</strong></div>
                    <div><span>Available</span><strong>${money(item.available, 0)}</strong></div>
                </div>
                <div class="cc-actions">
                    <a class="btn btn-small" href="#/card/${encodeURIComponent(item.card.id)}/record">Update balance</a>
                    <a class="btn btn-secondary btn-small" href="#/card/${encodeURIComponent(item.card.id)}/edit">Edit limit</a>
                </div>
            </section>`).join("")}
        </div>

        <div class="stack">
            <section class="card" id="card-history">
                <div class="card-head">
                    <h2>Recent activity</h2>
                    <span class="cc-actions"><button type="button" class="btn btn-secondary btn-small" data-export>CSV</button></span>
                </div>
                <form class="filters activity-filters" data-filters>
                    <div class="field"><label for="ac">Card</label><select id="ac" name="card"><option value="">All cards</option>
                        ${cardsSorted.map((c) => `<option value="${esc(c.id)}" ${c.id === activityFilter.card ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
                    <div class="field"><label for="af">From</label><input type="date" id="af" name="from" value="${esc(activityFilter.from)}"></div>
                    <div class="field"><label for="at">To</label><input type="date" id="at" name="to" value="${esc(activityFilter.to)}">
                        ${badRange ? `<ul class="errorlist"><li>“To” must be on or after “From”.</li></ul>` : ""}</div>
                    ${filtered ? `<div class="form-actions" style="grid-column:1/-1;margin:0"><button type="button" class="btn btn-ghost btn-small" data-clear>Clear</button></div>` : ""}
                </form>
                <p class="faint small" style="margin:10px 0 0">The CSV includes every matching entry, not just the ones shown.</p>
                <ul class="list">
                ${entries.slice(0, activityShown).map((e) => `
                    <li>
                    <button type="button" class="row" data-entry="${esc(e.id)}" aria-haspopup="dialog">
                        <span class="row-main">
                            <span class="row-title" style="display:block">${esc(cardName(e.cardId))}</span>
                            <span class="row-sub" style="display:block">${esc(fmtDayNoYear(e.date))} · ${esc(e.description)}</span>
                        </span>
                        <span class="row-end row-amount ${e.changeCents < 0 ? "good" : ""}">${signedMoney(e.changeCents)}</span>
                    </button>
                    </li>`).join("") || `<li class="empty"><strong>No activity yet</strong>Charges and payments you record appear here.</li>`}
                </ul>
                ${entries.length > activityShown ? `<div class="show-more"><button type="button" class="btn btn-secondary btn-small" data-more>Show more (${entries.length - activityShown} left)</button></div>` : ""}
            </section>

            <section class="card">
                <div class="card-head"><h2>Credit limit changes</h2></div>
                <ul class="list">
                ${limits.map((c) => `
                    <li class="row">
                        <div class="row-main">
                            <div class="row-title">${esc(cardName(c.cardId))}</div>
                            <div class="row-sub">${esc(fmtDay(c.date))}${c.note ? ` · ${esc(c.note)}` : ""}</div>
                        </div>
                        <div class="row-end">
                            <div class="row-amount">${money(c.newCents, 0)}</div>
                            <div class="small ${c.newCents - c.oldCents > 0 ? "good" : "bad"}">${signedMoney(c.newCents - c.oldCents)} from ${money(c.oldCents, 0)}</div>
                        </div>
                    </li>`).join("") || `<li class="muted small" style="padding:4px 0">When a bank raises or lowers a limit, use <em>Edit limit</em> on that card. Each change is logged here.</li>`}
                </ul>
            </section>
        </div>
    </div>

    <section class="card" id="monthly-summary" style="margin-top:16px">
        <div class="card-head">
            <h2>Monthly summary</h2>
            <span class="muted small">${activityFilter.card ? esc(cardName(activityFilter.card)) : "All cards"}</span>
        </div>
        ${summary.length ? `
        <div class="table-wrap">
            <table>
                <thead><tr><th>Month</th><th class="num">Charges</th><th class="num">Payments &amp; refunds</th><th class="num">Net</th></tr></thead>
                <tbody>
                ${summary.map((r) => `
                <tr>
                    <td style="white-space:nowrap">${esc(fmtMonthYear(r.month))}</td>
                    <td class="num">${money(r.charges)}</td>
                    <td class="num good">${money(r.payments)}</td>
                    <td class="num ${r.net > 0 ? "bad" : "good"}">${signedMoney(r.net)}</td>
                </tr>`).join("")}
                </tbody>
                ${summary.length > 1 ? `
                <tfoot><tr>
                    <td><strong>Total</strong></td>
                    <td class="num"><strong>${money(totals.charges)}</strong></td>
                    <td class="num good"><strong>${money(totals.payments)}</strong></td>
                    <td class="num ${totals.net > 0 ? "bad" : "good"}"><strong>${signedMoney(totals.net)}</strong></td>
                </tr></tfoot>` : ""}
            </table>
        </div>
        <p class="faint small" style="margin:10px 0 0">Charges = purchases, interest, fees and upward corrections. Payments &amp; refunds = anything that lowered a balance. Last 12 months with activity.</p>
        ` : `<p class="muted small">No card activity in this range yet.</p>`}
    </section>
    ` : `<section class="card"><div class="empty"><strong>No credit cards yet</strong><a href="#/card/new">Add your first card</a> to track balances and utilization.</div></section>`}`;

    el.querySelector("[data-filters]")?.addEventListener("change", (e) => {
        activityFilter[e.target.name] = e.target.value;
        activityShown = 20;
        rerender();
    });
    el.querySelector("[data-clear]")?.addEventListener("click", () => { Object.assign(activityFilter, { card: "", from: "", to: "" }); rerender(); });
    el.querySelector("[data-more]")?.addEventListener("click", () => { activityShown += 20; rerender(); });
    el.querySelector("[data-export]")?.addEventListener("click", () => saveFile(`card-activity-${today()}.csv`, cardActivityCsv(entries, cardName)));
    el.querySelectorAll("[data-entry]").forEach((b) => b.addEventListener("click", () => openEntry(b.dataset.entry, rerender)));
}

function openEntry(id, rerender) {
    const e = store.get("cardActivity", id);
    if (!e) return;
    const card = store.get("cards", e.cardId);
    openSheet(esc(card?.name || "Card activity"), `
        <dl class="detail-list">
            <dt>Change</dt><dd><strong>${signedMoney(e.changeCents)}</strong> — ${e.changeCents > 0 ? "increased" : "reduced"} the balance</dd>
            <dt>Description</dt><dd>${esc(e.description)}</dd>
            <dt>Date</dt><dd>${esc(fmtDayFull(e.date))}</dd>
            <dt>Added</dt><dd>${esc(fmtDateTime(e.createdAt))}</dd>
        </dl>
        <div class="form-actions" style="margin-top:16px">
            <a class="btn" href="#/card-activity/${encodeURIComponent(id)}">Edit</a>
            <button type="button" class="btn btn-secondary" data-delete>Delete</button>
        </div>`, (body) => {
        body.querySelector("[data-delete]").addEventListener("click", async () => {
            if (!confirmAction(`Delete this ${signedMoney(e.changeCents)} entry? The balance will be recalculated.`)) return;
            await store.remove("cardActivity", id);
            closeSheet();
            toast("Card activity deleted. The balance was recalculated.");
            rerender();
        });
    });
}

/** Add a credit card (CreditCardForm). */
export function cardFormView({ el }) {
    const day = today();
    const fields = [
        { name: "name", label: "Card name", maxlength: 80 },
        { name: "limit", label: "Credit limit (USD)", type: "money" },
        { name: "opening", label: "Current balance owed (USD)", type: "money", help: "Enter the balance you are starting with. A negative amount represents a credit on the account." },
        { name: "openingDate", label: "Opening balance date", type: "date", value: day },
    ];
    el.innerHTML = formPageHtml({ title: "Add credit card", description: "Set the current balance and credit limit for this card.", fields, cancelHref: "#/cards" });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const name = parse.text(v.name, { max: 80 });
        const limit = parse.money(v.limit, { min: 1 });
        const opening = parse.money(v.opening, { allowNegative: true });
        const date = parse.day(v.openingDate, { notFuture: true, today: day });
        for (const [k, r] of Object.entries({ name, limit, opening, openingDate: date })) if (r.error) errors[k] = r.error;
        if (!errors.name && !uniqueName(store.all("cards"), name.value)) errors.name = "You already have a card with this name.";
        if (showErrors(form, errors)) return;
        await store.save("cards", { id: newId(), name: name.value, limitCents: limit.value, openingCents: opening.value, openingDate: date.value, createdAt: new Date().toISOString() });
        toast(`${name.value} added.`);
        navigate("/cards");
    });
}

/** Rename a card or change its limit; limit changes are logged (CreditCardEditForm). */
export function cardEditView({ el, params }) {
    const card = store.get("cards", params.id);
    if (!card) return notFound(el, "card", "#/cards");
    const day = today();
    const fields = [
        { name: "name", label: "Card name", value: card.name, maxlength: 80 },
        { name: "limit", label: "Credit limit (USD)", type: "money", value: card.limitCents },
        { name: "changeDate", label: "Limit changed on", type: "date", value: day, help: "Only used when the credit limit changes." },
        { name: "note", label: "Reason (optional)", placeholder: "e.g. Automatic increase, requested decrease", maxlength: 120 },
    ];
    el.innerHTML = formPageHtml({
        title: `Edit ${card.name}`,
        description: "Change the card name or credit limit. Limit changes are saved to the card's history; your balance and activity are not affected.",
        fields, cancelHref: "#/cards", deleteLabel: "Delete card",
    });
    const form = el.querySelector("[data-form]");
    el.querySelector("[data-delete]").addEventListener("click", async () => {
        const entries = store.all("cardActivity").filter((a) => a.cardId === card.id);
        const changes = store.all("limitChanges").filter((l) => l.cardId === card.id);
        if (!confirmAction(`Delete ${card.name} and its ${plural(entries.length, "activity entry", "activity entries")}? This can’t be undone.`)) return;
        await store.saveMany({
            cards: [{ id: card.id, deleted: true }],
            cardActivity: entries.map((a) => ({ id: a.id, deleted: true })),
            limitChanges: changes.map((l) => ({ id: l.id, deleted: true })),
        });
        toast(`${card.name} deleted.`);
        navigate("/cards");
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const name = parse.text(v.name, { max: 80 });
        const limit = parse.money(v.limit, { min: 1 });
        const date = parse.day(v.changeDate, { notFuture: true, today: day });
        for (const [k, r] of Object.entries({ name, limit, changeDate: date })) if (r.error) errors[k] = r.error;
        if (!errors.name && !uniqueName(store.all("cards"), name.value, card.id)) errors.name = "You already have a card with this name.";
        if (showErrors(form, errors)) return;
        const changes = { cards: [{ ...card, name: name.value, limitCents: limit.value }] };
        if (limit.value !== card.limitCents) {
            changes.limitChanges = [{ id: newId(), cardId: card.id, date: date.value, oldCents: card.limitCents, newCents: limit.value, note: v.note.trim().slice(0, 120), createdAt: new Date().toISOString() }];
        }
        await store.saveMany(changes);
        toast(limit.value !== card.limitCents
            ? `${name.value}: credit limit changed from ${money(card.limitCents)} to ${money(limit.value)}.`
            : `${name.value} updated.`);
        navigate("/cards");
    });
}

/** Record a charge, payment, refund or correction (CardActivityForm). */
export function cardRecordView({ el, params }) {
    const cards = store.all("cards").sort(byName);
    if (!cards.length) {
        toast("Add a credit card first.");
        navigate("/card/new", { replace: true });
        return;
    }
    const fixed = params.id ? store.get("cards", params.id) : null;
    if (params.id && !fixed) return notFound(el, "card", "#/cards");
    const day = today();
    const fields = [
        ...(fixed ? [] : [{ name: "card", label: "Credit card", type: "select", emptyLabel: "Select a card", options: cards.map((c) => [c.id, c.name]) }]),
        { name: "date", label: "Date", type: "date", value: day },
        { name: "action", label: "Action", type: "select", options: CARD_ACTIONS, value: "charge" },
        { name: "amount", label: "Amount (USD)", type: "money" },
        { name: "notes", label: "Notes", maxlength: 120, placeholder: "Optional" },
    ];
    el.innerHTML = formPageHtml({
        title: fixed ? `Update ${fixed.name}` : "Record charge, payment, or adjustment",
        description: fixed ? `Record a charge, payment, refund, or correction. Current balance: <strong class="num">${money(cardBalance(fixed, store.all("cardActivity")))}</strong>.` : "Choose the credit card you want to update.",
        fields, cancelHref: "#/cards",
    });
    const form = el.querySelector("[data-form]");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const card = fixed || store.get("cards", v.card);
        if (!card) errors.card = "This field is required.";
        const date = parse.day(v.date, { notFuture: true, today: day });
        if (date.error) errors.date = date.error;
        else if (card && date.value < card.openingDate) errors.date = "This date cannot be earlier than the opening balance date.";
        const amount = parse.money(v.amount, { min: 1 });
        if (amount.error) errors.amount = amount.error;
        if (showErrors(form, errors)) return;
        const negative = ["payment", "refund", "decrease"].includes(v.action);
        const notes = v.notes.trim().slice(0, 120);
        await store.save("cardActivity", {
            id: newId(), cardId: card.id, date: date.value,
            description: label(CARD_ACTIONS, v.action) + (notes ? ` — ${notes}` : ""),
            changeCents: negative ? -amount.value : amount.value,
            createdAt: new Date().toISOString(),
        });
        toast(`${card.name} balance updated.`);
        navigate("/cards");
    });
}

/** Correct an activity entry (CardActivityEditForm). */
export function cardActivityEditView({ el, params }) {
    const entry = store.get("cardActivity", params.id);
    if (!entry) return notFound(el, "entry", "#/cards");
    const card = store.get("cards", entry.cardId);
    const day = today();
    const fields = [
        { name: "date", label: "Date", type: "date", value: entry.date },
        { name: "description", label: "Description", value: entry.description, maxlength: 200 },
        { name: "change", label: "Balance change (USD)", type: "money", value: entry.changeCents, help: "Positive amounts increase the balance. Negative amounts reduce it. For example: 50 for a purchase or -50 for a payment." },
    ];
    el.innerHTML = formPageHtml({ title: `Edit activity — ${card?.name || "card"}`, description: "Correct the date, description, or balance change.", fields, cancelHref: "#/cards", deleteLabel: "Delete" });
    const form = el.querySelector("[data-form]");
    el.querySelector("[data-delete]").addEventListener("click", async () => {
        if (!confirmAction("Delete this entry? The balance will be recalculated.")) return;
        await store.remove("cardActivity", entry.id);
        toast("Card activity deleted. The balance was recalculated.");
        navigate("/cards");
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const date = parse.day(v.date, { notFuture: true, today: day });
        if (date.error) errors.date = date.error;
        else if (card && date.value < card.openingDate) errors.date = "This date cannot be earlier than the opening balance date.";
        const description = parse.text(v.description);
        if (description.error) errors.description = description.error;
        const change = parse.money(v.change, { allowNegative: true });
        if (change.error) errors.change = change.error;
        else if (change.value === 0) errors.change = "Enter an amount other than zero.";
        if (showErrors(form, errors)) return;
        await store.save("cardActivity", { ...entry, date: date.value, description: description.value, changeCents: change.value });
        toast("Card activity updated. The balance was recalculated.");
        navigate("/cards");
    });
}

// ============================================================= loans

export function loansView({ el }) {
    const debt = debtData(store.snapshot());
    el.innerHTML = `
    <div class="page-head">
        <div>
            <h1>Debt</h1>
            <p class="muted">Car, home, student and personal loans</p>
        </div>
        <div class="page-actions"><a class="btn" href="#/loan/new"><svg><use href="#i-plus"/></svg>Add loan</a></div>
    </div>
    ${segmented("loans")}
    ${debt.loans.length ? `
    <div class="grid grid-3" style="margin-bottom:16px">
        <section class="card stat">
            <div class="stat-label">Total remaining principal</div>
            <div class="stat-value">${money(debt.loansTotal)}</div>
            <div class="stat-sub">${plural(debt.loans.length, "loan")}</div>
        </section>
    </div>
    <div class="grid grid-2">
        ${debt.loans.map((item) => `
        <a class="card cc-tile" href="#/loan/${encodeURIComponent(item.loan.id)}" style="color:inherit;text-decoration:none">
            <div class="cc-top">
                <span class="cc-name">${esc(item.loan.name)}</span>
                <span class="pill">${esc(label(LOAN_KINDS, item.loan.kind))}</span>
            </div>
            <div class="stat-value">${money(item.balance)}</div>
            <div class="bar thick"><span style="width:${cssPct(item.paidPct)}%"></span></div>
            <div class="cc-figures">
                <div><span>Paid off</span><strong>${pct(item.paidPct, 0)}</strong></div>
                <div><span>APR</span><strong>${milliToText(item.loan.aprMilli, 2)}%</strong></div>
                <div><span>Monthly</span><strong>${money(item.loan.monthlyCents)}</strong></div>
            </div>
        </a>`).join("")}
    </div>
    ` : `<section class="card"><div class="empty"><strong>No loans yet</strong><a href="#/loan/new">Add a car loan, mortgage or other loan</a> to track principal and interest.</div></section>`}`;
}

let paymentsShown = 20;

export function loanDetailView({ el, params, rerender }) {
    const loan = store.get("loans", params.id);
    if (!loan) return notFound(el, "loan", "#/loans");
    const payments = store.all("loanPayments");
    const row = loanRow(loan, payments);
    const history = payments.filter((p) => p.loanId === loan.id).sort(byDateDesc);
    const id = encodeURIComponent(loan.id);
    el.innerHTML = `
    <div class="page-head">
        <div>
            <p class="muted small" style="margin:0 0 4px"><a href="#/loans">← Loans</a></p>
            <h1>${esc(loan.name)}</h1>
            <p class="muted">${esc(label(LOAN_KINDS, loan.kind))} · tracking since ${esc(fmtDay(loan.openingDate))}</p>
        </div>
        <div class="page-actions">
            <a class="btn btn-secondary" href="#/loan/${id}/edit">Edit loan</a>
            <a class="btn" href="#/loan/${id}/pay">Record payment</a>
        </div>
    </div>
    <div class="grid grid-main">
        <section class="card">
            <div class="stat-label">Remaining principal</div>
            <div class="stat-value" style="font-size:34px">${money(row.balance)}</div>
            <div class="bar thick" style="margin:12px 0 6px"><span style="width:${cssPct(row.paidPct)}%"></span></div>
            <p class="muted small">${pct(row.paidPct, 1)} of ${money(loan.financedCents)} paid off. This is the principal you recorded, not a lender payoff quote.</p>
            <dl class="detail-list" style="margin-top:12px">
                <dt>APR</dt><dd>${milliToText(loan.aprMilli)}%</dd>
                <dt>Monthly payment</dt><dd>${money(loan.monthlyCents)}</dd>
                <dt>Original term</dt><dd>${loan.termMonths} months</dd>
                <dt>Amount financed</dt><dd>${money(loan.financedCents)}</dd>
            </dl>
        </section>
        <section class="card" id="history">
            <div class="card-head"><h2>Payments</h2></div>
            <ul class="list">
            ${history.slice(0, paymentsShown).map((p) => `
                <li class="row">
                    <div class="row-main">
                        <div class="row-title">${esc(fmtDay(p.date))}</div>
                        <div class="row-sub">Principal ${money(p.principalCents)} · Interest ${money(p.interestCents)}${p.feesCents ? ` · Fees ${money(p.feesCents)}` : ""}</div>
                    </div>
                    <div class="row-end row-amount">${money(p.totalCents)}</div>
                    <button type="button" class="btn btn-ghost btn-small" data-delete-payment="${esc(p.id)}" aria-label="Delete payment" title="Delete payment">×</button>
                </li>`).join("") || `<li class="empty"><strong>No payments yet</strong><a href="#/loan/${id}/pay">Record your first payment</a></li>`}
            </ul>
            ${history.length > paymentsShown ? `<div class="show-more"><button type="button" class="btn btn-secondary btn-small" data-more>Show more</button></div>` : ""}
        </section>
    </div>`;
    el.querySelector("[data-more]")?.addEventListener("click", () => { paymentsShown += 20; rerender(); });
    el.querySelectorAll("[data-delete-payment]").forEach((b) => b.addEventListener("click", async () => {
        const p = store.get("loanPayments", b.dataset.deletePayment);
        if (!p || !confirmAction(`Delete the ${money(p.totalCents)} payment from ${fmtDay(p.date)}? Its principal goes back onto the balance.`)) return;
        await store.remove("loanPayments", p.id);
        toast("Payment deleted.");
        rerender();
    }));
}

export function loanFormView({ el, params }) {
    const loan = params.id ? store.get("loans", params.id) : null;
    if (params.id && !loan) return notFound(el, "loan", "#/loans");
    const day = today();
    // Changing the opening balance after payments would rewrite history.
    const locked = !!loan && store.all("loanPayments").some((p) => p.loanId === loan.id);
    const fields = [
        { name: "name", label: "Loan name", value: loan?.name ?? "Car loan", maxlength: 80 },
        { name: "kind", label: "Type", type: "select", options: LOAN_KINDS, value: loan?.kind ?? "auto" },
        { name: "financed", label: "Original amount financed (USD)", type: "money", value: loan?.financedCents },
        { name: "apr", label: "APR (%)", type: "decimal", value: loan ? milliToText(loan.aprMilli) : "" },
        { name: "monthly", label: "Monthly payment (USD)", type: "money", value: loan?.monthlyCents },
        { name: "term", label: "Original term in months", type: "number", value: loan?.termMonths ?? "" },
        { name: "opening", label: "Current remaining principal (USD)", type: "money", value: loan?.openingCents, disabled: locked,
          help: locked ? "Locked because payments are recorded against it." : "Use your current statement's principal balance. Use the original amount only if no principal has been paid." },
        { name: "openingDate", label: "Current balance date", type: "date", value: loan?.openingDate ?? day, disabled: locked },
    ];
    el.innerHTML = formPageHtml({
        title: loan ? `Edit ${loan.name}` : "Add a loan",
        description: "Use your contract and latest statement. APR changes apply to future estimates; payments already recorded are not recalculated.",
        fields, cancelHref: loan ? `#/loan/${encodeURIComponent(loan.id)}` : "#/loans",
        deleteLabel: loan ? "Delete loan" : "",
    });
    const form = el.querySelector("[data-form]");
    el.querySelector("[data-delete]")?.addEventListener("click", async () => {
        const payments = store.all("loanPayments").filter((p) => p.loanId === loan.id);
        const linked = store.all("assets").filter((a) => a.loanId === loan.id);
        if (!confirmAction(`Delete ${loan.name} and its ${plural(payments.length, "payment")}? Linked assets are kept. This can’t be undone.`)) return;
        await store.saveMany({
            loans: [{ id: loan.id, deleted: true }],
            loanPayments: payments.map((p) => ({ id: p.id, deleted: true })),
            assets: linked.map((a) => ({ ...a, loanId: null })),
        });
        toast(`${loan.name} deleted.`);
        navigate("/loans");
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const v = readForm(form);
        const errors = {};
        const name = parse.text(v.name, { max: 80 });
        const financed = parse.money(v.financed, { min: 1 });
        const monthly = parse.money(v.monthly, { min: 1 });
        const aprMilli = toMilli(v.apr);
        const term = /^\d+$/.test(String(v.term).trim()) ? Number(v.term) : null;
        if (name.error) errors.name = name.error;
        if (financed.error) errors.financed = financed.error;
        if (monthly.error) errors.monthly = monthly.error;
        if (aprMilli === null) errors.apr = "Enter the APR as a number, e.g. 6.49.";
        if (!term || term < 1) errors.term = "Ensure this value is greater than or equal to 1.";
        let opening = { value: loan?.openingCents }, openingDate = { value: loan?.openingDate };
        if (!locked) {
            opening = parse.money(v.opening);
            openingDate = parse.day(v.openingDate, { notFuture: true, today: day });
            if (opening.error) errors.opening = opening.error;
            if (openingDate.error) errors.openingDate = openingDate.error;
        }
        if (showErrors(form, errors)) return;
        const record = {
            ...(loan || { id: newId(), createdAt: new Date().toISOString() }),
            name: name.value, kind: v.kind, financedCents: financed.value, aprMilli, monthlyCents: monthly.value,
            termMonths: term, openingCents: opening.value, openingDate: openingDate.value,
        };
        await store.save("loans", record);
        toast(`${record.name} saved.`);
        navigate(`/loan/${encodeURIComponent(record.id)}`);
    });
}

export function loanPaymentView({ el, params }) {
    const loan = store.get("loans", params.id);
    if (!loan) return notFound(el, "loan", "#/loans");
    const day = today();
    const payments = store.all("loanPayments");
    const last = lastLoanPayment(loan, payments);
    const row = loanRow(loan, payments);
    const back = `#/loan/${encodeURIComponent(loan.id)}`;

    el.innerHTML = `
    <section class="card form-card">
        <h1 style="font-size:22px;margin-bottom:6px">Record payment · ${esc(loan.name)}</h1>
        <p>Current principal: <strong class="num">${money(row.balance)}</strong> · APR ${milliToText(loan.aprMilli, 2)}%</p>
        <p class="muted">Enter the installment amount and the date the lender credits it.
            Interest is estimated using elapsed days and a 365-day year.
            Check the lender's statement for the exact allocation.</p>
        <form novalidate data-form>
            <ul class="errorlist nonfield" data-error-for="__all__" hidden></ul>
            <div class="field"><label for="p-date">Payment date</label><input type="date" id="p-date" name="date" value="${day}"></div>
            <div class="field"><label for="p-total">Installment amount (USD)</label><input id="p-total" name="total" inputmode="decimal" value="${centsToInput(loan.monthlyCents)}"></div>
            ${last ? `<p class="muted">Interest starts from the last recorded payment: ${esc(fmtDay(last.date))}.</p>` : `
            <div class="field">
                <label for="p-from">Interest starts from</label>
                <input type="date" id="p-from" name="interestFrom" value="">
                <p class="help">For the first payment, use the loan's interest start date. If tracking an existing loan, use the lender's last interest-paid-through date. Do not use the date you added the loan to this app unless those dates match.</p>
            </div>`}
            <details>
                <summary>Statement adjustment or fees (optional)</summary>
                <div class="field">
                    <label for="p-interest">Interest from statement (optional override)</label>
                    <input id="p-interest" name="interest" inputmode="decimal">
                    <p class="help">Leave blank to estimate. Enter 0 only if the lender reports zero interest.</p>
                </div>
                <div class="field">
                    <label for="p-fees">Fees / escrow (USD)</label>
                    <input id="p-fees" name="fees" inputmode="decimal" value="0.00">
                    <p class="help">Mortgages: put the escrow part (taxes, insurance) here.</p>
                </div>
            </details>
            <div class="cc-figures card preview-box">
                <div><span>Interest</span><strong data-out="interest">—</strong></div>
                <div><span>Principal</span><strong data-out="principal">—</strong></div>
                <div><span>Remaining</span><strong data-out="remaining">—</strong></div>
            </div>
            <p class="muted" data-status role="status" aria-live="polite"></p>
            <div class="form-actions">
                <button type="submit" class="btn">Save payment</button>
                <a class="btn btn-ghost" href="${back}">Cancel</a>
            </div>
        </form>
    </section>`;

    const form = el.querySelector("[data-form]");
    const status = el.querySelector("[data-status]");
    const compute = () => {
        const v = readForm(form);
        const interestText = (v.interest || "").trim();
        const interest = interestText === "" ? null : parse.money(interestText, { allowNegative: true }).value;
        return allocateLoanPayment(loan, store.all("loanPayments"), {
            date: v.date,
            totalCents: parse.money(v.total).value ?? 0,
            interestFrom: v.interestFrom,
            interestCents: interestText === "" ? null : (interest ?? -1),
            feesCents: (v.fees || "").trim() === "" ? 0 : (parse.money(v.fees, { allowNegative: true }).value ?? -1),
        }, day);
    };
    const preview = () => {
        const result = compute();
        for (const key of ["interest", "principal", "remaining"]) {
            el.querySelector(`[data-out="${key}"]`).textContent = result.ok ? money(result[key]) : "—";
        }
        status.textContent = result.ok
            ? (result.estimated ? `Estimated allocation over ${plural(result.days, "day")}. The lender's statement is authoritative.` : "Using your statement interest and entered fees.")
            : "Complete the amount and dates to see the allocation. " + (result.errors.length === 1 ? result.errors[0] : "");
    };
    form.addEventListener("input", preview);
    form.addEventListener("change", preview);
    preview();
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = compute();
        if (!result.ok) {
            showErrors(form, { __all__: result.errors.join(" ") });
            return;
        }
        const v = readForm(form);
        await store.save("loanPayments", {
            id: newId(), loanId: loan.id, date: v.date,
            totalCents: parse.money(v.total).value, interestCents: result.interest, feesCents: result.fees, principalCents: result.principal,
            createdAt: new Date().toISOString(),
        });
        toast(`Payment recorded with ${result.estimated ? "an estimated allocation." : "your statement allocation."}`);
        navigate(`/loan/${encodeURIComponent(loan.id)}`);
    });
}
