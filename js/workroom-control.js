import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { auth } from "./auth-shared.js";
import {
  achEntriesRef,
  contactFollowUpsRef,
  connectionsRef,
  dateInputValue,
  escapeHtml,
  financeRef,
  formatDay,
  formatDateTime,
  isOwner,
  priorityRank,
  projectsRef,
  tasksRef,
  workroomRef,
} from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = {
  gate: $("workroom-gate"), gateMessage: $("workroom-gate-message"), signIn: $("workroom-sign-in"), signOut: $("workroom-sign-out"), app: $("workroom-control"), notice: $("workroom-notice"),
  contactForm: $("workroom-contact-form"), contactName: $("workroom-contact-name"), contactDate: $("workroom-contact-date"), contactReason: $("workroom-contact-reason"), contactMethod: $("workroom-contact-method"), contactDetail: $("workroom-contact-detail"), contacts: $("workroom-contacts"),
  projectForm: $("workroom-project-form"), projectTitle: $("workroom-project-title"), projectDate: $("workroom-project-date"), projectColor: $("workroom-project-color"), projects: $("workroom-projects"),
  taskForm: $("workroom-task-form"), taskTitle: $("workroom-task-title"), taskProject: $("workroom-task-project"), taskPriority: $("workroom-task-priority"), taskDate: $("workroom-task-date"), taskNotes: $("workroom-task-notes"), tasks: $("workroom-tasks"),
  financeForm: $("workroom-finance-form"), financeTitle: $("workroom-finance-title"), financeCategory: $("workroom-finance-category"), financeUrgency: $("workroom-finance-urgency"), financeDate: $("workroom-finance-date"), financeAmount: $("workroom-finance-amount"), financeReference: $("workroom-finance-reference"), finance: $("workroom-finance"),
  achForm: $("workroom-ach-form"), achName: $("workroom-ach-name"), achAmount: $("workroom-ach-amount"), achDate: $("workroom-ach-date"), achReason: $("workroom-ach-reason"), achRecurring: $("workroom-ach-recurring"), ach: $("workroom-ach"),
  googleConnect: $("workroom-google-connect"), googleSync: $("workroom-google-sync"), connections: $("workroom-connections"),
};
const functions = getFunctions();
const googleConnect = httpsCallable(functions, "createWorkroomGoogleAuthSession");
const googleSync = httpsCallable(functions, "syncWorkroomGoogle");
const googleDisconnect = httpsCallable(functions, "disconnectWorkroomGoogle");
const googleCalendars = httpsCallable(functions, "listWorkroomGoogleCalendars");
const saveGoogleCalendars = httpsCallable(functions, "setWorkroomGoogleCalendars");
let state = { user: null, projects: [], tasks: [], finance: [], contacts: [], ach: [], connections: [], unsubscribers: [] };

const notice = (message = "", error = false) => {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("is-error", error);
};
const clean = (value) => String(value || "").trim();
const timestampForDate = (value) => value ? new Date(`${value}T12:00:00`) : null;
const cleanUp = () => { state.unsubscribers.forEach((unsubscribe) => unsubscribe()); state.unsubscribers = []; };

const renderProjects = () => {
  const sorted = [...state.projects].sort((a, b) => String(a.targetDate?.toMillis?.() || 0).localeCompare(String(b.targetDate?.toMillis?.() || 0)));
  elements.projects.innerHTML = sorted.length ? sorted.map((project) => `<div class="workroom-record"><span class="workroom-color-dot ${escapeHtml(project.color)}"></span><div><strong>${escapeHtml(project.title)}</strong><small>${project.targetDate ? `Target ${formatDay(project.targetDate)}` : "No target date"}</small></div><button data-delete-project="${project.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(project.title)}">×</button></div>`).join("") : `<p class="workroom-empty">Start with the work you want to move forward.</p>`;
  elements.taskProject.innerHTML = `<option value="">No project</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join("")}`;
};

const renderTasks = () => {
  const projectNames = new Map(state.projects.map((project) => [project.id, project.title]));
  const sorted = [...state.tasks].sort((a, b) => (a.status === "done") - (b.status === "done") || priorityRank(a.priority) - priorityRank(b.priority) || (a.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.tasks.innerHTML = sorted.length ? sorted.map((task) => `<div class="workroom-record ${task.status === "done" ? "is-done" : ""}"><button data-complete-task="${task.id}" class="workroom-check" aria-label="${task.status === "done" ? "Reopen" : "Complete"} ${escapeHtml(task.title)}">${task.status === "done" ? "✓" : ""}</button><div><strong>${escapeHtml(task.title)}</strong><small><span class="workroom-priority ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>${task.projectId ? ` · ${escapeHtml(projectNames.get(task.projectId) || "Archived project")}` : ""}${task.dueDate ? ` · ${formatDay(task.dueDate)}` : ""}</small></div><button data-delete-task="${task.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(task.title)}">×</button></div>`).join("") : `<p class="workroom-empty">Your action queue is clear.</p>`;
};

const renderFinance = () => {
  const sorted = [...state.finance].sort((a, b) => (a.status === "done") - (b.status === "done") || priorityRank(a.urgency) - priorityRank(b.urgency) || (a.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.finance.innerHTML = sorted.length ? sorted.map((item) => `<div class="workroom-record ${item.status === "done" ? "is-done" : ""}"><button data-complete-finance="${item.id}" class="workroom-check" aria-label="${item.status === "done" ? "Reopen" : "Complete"} ${escapeHtml(item.title)}">${item.status === "done" ? "✓" : ""}</button><div><strong>${escapeHtml(item.title)}</strong><small><span class="workroom-priority ${escapeHtml(item.urgency)}">${escapeHtml(item.urgency)}</span> · ${escapeHtml(item.category || "Reminder")}${item.dueDate ? ` · ${formatDay(item.dueDate)}` : ""}${item.amount != null ? ` · $${Number(item.amount).toFixed(2)}` : ""}</small></div><button data-delete-finance="${item.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(item.title)}">×</button></div>`).join("") : `<p class="workroom-empty">No finance reminders are waiting.</p>`;
};

const renderContacts = () => {
  const sorted = [...state.contacts].sort((a, b) => (a.status === "done") - (b.status === "done") || (a.followUpDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.followUpDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.contacts.innerHTML = sorted.length ? sorted.map((item) => `<div class="workroom-record ${item.status === "done" ? "is-done" : ""}"><button data-complete-contact="${item.id}" class="workroom-check" aria-label="${item.status === "done" ? "Reopen" : "Complete"} follow-up with ${escapeHtml(item.name)}">${item.status === "done" ? "✓" : ""}</button><div><strong>${escapeHtml(item.name)}</strong><small>${item.followUpDate ? formatDay(item.followUpDate) : "No date"} · ${escapeHtml(item.method)} · ${escapeHtml(item.contactDetail)} · ${escapeHtml(item.reason)}</small></div><button data-delete-contact="${item.id}" class="workroom-icon-button" aria-label="Delete follow-up with ${escapeHtml(item.name)}">×</button></div>`).join("") : `<p class="workroom-empty">No follow-ups waiting.</p>`;
};

const renderAch = () => {
  const sorted = [...state.ach].sort((a, b) => (a.withdrawalDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.withdrawalDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.ach.innerHTML = sorted.length ? sorted.map((item) => `<div class="workroom-record"><div><strong>${escapeHtml(item.name)} · $${Number(item.amount || 0).toFixed(2)}</strong><small>${item.withdrawalDate ? formatDay(item.withdrawalDate) : "No date"} · ${escapeHtml(item.reason)}${item.recurring ? " · recurring" : ""}</small></div><button data-delete-ach="${item.id}" class="workroom-icon-button" aria-label="Delete ACH entry for ${escapeHtml(item.name)}">×</button></div>`).join("") : `<p class="workroom-empty">No ACH entries waiting.</p>`;
};

const renderConnections = () => {
  elements.connections.innerHTML = state.connections.length ? state.connections.map((connection) => `<div class="workroom-connection"><div><strong>Google account</strong><small>${escapeHtml(connection.status)}${connection.lastSyncAt ? ` · synced ${formatDateTime(connection.lastSyncAt)}` : " · waiting for first sync"}${connection.error ? ` · ${escapeHtml(connection.error)}` : ""}</small></div><div class="workroom-connection-actions"><button class="workroom-button workroom-button-quiet" data-manage-connection="${connection.id}" type="button">Calendars</button><button class="workroom-button workroom-button-quiet" data-disconnect-connection="${connection.id}" type="button">Disconnect</button></div></div>`).join("") : `<p class="workroom-empty">No Google accounts connected yet.</p>`;
};

const subscribe = (user) => {
  cleanUp();
  state.unsubscribers.push(
    onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderProjects(); renderTasks(); }),
    onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderTasks(); }),
    onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderFinance(); }),
    onSnapshot(contactFollowUpsRef(user.uid), (snapshot) => { state.contacts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderContacts(); }),
    onSnapshot(achEntriesRef(user.uid), (snapshot) => { state.ach = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAch(); }),
    onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderConnections(); }),
  );
};

const run = async (action, success) => { try { await action(); if (success) notice(success); } catch (error) { notice(String(error.message || "That did not work. Try again."), true); } };

elements.signIn.addEventListener("click", () => run(async () => signInWithPopup(auth, new GoogleAuthProvider())));
elements.signOut.addEventListener("click", () => signOut(auth));
elements.contactForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(contactFollowUpsRef(state.user.uid), { name: clean(elements.contactName.value), followUpDate: timestampForDate(elements.contactDate.value), reason: clean(elements.contactReason.value), method: elements.contactMethod.value, contactDetail: clean(elements.contactDetail.value), status: "open", completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.contactForm.reset(); }, "Follow-up added."); });
elements.projectForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(projectsRef(state.user.uid), { title: clean(elements.projectTitle.value), status: "active", color: elements.projectColor.value, outcome: "", targetDate: timestampForDate(elements.projectDate.value), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.projectForm.reset(); }, "Project added."); });
elements.taskForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(tasksRef(state.user.uid), { title: clean(elements.taskTitle.value), projectId: elements.taskProject.value, status: "next", priority: elements.taskPriority.value, dueDate: timestampForDate(elements.taskDate.value), notes: clean(elements.taskNotes.value), completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.taskForm.reset(); }, "Task added."); });
elements.financeForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { const amount = clean(elements.financeAmount.value); await addDoc(financeRef(state.user.uid), { title: clean(elements.financeTitle.value), category: clean(elements.financeCategory.value), urgency: elements.financeUrgency.value, dueDate: timestampForDate(elements.financeDate.value), reference: clean(elements.financeReference.value), amount: amount ? Number(amount) : null, status: "open", completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.financeForm.reset(); }, "Reminder added."); });
elements.achForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(achEntriesRef(state.user.uid), { name: clean(elements.achName.value), amount: Number(elements.achAmount.value), withdrawalDate: timestampForDate(elements.achDate.value), reason: clean(elements.achReason.value), recurring: elements.achRecurring.checked, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.achForm.reset(); }, "ACH entry added."); });
elements.googleConnect.addEventListener("click", () => run(async () => { const result = await googleConnect(); window.location.assign(result.data.authorizeUrl); }));
elements.googleSync.addEventListener("click", () => run(() => googleSync(), "Google data refreshed."));

document.addEventListener("click", (event) => {
  const button = event.target.closest("button"); if (!button || !state.user) return;
  const taskId = button.dataset.completeTask; const financeId = button.dataset.completeFinance;
  if (button.dataset.deleteProject) run(() => deleteDoc(doc(projectsRef(state.user.uid), button.dataset.deleteProject)));
  if (button.dataset.deleteTask) run(() => deleteDoc(doc(tasksRef(state.user.uid), button.dataset.deleteTask)));
  if (button.dataset.deleteFinance) run(() => deleteDoc(doc(financeRef(state.user.uid), button.dataset.deleteFinance)));
  if (button.dataset.deleteContact) run(() => deleteDoc(doc(contactFollowUpsRef(state.user.uid), button.dataset.deleteContact)));
  if (button.dataset.deleteAch) run(() => deleteDoc(doc(achEntriesRef(state.user.uid), button.dataset.deleteAch)));
  if (taskId) { const task = state.tasks.find((item) => item.id === taskId); run(() => updateDoc(doc(tasksRef(state.user.uid), taskId), { status: task.status === "done" ? "next" : "done", completedAt: task.status === "done" ? null : new Date(), updatedAt: serverTimestamp() })); }
  if (financeId) { const item = state.finance.find((record) => record.id === financeId); run(() => updateDoc(doc(financeRef(state.user.uid), financeId), { status: item.status === "done" ? "open" : "done", completedAt: item.status === "done" ? null : new Date(), updatedAt: serverTimestamp() })); }
  if (button.dataset.completeContact) { const item = state.contacts.find((record) => record.id === button.dataset.completeContact); run(() => updateDoc(doc(contactFollowUpsRef(state.user.uid), item.id), { status: item.status === "done" ? "open" : "done", completedAt: item.status === "done" ? null : new Date(), updatedAt: serverTimestamp() })); }
  if (button.dataset.disconnectConnection) run(() => googleDisconnect({ connectionId: button.dataset.disconnectConnection }), "Google account disconnected.");
  if (button.dataset.manageConnection) run(async () => { const connectionId = button.dataset.manageConnection; const result = await googleCalendars({ connectionId }); const selected = state.connections.find((item) => item.id === connectionId)?.selectedCalendars || []; const choices = result.data.calendars.map((calendar) => `<label class="workroom-calendar-choice"><input type="checkbox" value="${escapeHtml(calendar.id)}" ${selected.includes(calendar.id) ? "checked" : ""} /> ${escapeHtml(calendar.summary)}${calendar.primary ? " (primary)" : ""}</label>`).join(""); elements.connections.innerHTML = `<div class="workroom-calendar-picker" data-connection-id="${connectionId}"><strong>Choose calendars for the TV</strong>${choices}<button class="workroom-button workroom-button-primary" data-save-calendars="${connectionId}" type="button">Save calendars</button></div>`; });
  if (button.dataset.saveCalendars) run(() => saveGoogleCalendars({ connectionId: button.dataset.saveCalendars, calendarIds: [...document.querySelectorAll(".workroom-calendar-picker input:checked")].map((input) => input.value) }), "Calendars saved and synced.");
});

onAuthStateChanged(auth, async (user) => {
  cleanUp(); state.user = user;
  if (!user) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.remove("hidden"); elements.gateMessage.textContent = "Sign in with the Workroom owner account to continue."; return; }
  if (!isOwner(user)) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.add("hidden"); elements.gateMessage.textContent = "This private space is reserved for its owner."; return; }
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  await setDoc(workroomRef(user.uid), { title: "The Workroom", updatedAt: serverTimestamp() }, { merge: true });
  subscribe(user);
  const googleState = new URLSearchParams(window.location.search).get("google");
  const googleReason = new URLSearchParams(window.location.search).get("reason");
  if (googleState) { notice(googleState === "connected" ? "Google account connected." : `Google connection was not completed${googleReason ? ` (${googleReason}).` : "."}`, googleState !== "connected"); window.history.replaceState({}, "", "workroom-control.html"); }
});
