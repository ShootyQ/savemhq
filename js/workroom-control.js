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
  briefingRef,
} from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = {
  gate: $("workroom-gate"), gateMessage: $("workroom-gate-message"), signIn: $("workroom-sign-in"), signOut: $("workroom-sign-out"), app: $("workroom-control"), notice: $("workroom-notice"),
  automationForm: $("workroom-automation-form"), automationSource: $("workroom-automation-source"), automationText: $("workroom-automation-text"), automationVoice: $("workroom-automation-voice"),
  automationRefresh: $("workroom-automation-refresh"), automationUsage: $("workroom-automation-usage"), automationAudit: $("workroom-automation-audit"),
  contactForm: $("workroom-contact-form"), contactName: $("workroom-contact-name"), contactDate: $("workroom-contact-date"), contactReason: $("workroom-contact-reason"), contactMethod: $("workroom-contact-method"), contactDetail: $("workroom-contact-detail"), contacts: $("workroom-contacts"),
  projectForm: $("workroom-project-form"), projectTitle: $("workroom-project-title"), projectDate: $("workroom-project-date"), projectColor: $("workroom-project-color"), projects: $("workroom-projects"),
  taskForm: $("workroom-task-form"), taskTitle: $("workroom-task-title"), taskProject: $("workroom-task-project"), taskPriority: $("workroom-task-priority"), taskDate: $("workroom-task-date"), taskNotes: $("workroom-task-notes"), tasks: $("workroom-tasks"),
  financeForm: $("workroom-finance-form"), financeTitle: $("workroom-finance-title"), financeCategory: $("workroom-finance-category"), financeUrgency: $("workroom-finance-urgency"), financeDate: $("workroom-finance-date"), financeAmount: $("workroom-finance-amount"), financeReference: $("workroom-finance-reference"), finance: $("workroom-finance"),
  achForm: $("workroom-ach-form"), achName: $("workroom-ach-name"), achAmount: $("workroom-ach-amount"), achDate: $("workroom-ach-date"), achReason: $("workroom-ach-reason"), achRecurring: $("workroom-ach-recurring"), ach: $("workroom-ach"),
  googleConnect: $("workroom-google-connect"), googleSync: $("workroom-google-sync"), connections: $("workroom-connections"), briefingGenerate: $("workroom-briefing-generate"), briefingCount: $("workroom-briefing-count"), briefingStatus: $("workroom-briefing-status"), automationSummary: $("workroom-automation-summary"), todayStats: $("workroom-today-stats"), todayActions: $("workroom-today-actions"), quickAdd: $("workroom-quick-add"), quickAddDialog: $("workroom-quick-add-dialog"),
};
const functions = getFunctions();
const googleConnect = httpsCallable(functions, "createWorkroomGoogleAuthSession");
const googleSync = httpsCallable(functions, "syncWorkroomGoogle");
const googleDisconnect = httpsCallable(functions, "disconnectWorkroomGoogle");
const googleCalendars = httpsCallable(functions, "listWorkroomGoogleCalendars");
const saveGoogleCalendars = httpsCallable(functions, "setWorkroomGoogleCalendars");
const generateBriefing = httpsCallable(functions, "generateWorkroomBriefing");
const parseAutomationText = httpsCallable(functions, "parseWorkroomAutomationText");
const getAutomationStatus = httpsCallable(functions, "getWorkroomAutomationStatus");
let state = { user: null, projects: [], tasks: [], finance: [], contacts: [], ach: [], briefing: {}, connections: [], currentView: "today", quickAddType: "task", unsubscribers: [] };
let speechRecognition = null;
let speechActive = false;
let automationStatusInterval = null;

const notice = (message = "", error = false) => {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("is-error", error);
};
const clean = (value) => String(value || "").trim();
const timestampForDate = (value) => value ? new Date(`${value}T12:00:00`) : null;
const cleanUp = () => { state.unsubscribers.forEach((unsubscribe) => unsubscribe()); state.unsubscribers = []; };
const renderBriefingCount = () => {
  const count = Number(state.briefing.dailyRunCount || 0);
  if (elements.briefingCount) elements.briefingCount.textContent = `Today: ${count} run${count === 1 ? "" : "s"}`;
  if (elements.briefingStatus) {
    const generated = state.briefing.generatedAt ? `Updated ${formatDateTime(state.briefing.generatedAt)}` : "Waiting for the first review.";
    const sources = state.briefing.sourceCounts ? `${Number(state.briefing.sourceCounts.recentMail || 0)} mail · ${Number(state.briefing.sourceCounts.slackMessages || 0)} Slack` : "";
    elements.briefingStatus.textContent = [generated, sources].filter(Boolean).join(" · ");
  }
};

const dateMillis = (value) => value?.toMillis?.() || 0;
const isOpen = (item) => item.status !== "done";
const isDueNow = (value) => value && dateMillis(value) <= Date.now() + 24 * 60 * 60 * 1000;
const renderToday = () => {
  const openTasks = state.tasks.filter(isOpen);
  const openContacts = state.contacts.filter(isOpen);
  const openFinance = state.finance.filter(isOpen);
  const dueCount = [...openTasks.map((item) => item.dueDate), ...openContacts.map((item) => item.followUpDate), ...openFinance.map((item) => item.dueDate)].filter(isDueNow).length;
  if (elements.todayStats) elements.todayStats.innerHTML = [
    ["Open tasks", openTasks.length], ["Due now", dueCount], ["Follow-ups", openContacts.length], ["Finance", openFinance.length],
  ].map(([label, value]) => `<div class="workroom-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  if (!elements.todayActions) return;
  const items = [
    ...openTasks.map((item) => ({ ...item, itemType: "Task", date: item.dueDate, priority: item.priority, complete: "task" })),
    ...openContacts.map((item) => ({ ...item, itemType: "Follow-up", title: item.name, date: item.followUpDate, priority: "medium", complete: "contact", detail: item.reason })),
    ...openFinance.map((item) => ({ ...item, itemType: "Finance", date: item.dueDate, priority: item.urgency, complete: "finance", detail: item.category })),
  ].sort((left, right) => (dateMillis(left.date) || Number.MAX_SAFE_INTEGER) - (dateMillis(right.date) || Number.MAX_SAFE_INTEGER) || priorityRank(left.priority) - priorityRank(right.priority)).slice(0, 12);
  elements.todayActions.innerHTML = items.length ? items.map((item) => {
    const actionAttribute = item.complete === "task" ? `data-complete-task="${item.id}"` : item.complete === "contact" ? `data-complete-contact="${item.id}"` : `data-complete-finance="${item.id}"`;
    const due = item.date ? formatDay(item.date) : "No date";
    return `<div class="workroom-action-row priority-${escapeHtml(item.priority)}"><button ${actionAttribute} class="workroom-check" aria-label="Complete ${escapeHtml(item.title)}" type="button"></button><div><small>${escapeHtml(item.itemType)} · ${escapeHtml(item.priority)}</small><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(due)}${item.detail ? ` · ${escapeHtml(item.detail)}` : ""}</span></div></div>`;
  }).join("") : `<p class="workroom-empty">Your action queue is clear.</p>`;
};

const setActiveView = (view) => {
  state.currentView = view;
  document.querySelectorAll("[data-workroom-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.workroomViewPanel !== view; panel.classList.toggle("is-active", panel.dataset.workroomViewPanel === view); });
  document.querySelectorAll(".workroom-view-tab").forEach((button) => { const active = button.dataset.workroomView === view; button.classList.toggle("is-active", active); button.setAttribute("aria-current", active ? "page" : "false"); });
  if (view === "automations") refreshAutomationStatus(true);
};

const setQuickAddType = (type) => {
  state.quickAddType = type;
  document.querySelectorAll("[data-quick-add-form]").forEach((form) => { form.hidden = form.dataset.quickAddForm !== type; });
  document.querySelectorAll("[data-quick-add-type]").forEach((button) => button.classList.toggle("is-active", button.dataset.quickAddType === type));
  const form = document.querySelector(`[data-quick-add-form="${type}"]`);
  const title = form?.querySelector("input, textarea, select");
  if (title) window.setTimeout(() => title.focus(), 0);
};

const openQuickAdd = (type = "task") => { elements.quickAddDialog.hidden = false; document.body.classList.add("workroom-dialog-open"); setQuickAddType(type); };
const closeQuickAdd = () => { elements.quickAddDialog.hidden = true; document.body.classList.remove("workroom-dialog-open"); elements.quickAdd?.focus(); };

const clearAutomationStatusTimer = () => {
  if (automationStatusInterval) {
    window.clearInterval(automationStatusInterval);
    automationStatusInterval = null;
  }
};

const formatStatusStamp = (value) => {
  if (!value) return "";
  return formatDateTime(value);
};

const renderAutomationStatus = (status = null) => {
  if (!elements.automationUsage || !elements.automationAudit) return;
  if (!status) {
    elements.automationUsage.textContent = "Usage data will appear after sign-in.";
    elements.automationAudit.innerHTML = `<p class="workroom-empty">No action history yet.</p>`;
    return;
  }

  const totalUsed = Number(status.counts?.total || 0);
  const totalLimit = Number(status.limits?.total || 0);
  const totalRemaining = Number(status.remaining?.total || 0);
  elements.automationUsage.textContent = `Today ${status.dateKey}: ${totalUsed}/${totalLimit} used · ${totalRemaining} remaining. Tasks ${status.counts?.createTask || 0}/${status.limits?.createTask || 0}, Projects ${status.counts?.createProject || 0}/${status.limits?.createProject || 0}, Finance ${status.counts?.createFinanceReminder || 0}/${status.limits?.createFinanceReminder || 0}, Follow-ups ${status.counts?.createContactFollowUp || 0}/${status.limits?.createContactFollowUp || 0}, ACH ${status.counts?.createAchEntry || 0}/${status.limits?.createAchEntry || 0}.`;

  const recent = Array.isArray(status.recent) ? status.recent : [];
  elements.automationAudit.innerHTML = recent.length
    ? recent.map((entry) => {
      const when = formatStatusStamp(entry.completedAt || entry.failedAt || entry.createdAt);
      const details = [entry.operation || "action", entry.status || "unknown", when ? `at ${when}` : ""]
        .filter(Boolean)
        .join(" · ");
      const message = entry.errorMessage || (entry.createdId ? `Created ${entry.createdId}` : "No write");
      return `<div class="workroom-record"><div><strong>${escapeHtml(entry.requestId || entry.id || "request")}</strong><small>${escapeHtml(details)} · ${escapeHtml(message)}</small></div></div>`;
    }).join("")
    : `<p class="workroom-empty">No action history yet.</p>`;
};

const refreshAutomationStatus = async (quiet = false) => {
  if (!state.user || !isOwner(state.user)) {
    renderAutomationStatus(null);
    return;
  }
  try {
    const result = await getAutomationStatus();
    renderAutomationStatus(result.data || null);
  } catch (error) {
    if (!quiet) notice(String(error.message || "Could not refresh automation status."), true);
  }
};

const setVoiceButton = () => {
  if (!elements.automationVoice) return;
  elements.automationVoice.disabled = false;
  elements.automationVoice.textContent = speechActive ? "Stop voice capture" : "Start voice capture";
};

const appendAutomationText = (snippet) => {
  const next = clean(snippet);
  if (!next) return;
  const current = String(elements.automationText.value || "").trim();
  elements.automationText.value = current ? `${current}\n${next}` : next;
};

const ensureVoiceCapture = () => {
  if (speechRecognition !== null) return speechRecognition;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = "en-US";
  speechRecognition.interimResults = true;
  speechRecognition.continuous = true;
  speechRecognition.addEventListener("result", (event) => {
    let finalChunk = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) {
        finalChunk += ` ${event.results[index][0].transcript || ""}`;
      }
    }
    appendAutomationText(finalChunk);
  });
  speechRecognition.addEventListener("end", () => {
    speechActive = false;
    setVoiceButton();
  });
  speechRecognition.addEventListener("error", () => {
    speechActive = false;
    setVoiceButton();
    notice("Voice capture hit an issue. You can keep typing instead.", true);
  });
  return speechRecognition;
};

const toggleVoiceCapture = () => {
  const instance = ensureVoiceCapture();
  if (!instance) {
    notice("Voice capture is not available in this browser yet.", true);
    return;
  }
  if (speechActive) {
    instance.stop();
    speechActive = false;
    setVoiceButton();
    return;
  }
  instance.start();
  speechActive = true;
  setVoiceButton();
  notice("Voice capture is running. Speak naturally and then stop capture.");
};

const renderProjects = () => {
  const sorted = [...state.projects].sort((a, b) => String(a.targetDate?.toMillis?.() || 0).localeCompare(String(b.targetDate?.toMillis?.() || 0)));
  elements.projects.innerHTML = sorted.length ? sorted.map((project) => `<div class="workroom-record"><span class="workroom-color-dot ${escapeHtml(project.color)}"></span><div><strong>${escapeHtml(project.title)}</strong><small>${project.targetDate ? `Target ${formatDay(project.targetDate)}` : "No target date"}</small></div><button data-delete-project="${project.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(project.title)}">×</button></div>`).join("") : `<p class="workroom-empty">Start with the work you want to move forward.</p>`;
  elements.taskProject.innerHTML = `<option value="">No project</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.title)}</option>`).join("")}`;
  renderToday();
};

const renderTasks = () => {
  const projectNames = new Map(state.projects.map((project) => [project.id, project.title]));
  const sorted = [...state.tasks].sort((a, b) => (a.status === "done") - (b.status === "done") || priorityRank(a.priority) - priorityRank(b.priority) || (a.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.tasks.innerHTML = sorted.length ? sorted.map((task) => `<div class="workroom-record ${task.status === "done" ? "is-done" : ""}"><button data-complete-task="${task.id}" class="workroom-check" aria-label="${task.status === "done" ? "Reopen" : "Complete"} ${escapeHtml(task.title)}">${task.status === "done" ? "✓" : ""}</button><div><strong>${escapeHtml(task.title)}</strong><small><span class="workroom-priority ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>${task.projectId ? ` · ${escapeHtml(projectNames.get(task.projectId) || "Archived project")}` : ""}${task.dueDate ? ` · ${formatDay(task.dueDate)}` : ""}</small></div><button data-delete-task="${task.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(task.title)}">×</button></div>`).join("") : `<p class="workroom-empty">Your action queue is clear.</p>`;
  renderToday();
};

const renderFinance = () => {
  const sorted = [...state.finance].sort((a, b) => (a.status === "done") - (b.status === "done") || priorityRank(a.urgency) - priorityRank(b.urgency) || (a.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.dueDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.finance.innerHTML = sorted.length ? sorted.map((item) => `<div class="workroom-record ${item.status === "done" ? "is-done" : ""}"><button data-complete-finance="${item.id}" class="workroom-check" aria-label="${item.status === "done" ? "Reopen" : "Complete"} ${escapeHtml(item.title)}">${item.status === "done" ? "✓" : ""}</button><div><strong>${escapeHtml(item.title)}</strong><small><span class="workroom-priority ${escapeHtml(item.urgency)}">${escapeHtml(item.urgency)}</span> · ${escapeHtml(item.category || "Reminder")}${item.dueDate ? ` · ${formatDay(item.dueDate)}` : ""}${item.amount != null ? ` · $${Number(item.amount).toFixed(2)}` : ""}</small></div><button data-delete-finance="${item.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(item.title)}">×</button></div>`).join("") : `<p class="workroom-empty">No finance reminders are waiting.</p>`;
  renderToday();
};

const renderContacts = () => {
  const sorted = [...state.contacts].sort((a, b) => (a.status === "done") - (b.status === "done") || (a.followUpDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.followUpDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.contacts.innerHTML = sorted.length ? sorted.map((item) => `<div class="workroom-record ${item.status === "done" ? "is-done" : ""}"><button data-complete-contact="${item.id}" class="workroom-check" aria-label="${item.status === "done" ? "Reopen" : "Complete"} follow-up with ${escapeHtml(item.name)}">${item.status === "done" ? "✓" : ""}</button><div><strong>${escapeHtml(item.name)}</strong><small>${item.followUpDate ? formatDay(item.followUpDate) : "No date"} · ${escapeHtml(item.method)} · ${escapeHtml(item.contactDetail)} · ${escapeHtml(item.reason)}</small></div><button data-delete-contact="${item.id}" class="workroom-icon-button" aria-label="Delete follow-up with ${escapeHtml(item.name)}">×</button></div>`).join("") : `<p class="workroom-empty">No follow-ups waiting.</p>`;
  renderToday();
};

const renderAch = () => {
  const sorted = [...state.ach].sort((a, b) => (a.withdrawalDate?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (b.withdrawalDate?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  elements.ach.innerHTML = sorted.length ? sorted.map((item) => `<div class="workroom-record"><div><strong>${escapeHtml(item.name)} · $${Number(item.amount || 0).toFixed(2)}</strong><small>${item.withdrawalDate ? formatDay(item.withdrawalDate) : "No date"} · ${escapeHtml(item.reason)}${item.recurring ? " · recurring" : ""}</small></div><button data-delete-ach="${item.id}" class="workroom-icon-button" aria-label="Delete ACH entry for ${escapeHtml(item.name)}">×</button></div>`).join("") : `<p class="workroom-empty">No ACH entries waiting.</p>`;
};

const renderConnections = () => {
  elements.connections.innerHTML = state.connections.length ? state.connections.map((connection) => `<div class="workroom-connection"><div><strong>Google account</strong><small>${escapeHtml(connection.status)}${connection.lastSyncAt ? ` · synced ${formatDateTime(connection.lastSyncAt)}` : " · waiting for first sync"}${connection.error ? ` · ${escapeHtml(connection.error)}` : ""}</small></div><div class="workroom-connection-actions"><button class="workroom-button workroom-button-quiet" data-manage-connection="${connection.id}" type="button">Calendars</button><button class="workroom-button workroom-button-quiet" data-disconnect-connection="${connection.id}" type="button">Disconnect</button></div></div>`).join("") : `<p class="workroom-empty">No Google accounts connected yet.</p>`;
  if (elements.automationSummary) elements.automationSummary.textContent = state.connections.length ? `${state.connections.length} Google connection${state.connections.length === 1 ? "" : "s"} active.` : "Google is not connected yet.";
};

const subscribe = (user) => {
  cleanUp();
  state.unsubscribers.push(
    onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderProjects(); renderTasks(); }),
    onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderTasks(); }),
    onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderFinance(); }),
    onSnapshot(contactFollowUpsRef(user.uid), (snapshot) => { state.contacts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderContacts(); }),
    onSnapshot(achEntriesRef(user.uid), (snapshot) => { state.ach = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAch(); }),
    onSnapshot(briefingRef(user.uid), (snapshot) => { state.briefing = snapshot.data() || {}; renderBriefingCount(); }),
    onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderConnections(); }),
  );
};

const run = async (action, success) => { try { await action(); if (success) notice(success); } catch (error) { notice(String(error.message || "That did not work. Try again."), true); } };

elements.signIn.addEventListener("click", () => run(async () => signInWithPopup(auth, new GoogleAuthProvider())));
elements.signOut.addEventListener("click", () => signOut(auth));
elements.automationRefresh?.addEventListener("click", () => run(() => refreshAutomationStatus(), "Automation status refreshed."));
elements.automationVoice?.addEventListener("click", () => toggleVoiceCapture());
elements.automationForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const text = clean(elements.automationText.value);
    if (!text) throw new Error("Add some text to parse first.");
    const result = await parseAutomationText({ source: elements.automationSource.value, text });
    const created = Number(result.data?.createdCount || 0);
    const skipped = Number(result.data?.skippedCount || 0);
    if (created) {
      elements.automationText.value = "";
      notice(`Created ${created} task${created === 1 ? "" : "s"}${skipped ? ` (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped).` : "."}`);
    } else {
      notice(`No tasks were created${skipped ? ` (${skipped} duplicate${skipped === 1 ? "" : "s"} skipped).` : "."}`);
    }
    await refreshAutomationStatus(true);
  });
});
elements.contactForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(contactFollowUpsRef(state.user.uid), { name: clean(elements.contactName.value), followUpDate: timestampForDate(elements.contactDate.value), reason: clean(elements.contactReason.value), method: elements.contactMethod.value, contactDetail: clean(elements.contactDetail.value), status: "open", completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.contactForm.reset(); closeQuickAdd(); }, "Follow-up added."); });
elements.projectForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(projectsRef(state.user.uid), { title: clean(elements.projectTitle.value), status: "active", color: elements.projectColor.value, outcome: "", targetDate: timestampForDate(elements.projectDate.value), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.projectForm.reset(); closeQuickAdd(); }, "Project added."); });
elements.taskForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(tasksRef(state.user.uid), { title: clean(elements.taskTitle.value), projectId: elements.taskProject.value, status: "next", priority: elements.taskPriority.value, dueDate: timestampForDate(elements.taskDate.value), notes: clean(elements.taskNotes.value), completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.taskForm.reset(); closeQuickAdd(); }, "Task added."); });
elements.financeForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { const amount = clean(elements.financeAmount.value); await addDoc(financeRef(state.user.uid), { title: clean(elements.financeTitle.value), category: clean(elements.financeCategory.value), urgency: elements.financeUrgency.value, dueDate: timestampForDate(elements.financeDate.value), reference: clean(elements.financeReference.value), amount: amount ? Number(amount) : null, status: "open", completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.financeForm.reset(); closeQuickAdd(); }, "Reminder added."); });
elements.achForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(achEntriesRef(state.user.uid), { name: clean(elements.achName.value), amount: Number(elements.achAmount.value), withdrawalDate: timestampForDate(elements.achDate.value), reason: clean(elements.achReason.value), recurring: elements.achRecurring.checked, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.achForm.reset(); closeQuickAdd(); }, "ACH entry added."); });
elements.googleConnect.addEventListener("click", () => run(async () => { const result = await googleConnect(); window.location.assign(result.data.authorizeUrl); }));
elements.googleSync.addEventListener("click", () => run(() => googleSync(), "Google data refreshed."));
elements.briefingGenerate?.addEventListener("click", async () => { elements.briefingGenerate.disabled = true; await run(() => generateBriefing(), "Email + Slack review complete. Open the TV display to see it."); elements.briefingGenerate.disabled = false; });
elements.quickAdd?.addEventListener("click", () => openQuickAdd());
document.querySelectorAll("[data-workroom-view]").forEach((button) => button.addEventListener("click", () => setActiveView(button.dataset.workroomView)));
document.querySelectorAll("[data-open-quick-add]").forEach((button) => button.addEventListener("click", () => openQuickAdd(button.dataset.openQuickAdd)));
document.querySelectorAll("[data-close-quick-add]").forEach((button) => button.addEventListener("click", closeQuickAdd));
document.querySelectorAll("[data-quick-add-type]").forEach((button) => button.addEventListener("click", () => setQuickAddType(button.dataset.quickAddType)));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.quickAddDialog.hidden) closeQuickAdd(); });

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
  cleanUp();
  clearAutomationStatusTimer();
  state.user = user;
  if (!user) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.remove("hidden"); elements.gateMessage.textContent = "Sign in with the Workroom owner account to continue."; renderAutomationStatus(null); return; }
  if (!isOwner(user)) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.add("hidden"); elements.gateMessage.textContent = "This private space is reserved for its owner."; renderAutomationStatus(null); return; }
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  await setDoc(workroomRef(user.uid), { title: "The Workroom", updatedAt: serverTimestamp() }, { merge: true });
  subscribe(user);
  await refreshAutomationStatus(true);
  automationStatusInterval = window.setInterval(() => { refreshAutomationStatus(true); }, 60_000);
  const googleState = new URLSearchParams(window.location.search).get("google");
  const googleReason = new URLSearchParams(window.location.search).get("reason");
  if (googleState) { notice(googleState === "connected" ? "Google account connected." : `Google connection was not completed${googleReason ? ` (${googleReason}).` : "."}`, googleState !== "connected"); window.history.replaceState({}, "", "workroom-control.html"); }
  setVoiceButton();
});
