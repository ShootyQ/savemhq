import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth } from "./auth-shared.js";
import { asDate, dateInputValue, escapeHtml, isOwner, paymentEntrySourcesRef } from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = {
  gate: $("payment-entries-gate"), gateMessage: $("payment-entries-gate-message"), signIn: $("payment-entries-sign-in"), app: $("payment-entries-app"), notice: $("payment-entries-notice"), stats: $("payment-entries-stats"), list: $("payment-entry-list"), sourceForm: $("payment-entry-source-form"), formTitle: $("payment-entry-form-title"), name: $("payment-entry-source-name"), interval: $("payment-entry-source-interval"), lastCompleted: $("payment-entry-source-last-completed"), submit: $("payment-entry-source-submit"), cancel: $("payment-entry-source-cancel"),
};
let state = { user: null, sources: [], unsubscribe: null, editingSourceId: "" };

const notice = (message = "", error = false) => { elements.notice.textContent = message; elements.notice.classList.toggle("is-error", error); };
const clean = (value) => String(value || "").trim();
const startOfDay = (value = new Date()) => { const date = asDate(value) || new Date(); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); };
const dueDate = (source) => { const completed = asDate(source.lastCompletedAt); if (!completed) return null; const due = startOfDay(completed); due.setDate(due.getDate() + Number(source.intervalDays || 0)); return due; };
const dayOffset = (value) => value ? Math.round((startOfDay(value) - startOfDay()) / (24 * 60 * 60 * 1000)) : null;
const sourceStatus = (source) => { const due = dueDate(source); const offset = dayOffset(due); if (!due) return { label: "Needs first entry", className: "is-overdue" }; if (offset < 0) return { label: `${Math.abs(offset)} day${Math.abs(offset) === 1 ? "" : "s"} overdue`, className: "is-overdue" }; if (offset === 0) return { label: "Due today", className: "is-overdue" }; if (offset === 1) return { label: "Due tomorrow", className: "" }; return { label: `Due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(due)}`, className: "" }; };
const sortedSources = () => [...state.sources].sort((left, right) => (dayOffset(dueDate(left)) ?? -Infinity) - (dayOffset(dueDate(right)) ?? -Infinity) || left.name.localeCompare(right.name));
const setEditing = (source = null) => { state.editingSourceId = source?.id || ""; elements.formTitle.textContent = source ? "Edit source" : "Add a source"; elements.submit.textContent = source ? "Save source" : "Add source"; elements.cancel.hidden = !source; elements.name.value = source?.name || ""; elements.interval.value = source?.intervalDays || ""; elements.lastCompleted.value = source?.lastCompletedAt ? dateInputValue(source.lastCompletedAt) : ""; };
const renderStats = () => { const total = state.sources.length; const overdue = state.sources.filter((source) => { const offset = dayOffset(dueDate(source)); return dueDate(source) == null || offset <= 0; }).length; const current = total - overdue; elements.stats.innerHTML = [[total, "Sources"], [overdue, "Need entry"], [current, "On schedule"]].map(([value, label]) => `<div class="workroom-stat"><strong>${value}</strong><span>${label}</span></div>`).join(""); };
const renderList = () => {
  const sources = sortedSources();
  if (!sources.length) { elements.list.innerHTML = `<p class="workroom-empty">Add ACH, Venmo, or any payment source to start tracking it.</p>`; return; }
  elements.list.innerHTML = sources.map((source) => {
    const status = sourceStatus(source);
    const lastCompleted = source.lastCompletedAt ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(asDate(source.lastCompletedAt)) : "Not recorded yet";
    return `<article class="monthly-bill-row payment-entry-row ${status.className}">
      <div class="monthly-bill-vendor"><div><strong>${escapeHtml(source.name)}</strong><span class="monthly-bill-cycle">Every ${Number(source.intervalDays)} days</span><small>Last completed ${escapeHtml(lastCompleted)}</small></div></div>
      <div class="payment-entry-status"><strong class="monthly-bill-status ${status.className}">${escapeHtml(status.label)}</strong><button class="workroom-button workroom-button-primary payment-entry-complete" data-complete-payment-entry="${escapeHtml(source.id)}" type="button">Record today</button></div>
      <div class="monthly-bill-actions"><button data-edit-payment-entry="${escapeHtml(source.id)}" type="button">Edit</button><button class="workroom-icon-button" data-delete-payment-entry="${escapeHtml(source.id)}" type="button" aria-label="Delete ${escapeHtml(source.name)}">×</button></div>
    </article>`;
  }).join("");
};
const render = () => { renderStats(); renderList(); };
const run = async (action, success = "") => { try { await action(); if (success) notice(success); } catch (error) { notice(String(error.message || "That did not work. Try again."), true); } };

const subscribe = (user) => { state.unsubscribe?.(); state.unsubscribe = onSnapshot(paymentEntrySourcesRef(user.uid), (snapshot) => { state.sources = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }); };

elements.sourceForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = clean(elements.name.value); const intervalDays = Number(elements.interval.value); const lastCompletedAt = elements.lastCompleted.value ? startOfDay(elements.lastCompleted.value) : null;
  if (!name || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) { notice("Enter a source and a repeat interval from 1 to 365 days.", true); return; }
  run(async () => {
    const values = { name, intervalDays, lastCompletedAt, updatedAt: serverTimestamp() };
    if (state.editingSourceId) { await updateDoc(doc(paymentEntrySourcesRef(state.user.uid), state.editingSourceId), values); setEditing(); return; }
    await addDoc(paymentEntrySourcesRef(state.user.uid), { ...values, createdAt: serverTimestamp() }); elements.sourceForm.reset();
  }, state.editingSourceId ? "Source updated." : "Source added.");
});
elements.cancel.addEventListener("click", () => setEditing());
document.addEventListener("click", (event) => {
  const complete = event.target.closest("[data-complete-payment-entry]");
  if (complete) { complete.disabled = true; run(() => updateDoc(doc(paymentEntrySourcesRef(state.user.uid), complete.dataset.completePaymentEntry), { lastCompletedAt: startOfDay(), updatedAt: serverTimestamp() }), "Payment entry recorded for today.").finally(() => { complete.disabled = false; }); return; }
  const edit = event.target.closest("[data-edit-payment-entry]");
  if (edit) { setEditing(state.sources.find((source) => source.id === edit.dataset.editPaymentEntry)); elements.name.focus(); return; }
  const remove = event.target.closest("[data-delete-payment-entry]");
  if (remove) { const source = state.sources.find((item) => item.id === remove.dataset.deletePaymentEntry); if (source && window.confirm(`Delete ${source.name} from payment entries?`)) run(() => deleteDoc(doc(paymentEntrySourcesRef(state.user.uid), source.id)), "Source deleted."); }
});

onAuthStateChanged(auth, (user) => {
  state.user = user; state.unsubscribe?.(); state.unsubscribe = null;
  if (!user || !isOwner(user)) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.toggle("hidden", Boolean(user)); elements.gateMessage.textContent = user ? "This private page is reserved for its owner." : "Sign in with the Workroom owner account to track payment entries."; return; }
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden"); subscribe(user);
});
