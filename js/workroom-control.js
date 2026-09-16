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
  calendarEventsRef,
  contactFollowUpsRef,
  connectionsRef,
  dateInputValue,
  escapeHtml,
  financeRef,
  formatDay,
  formatDateTime,
  ideasRef,
  priorityRank,
  projectsRef,
  resolveDeskSession,
  tasksRef,
  workroomRef,
  briefingRef,
  focusRef,
} from "./workroom-shared.js";
import { DESK_MODULES, DESK_PRESETS, modulesForPreset, normalizeDeskModules } from "./workroom-modules.js";

const $ = (id) => document.getElementById(id);
const elements = {
  gate: $("workroom-gate"), gateMessage: $("workroom-gate-message"), signIn: $("workroom-sign-in"), signOut: $("workroom-sign-out"), app: $("workroom-control"), notice: $("workroom-notice"), headerSubtitle: $("workroom-header-subtitle"),
  onboarding: $("workroom-onboarding"), onboardingForm: $("workroom-onboarding-form"), onboardingName: $("workroom-onboarding-name"), onboardingPresets: $("workroom-onboarding-presets"),
  settingsForm: $("workroom-settings-form"), settingsName: $("workroom-settings-name"), settingsPreset: $("workroom-settings-preset"), settingsModules: $("workroom-settings-modules"),
  automationForm: $("workroom-automation-form"), automationSource: $("workroom-automation-source"), automationText: $("workroom-automation-text"), automationVoice: $("workroom-automation-voice"),
  automationRefresh: $("workroom-automation-refresh"), automationUsage: $("workroom-automation-usage"), automationAudit: $("workroom-automation-audit"),
  sourceScan: $("workroom-source-scan"), sourceRefresh: $("workroom-source-refresh"), sourceStatus: $("workroom-source-status"), sourceHealth: $("workroom-source-health"), sourceCandidates: $("workroom-source-candidates"),
  contactForm: $("workroom-contact-form"), contactName: $("workroom-contact-name"), contactDate: $("workroom-contact-date"), contactReason: $("workroom-contact-reason"), contactMethod: $("workroom-contact-method"), contactDetail: $("workroom-contact-detail"), contacts: $("workroom-contacts"),
  projectForm: $("workroom-project-form"), projectTitle: $("workroom-project-title"), projectDate: $("workroom-project-date"), projectColor: $("workroom-project-color"), projects: $("workroom-projects"),
  taskForm: $("workroom-task-form"), taskTitle: $("workroom-task-title"), taskProject: $("workroom-task-project"), taskPriority: $("workroom-task-priority"), taskDate: $("workroom-task-date"), taskNotes: $("workroom-task-notes"), tasks: $("workroom-tasks"),
  ideaForm: $("workroom-idea-form"), ideaTitle: $("workroom-idea-title"), ideaBody: $("workroom-idea-body"), ideaTags: $("workroom-idea-tags"), ideaStatus: $("workroom-idea-status"), ideas: $("workroom-ideas"),
  financeForm: $("workroom-finance-form"), financeTitle: $("workroom-finance-title"), financeCategory: $("workroom-finance-category"), financeUrgency: $("workroom-finance-urgency"), financeDate: $("workroom-finance-date"), financeAmount: $("workroom-finance-amount"), financeReference: $("workroom-finance-reference"), finance: $("workroom-finance"),
  achForm: $("workroom-ach-form"), achName: $("workroom-ach-name"), achAmount: $("workroom-ach-amount"), achDate: $("workroom-ach-date"), achReason: $("workroom-ach-reason"), achRecurring: $("workroom-ach-recurring"), ach: $("workroom-ach"),
  calendarList: $("workroom-calendar-events-list"), calendarCount: $("workroom-calendar-count"),
  eventForm: $("workroom-event-form"), eventTitle: $("workroom-event-title"), eventDate: $("workroom-event-date"), eventTime: $("workroom-event-time"), eventAllDay: $("workroom-event-allday"), eventCategory: $("workroom-event-category"), eventLocation: $("workroom-event-location"), eventNotes: $("workroom-event-notes"),
  googleConnect: $("workroom-google-connect"), googleSync: $("workroom-google-sync"), connections: $("workroom-connections"), briefingGenerate: $("workroom-briefing-generate"), briefingCount: $("workroom-briefing-count"), briefingStatus: $("workroom-briefing-status"), briefingResult: $("workroom-briefing-result"), automationSummary: $("workroom-automation-summary"), todayStats: $("workroom-today-stats"), todayActions: $("workroom-today-actions"), quickAdd: $("workroom-quick-add"), quickAddDialog: $("workroom-quick-add-dialog"), guestDisplayForm: $("workroom-guest-display-form"), guestName: $("workroom-guest-name"), guestDisplayClear: $("workroom-guest-display-clear"), guestDisplayStatus: $("workroom-guest-display-status"),
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
const runSourceScan = httpsCallable(functions, "runWorkroomSourceScan");
const getSourceAutomationStatus = httpsCallable(functions, "getWorkroomSourceAutomationStatus");
const listSourceCandidates = httpsCallable(functions, "listWorkroomAutomationCandidates");
const approveSourceCandidate = httpsCallable(functions, "approveWorkroomAutomationCandidate");
const rejectSourceCandidate = httpsCallable(functions, "rejectWorkroomAutomationCandidate");
let state = { user: null, session: null, profile: null, modules: [], projects: [], tasks: [], ideas: [], finance: [], contacts: [], ach: [], calendarEvents: [], briefing: {}, focus: {}, connections: [], currentView: "today", quickAddType: "task", onboardingPreset: "pastor", unsubscribers: [] };
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
const hasModule = (moduleId) => state.modules.includes(moduleId);
const renderBriefingCount = () => {
  const count = Number(state.briefing.dailyRunCount || 0);
  if (elements.briefingCount) elements.briefingCount.textContent = `Today: ${count} run${count === 1 ? "" : "s"}`;
  if (elements.briefingStatus) {
    const generated = state.briefing.status === "error"
      ? `Latest review failed ${state.briefing.failedAt ? formatDateTime(state.briefing.failedAt) : ""}. ${clean(state.briefing.error)}`
      : state.briefing.generatedAt ? `Updated ${formatDateTime(state.briefing.generatedAt)}` : "Waiting for the first review.";
    const sources = state.briefing.sourceCounts ? `${Number(state.briefing.sourceCounts.recentMail || 0)} mail · ${Number(state.briefing.sourceCounts.slackMessages || 0)} Slack` : "";
    elements.briefingStatus.textContent = [generated, sources].filter(Boolean).join(" · ");
  }
  if (elements.briefingResult) {
    const sourceCounts = state.briefing.sourceCounts;
    const text = clean(state.briefing.text);
    if (!text || !sourceCounts) {
      elements.briefingResult.innerHTML = `<p class="workroom-empty">Run a review to see exactly what GPT checked and found.</p>`;
      return;
    }
    const sources = [
      ["tasks", "open tasks"], ["projects", "projects"], ["financeReminders", "finance reminders"], ["contactFollowUps", "follow-ups"], ["achEntries", "ACH entries"], ["calendarEvents", "calendar events"], ["recentMail", "email messages"], ["slackMessages", "Slack messages"],
    ].map(([key, label]) => `${Number(sourceCounts[key] || 0)} ${label}`).join(" · ");
    const syncNote = state.briefing.googleSyncError ? `<p class="workroom-briefing-warning">Google source issue: ${escapeHtml(state.briefing.googleSyncError)}</p>` : "";
    const failureNote = state.briefing.status === "error" ? `<p class="workroom-briefing-warning">Latest run failed: ${escapeHtml(state.briefing.error || "Unknown error")}</p>` : "";
    elements.briefingResult.innerHTML = `<p class="workroom-briefing-sources"><strong>Review receipt</strong> · ${escapeHtml(sources)}</p>${failureNote}${syncNote}<pre>${escapeHtml(text)}</pre>`;
  }
};

const renderGuestDisplay = () => {
  const guestWelcome = state.focus.guestWelcome || {};
  const name = clean(guestWelcome.name);
  const active = Boolean(guestWelcome.active && name);
  elements.guestDisplayStatus.textContent = active ? `${name} is on the TV welcome screen.` : "The TV is showing the dashboard.";
  elements.guestDisplayClear.disabled = !active;
};

const dateMillis = (value) => value?.toMillis?.() || 0;
const isOpen = (item) => item.status !== "done";
const isDueNow = (value) => value && dateMillis(value) <= Date.now() + 24 * 60 * 60 * 1000;
const renderToday = () => {
  const openTasks = state.tasks.filter(isOpen);
  const openContacts = hasModule("follow-ups") ? state.contacts.filter(isOpen) : [];
  const openFinance = hasModule("finance") ? state.finance.filter(isOpen) : [];
  const dueCount = [...openTasks.map((item) => item.dueDate), ...openContacts.map((item) => item.followUpDate), ...openFinance.map((item) => item.dueDate)].filter(isDueNow).length;
  if (elements.todayStats) elements.todayStats.innerHTML = [
    ["Open tasks", openTasks.length],
    ["Due now", dueCount],
    ...(hasModule("ideas") ? [["Active ideas", state.ideas.filter((idea) => idea.status !== "archived").length]] : []),
    ...(hasModule("follow-ups") ? [["Follow-ups", openContacts.length]] : []),
    ...(hasModule("finance") ? [["Finance", openFinance.length]] : []),
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
  const target = document.querySelector(`[data-workroom-view-panel="${view}"]`);
  if (!target || target.dataset.moduleHidden === "true") return;
  state.currentView = view;
  document.querySelectorAll("[data-workroom-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.workroomViewPanel !== view; panel.classList.toggle("is-active", panel.dataset.workroomViewPanel === view); });
  document.querySelectorAll(".workroom-view-tab").forEach((button) => { const active = button.dataset.workroomView === view; button.classList.toggle("is-active", active); button.setAttribute("aria-current", active ? "page" : "false"); });
  if (view === "automations") {
    refreshAutomationStatus(true);
    refreshSourceAutomation(true);
  }
};

const applyModuleVisibility = () => {
  document.querySelectorAll("[data-module]").forEach((element) => {
    const visible = hasModule(element.dataset.module);
    element.hidden = !visible;
    element.dataset.moduleHidden = String(!visible);
  });
  document.querySelectorAll("[data-module-any]").forEach((element) => {
    const visible = String(element.dataset.moduleAny || "").split(/\s+/).some(hasModule);
    element.hidden = !visible;
    element.dataset.moduleHidden = String(!visible);
  });
  document.querySelectorAll("[data-owner-only]").forEach((element) => { element.hidden = !state.session?.isAdmin; });
  document.querySelectorAll("[data-owner-fallback]").forEach((element) => {
    if (state.session?.isAdmin) { element.hidden = false; element.dataset.moduleHidden = "false"; }
  });
};

const renderProfileControls = () => {
  elements.headerSubtitle.textContent = state.profile.workspaceName;
  elements.settingsName.value = state.profile.workspaceName;
  elements.settingsPreset.innerHTML = Object.values(DESK_PRESETS).map((preset) => `<option value="${preset.id}" ${preset.id === state.profile.presetId ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("");
  elements.settingsModules.innerHTML = DESK_MODULES.map((module) => `<label class="workroom-module-option"><input type="checkbox" value="${module.id}" ${state.modules.includes(module.id) ? "checked" : ""} ${module.required ? "disabled" : ""} /><span><strong>${escapeHtml(module.label)}</strong><small>${escapeHtml(module.description)}</small></span></label>`).join("");
};

const profilePayload = ({ workspaceName, presetId, enabledModules }) => ({
  ownerUid: state.user.uid,
  email: state.user.email || "",
  displayName: state.user.displayName || state.user.email || "Desk user",
  workspaceName: clean(workspaceName),
  presetId,
  enabledModules: normalizeDeskModules(enabledModules, presetId),
  onboardingComplete: true,
  schemaVersion: 1,
  createdAt: state.profile?.createdAt || serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const saveProfile = async (values) => {
  const payload = profilePayload(values);
  await setDoc(workroomRef(state.user.uid), payload);
  state.session = await resolveDeskSession(state.user);
  state.profile = state.session.profile;
  state.modules = state.session.modules;
  applyModuleVisibility();
  renderProfileControls();
  subscribe(state.user);
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
  if (!state.user || !state.session?.isAdmin) {
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

const renderSourceAutomation = ({ status, candidates } = {}) => {
  if (!elements.sourceStatus || !elements.sourceHealth || !elements.sourceCandidates) return;
  const pending = Number(status?.pendingReviewCount || 0);
  elements.sourceStatus.textContent = status
    ? `${status.reviewOnly ? "Review-only mode" : "Auto-create enabled"} · ${pending} suggestion${pending === 1 ? "" : "s"} waiting.`
    : "Source Copilot is unavailable until you sign in.";
  const sources = Array.isArray(status?.sources) ? status.sources : [];
  elements.sourceHealth.innerHTML = sources.length ? sources.map((source) => {
    const details = source.lastError
      ? `Needs attention · ${source.lastError}`
      : source.lastSuccessAt
        ? `Last scan ${formatStatusStamp(source.lastSuccessAt)} · ${source.proposedCount} proposed`
        : "Not scanned yet";
    return `<div class="workroom-source-health-row"><strong>${escapeHtml(source.source === "gmail" ? "Gmail" : "Slack")}</strong><span>${escapeHtml(details)}</span></div>`;
  }).join("") : `<p class="workroom-empty">No source health available yet.</p>`;
  const items = Array.isArray(candidates) ? candidates : [];
  elements.sourceCandidates.innerHTML = items.length ? items.map((candidate) => {
    const dueDate = candidate.dueDate ? formatDay(candidate.dueDate) : "No due date";
    const source = [candidate.sourceType === "gmail" ? "Gmail" : "Slack", candidate.sourceAuthor, candidate.sourceSubject].filter(Boolean).join(" · ");
    const sourceLink = candidate.sourceUrl ? `<a href="${escapeHtml(candidate.sourceUrl)}" target="_blank" rel="noopener">Open source</a>` : "";
    return `<article class="workroom-source-candidate"><div><small>${escapeHtml(source)}</small><strong>${escapeHtml(candidate.title)}</strong><span><span class="workroom-priority ${escapeHtml(candidate.priority)}">${escapeHtml(candidate.priority)}</span> · ${escapeHtml(dueDate)} · ${Math.round(Number(candidate.confidence || 0) * 100)}%</span></div><p>${escapeHtml(candidate.reason)}</p><p class="workroom-source-excerpt">${escapeHtml(candidate.excerpt)}</p><div class="workroom-inline-actions"><button class="workroom-button workroom-button-primary" data-approve-source-candidate="${escapeHtml(candidate.id)}" type="button">Approve</button><button class="workroom-button workroom-button-quiet" data-reject-source-candidate="${escapeHtml(candidate.id)}" type="button">Dismiss</button>${sourceLink}</div></article>`;
  }).join("") : `<p class="workroom-empty">No source suggestions need review.</p>`;
};

const refreshSourceAutomation = async (quiet = false) => {
  if (!state.user || !state.session?.isAdmin) {
    renderSourceAutomation(null);
    return;
  }
  try {
    const [statusResult, candidatesResult] = await Promise.all([getSourceAutomationStatus(), listSourceCandidates()]);
    renderSourceAutomation({ status: statusResult.data || null, candidates: candidatesResult.data?.candidates || [] });
  } catch (error) {
    if (!quiet) notice(String(error.message || "Could not refresh Source Copilot."), true);
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

const renderIdeas = () => {
  const statusRank = { developing: 0, inbox: 1, archived: 2 };
  const sorted = [...state.ideas].sort((left, right) => (statusRank[left.status] ?? 3) - (statusRank[right.status] ?? 3) || String(left.title).localeCompare(String(right.title)));
  elements.ideas.innerHTML = sorted.length ? sorted.map((idea) => `<article class="workroom-panel workroom-idea ${idea.status === "archived" ? "is-archived" : ""}"><div class="workroom-panel-heading"><div><p class="workroom-panel-kicker">${escapeHtml(idea.status)}</p><h2>${escapeHtml(idea.title)}</h2></div><button class="workroom-icon-button" data-delete-idea="${idea.id}" type="button" aria-label="Delete ${escapeHtml(idea.title)}">×</button></div><p>${escapeHtml(idea.body || "No notes yet.")}</p><div class="workroom-idea-footer"><div>${(idea.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div><select data-idea-status="${idea.id}" aria-label="Status for ${escapeHtml(idea.title)}"><option value="inbox" ${idea.status === "inbox" ? "selected" : ""}>Inbox</option><option value="developing" ${idea.status === "developing" ? "selected" : ""}>Developing</option><option value="archived" ${idea.status === "archived" ? "selected" : ""}>Archived</option></select></div></article>`).join("") : `<p class="workroom-empty">Keep the first thought worth returning to.</p>`;
  renderToday();
};

const renderConnections = () => {
  elements.connections.innerHTML = state.connections.length ? state.connections.map((connection) => `<div class="workroom-connection"><div><strong>Google account</strong><small>${escapeHtml(connection.status)}${connection.lastSyncAt ? ` · synced ${formatDateTime(connection.lastSyncAt)}` : " · waiting for first sync"}${connection.error ? ` · ${escapeHtml(connection.error)}` : ""}</small></div><div class="workroom-connection-actions"><button class="workroom-button workroom-button-quiet" data-manage-connection="${connection.id}" type="button">Calendars</button><button class="workroom-button workroom-button-quiet" data-disconnect-connection="${connection.id}" type="button">Disconnect</button></div></div>`).join("") : `<p class="workroom-empty">No Google accounts connected yet.</p>`;
  if (elements.automationSummary) elements.automationSummary.textContent = state.connections.length ? `${state.connections.length} Google connection${state.connections.length === 1 ? "" : "s"} active.` : "Google is not connected yet.";
};

const renderCalendarEvents = () => {
  if (!elements.calendarList) return;
  const sorted = [...state.calendarEvents].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.time || "").localeCompare(String(b.time || "")));
  if (elements.calendarCount) {
    elements.calendarCount.textContent = `${sorted.length} event${sorted.length === 1 ? "" : "s"}`;
  }
  elements.calendarList.innerHTML = sorted.length
    ? sorted.map((evt) => {
      const timeLabel = evt.allDay ? "All day" : (evt.time || "No time specified");
      const meta = [evt.date, timeLabel, evt.category, evt.location].filter(Boolean).join(" · ");
      return `<div class="workroom-record">
        <div>
          <strong>${escapeHtml(evt.title)}</strong>
          <small>${escapeHtml(meta)}${evt.notes ? ` — ${escapeHtml(evt.notes)}` : ""}</small>
        </div>
        <button data-delete-event="${evt.id}" class="workroom-icon-button" aria-label="Delete ${escapeHtml(evt.title)}">×</button>
      </div>`;
    }).join("")
    : `<p class="workroom-empty">No events scheduled. Add an event to your calendar above.</p>`;
};

const subscribe = (user) => {
  cleanUp();
  state.projects = []; state.ideas = []; state.finance = []; state.contacts = []; state.ach = []; state.calendarEvents = []; state.connections = [];
  state.unsubscribers.push(onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderTasks(); }));
  state.unsubscribers.push(onSnapshot(calendarEventsRef(user.uid), (snapshot) => { state.calendarEvents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderCalendarEvents(); }));
  if (hasModule("projects")) state.unsubscribers.push(onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderProjects(); renderTasks(); }));
  if (hasModule("ideas")) state.unsubscribers.push(onSnapshot(ideasRef(user.uid), (snapshot) => { state.ideas = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderIdeas(); }));
  if (hasModule("finance")) state.unsubscribers.push(onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderFinance(); }));
  if (hasModule("follow-ups")) state.unsubscribers.push(onSnapshot(contactFollowUpsRef(user.uid), (snapshot) => { state.contacts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderContacts(); }));
  if (hasModule("ach")) state.unsubscribers.push(onSnapshot(achEntriesRef(user.uid), (snapshot) => { state.ach = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderAch(); }));
  if (state.session?.isAdmin) state.unsubscribers.push(onSnapshot(briefingRef(user.uid), (snapshot) => { state.briefing = snapshot.data() || {}; renderBriefingCount(); }));
  if (hasModule("guest-display")) state.unsubscribers.push(onSnapshot(focusRef(user.uid), (snapshot) => { state.focus = snapshot.data() || {}; renderGuestDisplay(); }));
  if (hasModule("google")) state.unsubscribers.push(onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); renderConnections(); }));
  renderToday();
};

const run = async (action, success) => { try { await action(); if (success) notice(success); } catch (error) { notice(String(error.message || "That did not work. Try again."), true); } };

elements.signIn.addEventListener("click", () => run(async () => signInWithPopup(auth, new GoogleAuthProvider())));
elements.signOut.addEventListener("click", () => signOut(auth));
elements.automationRefresh?.addEventListener("click", () => run(() => refreshAutomationStatus(), "Automation status refreshed."));
elements.sourceRefresh?.addEventListener("click", () => run(() => refreshSourceAutomation(), "Source Copilot refreshed."));
elements.sourceScan?.addEventListener("click", async () => {
  elements.sourceScan.disabled = true;
  await run(async () => {
    const result = await runSourceScan();
    const sources = Array.isArray(result.data?.sources) ? result.data.sources : [];
    const proposed = sources.reduce((total, source) => total + Number(source.proposedCount || 0), 0);
    await refreshSourceAutomation(true);
    notice(`Source scan complete. ${proposed} suggestion${proposed === 1 ? "" : "s"} ready for review.`);
  });
  elements.sourceScan.disabled = false;
});
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
elements.ideaForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { const tags = [...new Set(elements.ideaTags.value.split(",").map((tag) => clean(tag).toLowerCase()).filter(Boolean))].slice(0, 12); await addDoc(ideasRef(state.user.uid), { title: clean(elements.ideaTitle.value), body: clean(elements.ideaBody.value), tags, status: elements.ideaStatus.value, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.ideaForm.reset(); closeQuickAdd(); }, "Idea saved."); });
elements.financeForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { const amount = clean(elements.financeAmount.value); await addDoc(financeRef(state.user.uid), { title: clean(elements.financeTitle.value), category: clean(elements.financeCategory.value), urgency: elements.financeUrgency.value, dueDate: timestampForDate(elements.financeDate.value), reference: clean(elements.financeReference.value), amount: amount ? Number(amount) : null, status: "open", completedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.financeForm.reset(); closeQuickAdd(); }, "Reminder added."); });
elements.achForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await addDoc(achEntriesRef(state.user.uid), { name: clean(elements.achName.value), amount: Number(elements.achAmount.value), withdrawalDate: timestampForDate(elements.achDate.value), reason: clean(elements.achReason.value), recurring: elements.achRecurring.checked, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); elements.achForm.reset(); closeQuickAdd(); }, "ACH entry added."); });
elements.eventForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const isAllDay = Boolean(elements.eventAllDay.checked);
    await addDoc(calendarEventsRef(state.user.uid), {
      title: clean(elements.eventTitle.value),
      date: clean(elements.eventDate.value),
      time: isAllDay ? null : (clean(elements.eventTime.value) || null),
      allDay: isAllDay,
      category: clean(elements.eventCategory.value) || null,
      location: clean(elements.eventLocation.value) || null,
      notes: clean(elements.eventNotes.value) || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    elements.eventForm.reset();
    closeQuickAdd();
  }, "Event added to calendar.");
});
elements.googleConnect.addEventListener("click", () => run(async () => { const result = await googleConnect(); window.location.assign(result.data.authorizeUrl); }));
elements.googleSync.addEventListener("click", () => run(() => googleSync(), "Google data refreshed."));
elements.briefingGenerate?.addEventListener("click", async () => { elements.briefingGenerate.disabled = true; await run(() => generateBriefing(), "Review complete. The receipt below shows what GPT checked and found."); elements.briefingGenerate.disabled = false; });
elements.guestDisplayForm?.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { const name = clean(elements.guestName.value); if (!name) throw new Error("Add a guest name first."); await setDoc(focusRef(state.user.uid), { guestWelcome: { active: true, name, updatedAt: serverTimestamp() } }, { merge: true }); }, "Welcome screen is live on the TV."); });
elements.guestDisplayClear?.addEventListener("click", () => run(() => setDoc(focusRef(state.user.uid), { guestWelcome: { active: false, name: "", updatedAt: serverTimestamp() } }, { merge: true }), "TV dashboard restored."));
elements.settingsPreset.addEventListener("change", () => { const modules = modulesForPreset(elements.settingsPreset.value); elements.settingsModules.querySelectorAll("input").forEach((input) => { input.checked = modules.includes(input.value); }); });
elements.settingsForm.addEventListener("submit", (event) => { event.preventDefault(); run(() => saveProfile({ workspaceName: elements.settingsName.value, presetId: elements.settingsPreset.value, enabledModules: [...elements.settingsModules.querySelectorAll("input:checked")].map((input) => input.value) }), "Desk settings saved."); });
elements.onboardingForm.addEventListener("submit", (event) => { event.preventDefault(); run(async () => { await saveProfile({ workspaceName: elements.onboardingName.value, presetId: state.onboardingPreset, enabledModules: modulesForPreset(state.onboardingPreset) }); elements.onboarding.classList.add("hidden"); elements.app.classList.remove("hidden"); }, "Your Desk is ready."); });
elements.quickAdd?.addEventListener("click", () => openQuickAdd());
document.querySelectorAll("[data-workroom-view]").forEach((button) => button.addEventListener("click", () => setActiveView(button.dataset.workroomView)));
document.querySelectorAll("[data-open-quick-add]").forEach((button) => button.addEventListener("click", () => openQuickAdd(button.dataset.openQuickAdd)));
document.querySelectorAll("[data-close-quick-add]").forEach((button) => button.addEventListener("click", closeQuickAdd));
document.querySelectorAll("[data-quick-add-type]").forEach((button) => button.addEventListener("click", () => setQuickAddType(button.dataset.quickAddType)));
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.quickAddDialog.hidden) closeQuickAdd(); });

document.addEventListener("click", (event) => {
  const closeTarget = event.target.closest("[data-close-quick-add]");
  if (closeTarget) { closeQuickAdd(); return; }
  const button = event.target.closest("button"); if (!button || !state.user) return;
  const taskId = button.dataset.completeTask; const financeId = button.dataset.completeFinance;
  if (button.dataset.deleteProject) run(() => deleteDoc(doc(projectsRef(state.user.uid), button.dataset.deleteProject)));
  if (button.dataset.deleteTask) run(() => deleteDoc(doc(tasksRef(state.user.uid), button.dataset.deleteTask)));
  if (button.dataset.deleteFinance) run(() => deleteDoc(doc(financeRef(state.user.uid), button.dataset.deleteFinance)));
  if (button.dataset.deleteContact) run(() => deleteDoc(doc(contactFollowUpsRef(state.user.uid), button.dataset.deleteContact)));
  if (button.dataset.deleteAch) run(() => deleteDoc(doc(achEntriesRef(state.user.uid), button.dataset.deleteAch)));
  if (button.dataset.deleteIdea) run(() => deleteDoc(doc(ideasRef(state.user.uid), button.dataset.deleteIdea)), "Idea deleted.");
  if (button.dataset.deleteEvent) run(() => deleteDoc(doc(calendarEventsRef(state.user.uid), button.dataset.deleteEvent)), "Event deleted.");
  if (taskId) { const task = state.tasks.find((item) => item.id === taskId); run(() => updateDoc(doc(tasksRef(state.user.uid), taskId), { status: task.status === "done" ? "next" : "done", completedAt: task.status === "done" ? null : new Date(), updatedAt: serverTimestamp() })); }
  if (financeId) { const item = state.finance.find((record) => record.id === financeId); run(() => updateDoc(doc(financeRef(state.user.uid), financeId), { status: item.status === "done" ? "open" : "done", completedAt: item.status === "done" ? null : new Date(), updatedAt: serverTimestamp() })); }
  if (button.dataset.completeContact) { const item = state.contacts.find((record) => record.id === button.dataset.completeContact); run(() => updateDoc(doc(contactFollowUpsRef(state.user.uid), item.id), { status: item.status === "done" ? "open" : "done", completedAt: item.status === "done" ? null : new Date(), updatedAt: serverTimestamp() })); }
  if (button.dataset.disconnectConnection) run(() => googleDisconnect({ connectionId: button.dataset.disconnectConnection }), "Google account disconnected.");
  if (button.dataset.approveSourceCandidate) run(async () => { await approveSourceCandidate({ candidateId: button.dataset.approveSourceCandidate }); await refreshSourceAutomation(true); }, "Task created from source suggestion.");
  if (button.dataset.rejectSourceCandidate) run(async () => { await rejectSourceCandidate({ candidateId: button.dataset.rejectSourceCandidate }); await refreshSourceAutomation(true); }, "Source suggestion dismissed.");
  if (button.dataset.manageConnection) run(async () => { const connectionId = button.dataset.manageConnection; const result = await googleCalendars({ connectionId }); const selected = state.connections.find((item) => item.id === connectionId)?.selectedCalendars || []; const choices = result.data.calendars.map((calendar) => `<label class="workroom-calendar-choice"><input type="checkbox" value="${escapeHtml(calendar.id)}" ${selected.includes(calendar.id) ? "checked" : ""} /> ${escapeHtml(calendar.summary)}${calendar.primary ? " (primary)" : ""}</label>`).join(""); elements.connections.innerHTML = `<div class="workroom-calendar-picker" data-connection-id="${connectionId}"><strong>Choose calendars for the TV</strong>${choices}<button class="workroom-button workroom-button-primary" data-save-calendars="${connectionId}" type="button">Save calendars</button></div>`; });
  if (button.dataset.saveCalendars) run(() => saveGoogleCalendars({ connectionId: button.dataset.saveCalendars, calendarIds: [...document.querySelectorAll(".workroom-calendar-picker input:checked")].map((input) => input.value) }), "Calendars saved and synced.");
});

document.addEventListener("change", (event) => {
  const status = event.target.closest("[data-idea-status]");
  if (status) run(() => updateDoc(doc(ideasRef(state.user.uid), status.dataset.ideaStatus), { status: status.value, updatedAt: serverTimestamp() }), "Idea updated.");
});

onAuthStateChanged(auth, async (user) => {
  cleanUp();
  clearAutomationStatusTimer();
  state.user = user;
  state.session = null; state.profile = null; state.modules = [];
  if (!user) { elements.app.classList.add("hidden"); elements.onboarding.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.remove("hidden"); elements.gateMessage.textContent = "Sign in to open your Desk."; renderAutomationStatus(null); return; }
  try { state.session = await resolveDeskSession(user); } catch (error) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.add("hidden"); elements.gateMessage.textContent = `Desk access could not be checked: ${error.message || "unknown error"}`; return; }
  if (!state.session.hasDeskAccess) { elements.app.classList.add("hidden"); elements.onboarding.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.add("hidden"); elements.gateMessage.textContent = state.session.approvalStatus === "pending" ? "Your Desk request is waiting for approval." : "This account has not been granted Desk access."; renderAutomationStatus(null); return; }
  state.profile = state.session.profile; state.modules = state.session.modules;
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  elements.onboardingPresets.innerHTML = Object.values(DESK_PRESETS).filter((preset) => preset.id !== "full" || state.session.isAdmin).map((preset) => `<label class="workroom-preset-option"><input type="radio" name="desk-preset" value="${preset.id}" ${preset.id === state.onboardingPreset ? "checked" : ""} /><span><strong>${escapeHtml(preset.label)}</strong><small>${escapeHtml(preset.description)}</small></span></label>`).join("");
  elements.onboardingPresets.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => { state.onboardingPreset = input.value; }));
  applyModuleVisibility(); renderProfileControls();
  if (!state.profile.onboardingComplete) { elements.app.classList.add("hidden"); elements.onboarding.classList.remove("hidden"); elements.onboardingName.value = state.profile.workspaceName; return; }
  subscribe(user);
  if (state.session.isAdmin) { await refreshAutomationStatus(true); await refreshSourceAutomation(true); automationStatusInterval = window.setInterval(() => { refreshAutomationStatus(true); }, 60_000); }
  const googleState = new URLSearchParams(window.location.search).get("google");
  const googleReason = new URLSearchParams(window.location.search).get("reason");
  if (googleState) { notice(googleState === "connected" ? "Google account connected." : `Google connection was not completed${googleReason ? ` (${googleReason}).` : "."}`, googleState !== "connected"); window.history.replaceState({}, "", "workroom-control.html"); }
  if (state.session.isAdmin) setVoiceButton();
});
