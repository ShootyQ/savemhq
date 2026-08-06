import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, deleteDoc, doc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db } from "./auth-shared.js";
import { escapeHtml, isOwner, monthlyBillCyclesRef, monthlyBillVendorsRef } from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = {
  gate: $("monthly-bills-gate"), gateMessage: $("monthly-bills-gate-message"), signIn: $("monthly-bills-sign-in"), app: $("monthly-bills-app"), notice: $("monthly-bills-notice"), stats: $("monthly-bills-stats"), month: $("monthly-bills-month"), list: $("monthly-bill-list"), vendorForm: $("monthly-bill-vendor-form"), formTitle: $("monthly-bill-form-title"), vendorName: $("monthly-bill-vendor-name"), billDay: $("monthly-bill-vendor-bill-day"), paidDay: $("monthly-bill-vendor-paid-day"), submit: $("monthly-bill-vendor-submit"), cancel: $("monthly-bill-vendor-cancel"),
};
let state = { user: null, vendors: [], cycles: [], unsubscribers: [], editingVendorId: "" };

const notice = (message = "", error = false) => { elements.notice.textContent = message; elements.notice.classList.toggle("is-error", error); };
const clean = (value) => String(value || "").trim();
const monthKey = (value = new Date()) => { const date = value instanceof Date ? value : new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; };
const monthDate = (key) => { const [year, month] = String(key).split("-").map(Number); return new Date(year, month - 1, 1); };
const nextMonthKey = (key) => { const date = monthDate(key); date.setMonth(date.getMonth() + 1); return monthKey(date); };
const cycleId = (vendorId, key) => `${vendorId}_${key}`;
const cycleComplete = (cycle) => Boolean(cycle?.billEntered && cycle?.billPaid);
const formatMonth = (key) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthDate(key));
const formatDay = (day, key) => { const date = monthDate(key); const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); return Number(day) > lastDay ? `day ${day}` : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(date.getFullYear(), date.getMonth(), Number(day))); };
const sortedVendors = () => [...state.vendors].sort((left, right) => Number(left.billDay) - Number(right.billDay) || String(left.name).localeCompare(String(right.name)));
const findCycle = (vendorId, key) => state.cycles.find((cycle) => cycle.id === cycleId(vendorId, key));
const activeCycle = (vendor) => {
  let key = monthKey();
  let completedKey = "";
  for (let count = 0; count < 24; count += 1) {
    const cycle = findCycle(vendor.id, key);
    if (!cycleComplete(cycle)) return { key, cycle, completedKey };
    completedKey = key;
    key = nextMonthKey(key);
  }
  return { key, cycle: findCycle(vendor.id, key), completedKey };
};
const currentMonth = () => monthKey();
const currentCycleComplete = (vendor) => cycleComplete(findCycle(vendor.id, currentMonth()));
const run = async (action, success = "") => { try { await action(); if (success) notice(success); } catch (error) { notice(String(error.message || "That did not work. Try again."), true); } };
const setEditing = (vendor = null) => {
  state.editingVendorId = vendor?.id || "";
  elements.formTitle.textContent = vendor ? "Edit vendor" : "Add a vendor";
  elements.submit.textContent = vendor ? "Save vendor" : "Add vendor";
  elements.cancel.hidden = !vendor;
  elements.vendorName.value = vendor?.name || "";
  elements.billDay.value = vendor?.billDay || "";
  elements.paidDay.value = vendor?.paidDay || "";
};
const renderStats = () => {
  const total = state.vendors.length;
  const completed = state.vendors.filter(currentCycleComplete).length;
  const waiting = total - completed;
  elements.stats.innerHTML = [[total, "Vendors"], [completed, "Complete this month"], [waiting, "Still open"]].map(([value, label]) => `<div class="workroom-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  elements.month.textContent = formatMonth(currentMonth());
};
const renderList = () => {
  const vendors = sortedVendors();
  if (!vendors.length) {
    elements.list.innerHTML = `<p class="workroom-empty">Add your first recurring vendor to begin.</p>`;
    return;
  }
  elements.list.innerHTML = vendors.map((vendor) => {
    const active = activeCycle(vendor);
    const cycle = active.cycle || { billEntered: false, billPaid: false };
    const recorded = Number(Boolean(cycle.billEntered)) + Number(Boolean(cycle.billPaid));
    const advanced = Boolean(active.completedKey);
    const status = advanced ? `${formatMonth(active.completedKey)} complete` : `${recorded} of 2 recorded`;
    return `<article class="monthly-bill-row ${advanced ? "is-advanced" : ""}">
      <div class="monthly-bill-vendor">
        <div>
          <strong>${escapeHtml(vendor.name)}</strong>
          <span class="monthly-bill-cycle">${escapeHtml(formatMonth(active.key))}</span>
          <small>Bill arrives ${escapeHtml(formatDay(vendor.billDay, active.key))} · Auto-pay ${escapeHtml(formatDay(vendor.paidDay, active.key))}</small>
        </div>
      </div>
      <div class="monthly-bill-checks">
        <label class="monthly-bill-check"><input type="checkbox" data-monthly-bill-field="billEntered" data-vendor-id="${escapeHtml(vendor.id)}" data-month-key="${escapeHtml(active.key)}" ${cycle.billEntered ? "checked" : ""} /> <span>Bill entered</span></label>
        <label class="monthly-bill-check"><input type="checkbox" data-monthly-bill-field="billPaid" data-vendor-id="${escapeHtml(vendor.id)}" data-month-key="${escapeHtml(active.key)}" ${cycle.billPaid ? "checked" : ""} /> <span>Paid bill</span></label>
      </div>
      <div class="monthly-bill-actions"><span class="monthly-bill-status ${advanced ? "is-advanced" : ""}">${escapeHtml(status)}</span><button data-edit-monthly-vendor="${escapeHtml(vendor.id)}" type="button">Edit</button><button class="workroom-icon-button" data-delete-monthly-vendor="${escapeHtml(vendor.id)}" type="button" aria-label="Delete ${escapeHtml(vendor.name)}">×</button></div>
    </article>`;
  }).join("");
};
const render = () => { renderStats(); renderList(); };
const writeCycle = async (vendorId, key, field, checked) => {
  const current = findCycle(vendorId, key);
  const next = { billEntered: Boolean(current?.billEntered), billPaid: Boolean(current?.billPaid), [field]: checked };
  await runTransaction(db, async (transaction) => {
    const reference = doc(monthlyBillCyclesRef(state.user.uid), cycleId(vendorId, key));
    const snapshot = await transaction.get(reference);
    const existing = snapshot.exists() ? snapshot.data() : {};
    const values = { billEntered: Boolean(existing.billEntered), billPaid: Boolean(existing.billPaid), [field]: checked };
    transaction.set(reference, {
      vendorId,
      monthKey: key,
      billEntered: values.billEntered,
      billPaid: values.billPaid,
      completedAt: values.billEntered && values.billPaid ? serverTimestamp() : null,
      createdAt: existing.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  notice(next.billEntered && next.billPaid ? `Complete. ${formatMonth(nextMonthKey(key))} is ready.` : "Bill checklist updated.");
};
const subscribe = (user) => {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [
    onSnapshot(monthlyBillVendorsRef(user.uid), (snapshot) => { state.vendors = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(monthlyBillCyclesRef(user.uid), (snapshot) => { state.cycles = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
  ];
};

elements.vendorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = clean(elements.vendorName.value);
  const billDay = Number(elements.billDay.value);
  const paidDay = Number(elements.paidDay.value);
  if (!name || !Number.isInteger(billDay) || billDay < 1 || billDay > 31 || !Number.isInteger(paidDay) || paidDay < 1 || paidDay > 31) {
    notice("Enter a vendor and valid days from 1 to 31.", true);
    return;
  }
  run(async () => {
    if (state.editingVendorId) {
      await updateDoc(doc(monthlyBillVendorsRef(state.user.uid), state.editingVendorId), { name, billDay, paidDay, updatedAt: serverTimestamp() });
      setEditing();
      return;
    }
    await addDoc(monthlyBillVendorsRef(state.user.uid), { name, billDay, paidDay, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    elements.vendorForm.reset();
  }, state.editingVendorId ? "Vendor updated." : "Vendor added.");
});
elements.cancel.addEventListener("click", () => setEditing());
elements.signIn.addEventListener("click", () => { window.location.href = "workroom-control.html"; });
document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-monthly-bill-field]");
  if (!input || !state.user) return;
  input.disabled = true;
  run(() => writeCycle(input.dataset.vendorId, input.dataset.monthKey, input.dataset.monthlyBillField, input.checked)).finally(() => { input.disabled = false; });
});
document.addEventListener("click", (event) => {
  const edit = event.target.closest("[data-edit-monthly-vendor]");
  if (edit) { setEditing(state.vendors.find((vendor) => vendor.id === edit.dataset.editMonthlyVendor)); elements.vendorName.focus(); return; }
  const remove = event.target.closest("[data-delete-monthly-vendor]");
  if (remove) {
    const vendor = state.vendors.find((item) => item.id === remove.dataset.deleteMonthlyVendor);
    if (vendor && window.confirm(`Delete ${vendor.name} from monthly bills?`)) run(() => deleteDoc(doc(monthlyBillVendorsRef(state.user.uid), vendor.id)), "Vendor deleted.");
  }
});

onAuthStateChanged(auth, (user) => {
  state.user = user;
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
  if (!user || !isOwner(user)) {
    elements.app.classList.add("hidden");
    elements.gate.classList.remove("hidden");
    elements.signIn.classList.toggle("hidden", Boolean(user));
    elements.gateMessage.textContent = user ? "This private page is reserved for its owner." : "Sign in with the Workroom owner account to view monthly bills.";
    return;
  }
  elements.gate.classList.add("hidden");
  elements.app.classList.remove("hidden");
  subscribe(user);
});
