// Shared UI pieces: sheets (dialogs), toasts, confirm, donut chart, form pages.

import { esc, money, pct, centsToInput, toCents, isDay } from "./util.js";

// ------------------------------------------------------------- toast

let toastTimer;
export function toast(message, kind = "") {
    const el = document.getElementById("toast");
    el.textContent = message;
    el.dataset.kind = kind;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, kind === "error" ? 5000 : 2800);
}

// ------------------------------------------------------------- sheet

const sheet = () => document.getElementById("sheet");

export function openSheet(title, html, bind) {
    document.getElementById("sheet-title").innerHTML = title;
    const body = document.getElementById("sheet-body");
    body.innerHTML = html;
    if (!sheet().open) {
        sheet().showModal();
        document.body.style.overflow = "hidden";
    }
    body.scrollTop = 0;
    if (bind) bind(body);
    bindDonuts(body);
}

export function closeSheet() { if (sheet().open) sheet().close(); }

export function initSheet() {
    sheet().addEventListener("click", (event) => {
        if (event.target.closest("[data-close-sheet]") || event.target === sheet()) closeSheet();
    });
    sheet().addEventListener("close", () => { document.body.style.overflow = ""; });
}

/** Native confirm, wrapped so it can be swapped later. */
export const confirmAction = (message) => window.confirm(message);

// ------------------------------------------------------------- donut

/** A ring chart; hover/tap a slice to see its name. segments from util.donutSegments. */
export function donutHtml(segments, { centerValue, centerLabel, label, openPrefix = "" }) {
    return `
    <div class="donut-svg" data-donut>
        <svg viewBox="0 0 100 100" role="img" aria-label="${esc(label)}; amounts are listed alongside.">
            <circle cx="50" cy="50" r="41.5" fill="none" stroke="var(--track)" stroke-width="17"></circle>
            ${segments.map((s) => `
            <path d="${s.path}" fill="${s.color}" tabindex="0"
                data-label="${esc(s.label)}" data-value="${esc(money(s.value))}" data-share="${esc(pct(s.share, 0))}"
                ${openPrefix && s.key ? `data-open="${esc(openPrefix + s.key)}"` : ""}>
                <title>${esc(s.label)} · ${esc(money(s.value))} (${esc(pct(s.share, 0))})</title>
            </path>`).join("")}
        </svg>
        <div class="donut-center" aria-live="polite">
            <strong data-default="${esc(centerValue)}">${esc(centerValue)}</strong>
            <span data-default="${esc(centerLabel)}">${esc(centerLabel)}</span>
        </div>
        <div class="donut-tip" hidden></div>
    </div>`;
}

export function bindDonuts(root) {
    root.querySelectorAll("[data-donut]").forEach((donut) => {
        if (donut.dataset.bound) return;
        donut.dataset.bound = "1";
        const tip = donut.querySelector(".donut-tip");
        const strong = donut.querySelector(".donut-center strong");
        const small = donut.querySelector(".donut-center span");
        const show = (path, event) => {
            donut.classList.add("hovering");
            donut.querySelectorAll("path").forEach((p) => p.classList.toggle("active", p === path));
            strong.textContent = path.dataset.value;
            small.textContent = `${path.dataset.label} · ${path.dataset.share}`;
            tip.textContent = path.dataset.label;
            if (event && "clientX" in event && event.pointerType === "mouse") {
                const box = donut.getBoundingClientRect();
                tip.style.left = `${event.clientX - box.left}px`;
                tip.style.top = `${event.clientY - box.top}px`;
                tip.hidden = false;
            } else {
                tip.hidden = true;
            }
        };
        const reset = () => {
            donut.classList.remove("hovering");
            donut.querySelectorAll("path").forEach((p) => p.classList.remove("active"));
            strong.textContent = strong.dataset.default;
            small.textContent = small.dataset.default;
            tip.hidden = true;
        };
        donut.querySelectorAll("path").forEach((path) => {
            path.addEventListener("pointermove", (e) => show(path, e));
            path.addEventListener("pointerenter", (e) => show(path, e));
            path.addEventListener("focus", () => show(path));
            path.addEventListener("blur", reset);
        });
        donut.addEventListener("pointerleave", reset);
    });
}

// ------------------------------------------------------------- form pages
//
// A form is a list of field specs:
//   { name, label, type: "text"|"money"|"decimal"|"number"|"date"|"select"|"textarea"|"checkbox",
//     value, options: [[value, label]], help, placeholder, required, disabled, emptyLabel, attrs }
// formHtml() renders it; readForm() returns the raw values.

function fieldInput(f) {
    const id = `f-${f.name}`;
    const common = `id="${id}" name="${esc(f.name)}" ${f.disabled ? "disabled" : ""} ${f.attrs || ""}`;
    const value = f.value ?? "";
    switch (f.type) {
        case "select":
            return `<select ${common}>${f.emptyLabel !== undefined ? `<option value="">${esc(f.emptyLabel)}</option>` : ""}
                ${(f.options || []).map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
        case "textarea":
            return `<textarea ${common} rows="${f.rows || 2}" placeholder="${esc(f.placeholder || "")}">${esc(value)}</textarea>`;
        case "checkbox":
            return `<input type="checkbox" ${common} ${value ? "checked" : ""}>`;
        case "date":
            return `<input type="date" ${common} value="${esc(value)}">`;
        case "money":
            return `<input ${common} inputmode="decimal" autocomplete="off" placeholder="${esc(f.placeholder || "0.00")}" value="${esc(typeof value === "number" ? centsToInput(value) : value)}">`;
        case "decimal":
        case "number":
            return `<input ${common} inputmode="decimal" autocomplete="off" placeholder="${esc(f.placeholder || "")}" value="${esc(value)}">`;
        default:
            return `<input ${common} autocomplete="off" placeholder="${esc(f.placeholder || "")}" value="${esc(value)}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ""}>`;
    }
}

export function fieldHtml(f) {
    if (f.type === "checkbox") {
        return `<div class="field" data-field="${esc(f.name)}" ${f.hidden ? "hidden" : ""}>
            <div class="checkbox-field">${fieldInput(f)}<label for="f-${esc(f.name)}">${esc(f.label)}</label></div>
            ${f.help ? `<p class="help">${f.help}</p>` : ""}<ul class="errorlist" data-error-for="${esc(f.name)}"></ul></div>`;
    }
    return `<div class="field" data-field="${esc(f.name)}" ${f.hidden ? "hidden" : ""}>
        <label for="f-${esc(f.name)}">${esc(f.label)}</label>
        ${fieldInput(f)}
        ${f.help ? `<p class="help" data-help>${f.help}</p>` : ""}
        <ul class="errorlist" data-error-for="${esc(f.name)}"></ul>
    </div>`;
}

/**
 * A full-page form like the web app's simple_form.html.
 * options: { title, description, fields, submitLabel, cancelHref, deleteLabel, extraHtml }
 */
export function formPageHtml({ title, description = "", fields, submitLabel = "Save", cancelHref = "#/", deleteLabel = "", extraHtml = "", afterFields = "" }) {
    return `
    <section class="card form-card">
        <div class="card-head" style="margin-bottom:6px">
            <h1 style="font-size:22px">${esc(title)}</h1>
            ${deleteLabel ? `<button type="button" class="btn btn-ghost btn-small" style="color:var(--danger)" data-delete>${esc(deleteLabel)}</button>` : ""}
        </div>
        ${description ? `<p class="muted">${description}</p>` : ""}
        ${extraHtml}
        <form novalidate data-form style="margin-top:12px">
            <ul class="errorlist nonfield" data-error-for="__all__" hidden></ul>
            ${fields.map(fieldHtml).join("")}
            ${afterFields}
            <div class="form-actions">
                <button type="submit" class="btn">${esc(submitLabel)}</button>
                <a class="btn btn-ghost" href="${esc(cancelHref)}">Cancel</a>
            </div>
        </form>
    </section>`;
}

/** Raw string/boolean values of every named control in a form. */
export function readForm(form) {
    const values = {};
    for (const el of form.querySelectorAll("[name]")) {
        values[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    return values;
}

/** Show errors: { field: "message", __all__: "message" }. Returns true if there were any. */
export function showErrors(form, errors) {
    form.querySelectorAll("[data-error-for]").forEach((ul) => {
        const message = errors[ul.dataset.errorFor];
        ul.innerHTML = message ? `<li>${esc(message)}</li>` : "";
        if (ul.dataset.errorFor === "__all__") ul.hidden = !message;
    });
    const first = Object.keys(errors)[0];
    if (first) {
        const target = form.querySelector(`[data-error-for="${first}"]`);
        target?.closest(".field, .errorlist")?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return Object.keys(errors).length > 0;
}

// Parsers that also report problems in the web app's wording.
export const parse = {
    money(value, { required = true, min = null, allowNegative = false, label = "amount" } = {}) {
        const text = String(value ?? "").trim();
        if (!text) return required ? { error: "This field is required." } : { value: null };
        const cents = toCents(text);
        if (cents === null) return { error: "Enter a number." };
        if (!allowNegative && cents < 0) return { error: `The ${label} can't be negative.` };
        if (min !== null && cents < min) return { error: `Ensure this value is greater than or equal to ${money(min)}.` };
        return { value: cents };
    },
    day(value, { required = true, notFuture = false, today = "" } = {}) {
        if (!value) return required ? { error: "This field is required." } : { value: null };
        if (!isDay(value)) return { error: "Enter a valid date." };
        if (notFuture && value > today) return { error: "Choose today or an earlier date." };
        return { value };
    },
    text(value, { required = true, max = 200 } = {}) {
        const text = String(value ?? "").trim();
        if (!text && required) return { error: "This field is required." };
        return { value: text.slice(0, max) };
    },
};
