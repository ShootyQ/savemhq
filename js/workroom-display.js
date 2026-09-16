import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth } from "./auth-shared.js";
import { achEntriesRef, actionStatesRef, asDate, briefingRef, calendarEventsRef, contactFollowUpsRef, connectionsRef, escapeHtml, financeRef, focusRef, formatDay, formatDateTime, ideasRef, monthlyBillCyclesRef, monthlyBillVendorsRef, paymentEntrySourcesRef, priorityRank, projectsRef, resolveDeskSession, summaryRef, tasksRef } from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = {
  gate: $("workroom-display-gate"), gateMessage: $("workroom-display-gate-message"), signIn: $("workroom-display-sign-in"), app: $("workroom-display-app"), guestWelcome: $("workroom-guest-welcome"), guestWelcomeName: $("workroom-guest-welcome-name"), clock: $("workroom-clock"), date: $("workroom-date"), completedCount: $("workroom-completed-count"), overdueCount: $("workroom-overdue-count"), overdueStat: $("workroom-overdue-stat"), allCount: $("workroom-all-count"), billsCount: $("workroom-bills-count"), paymentEntriesCount: $("workroom-payment-entries-count"), dayline: $("workroom-dayline-events"), clearPin: $("workroom-clear-pin"), tasks: $("workroom-display-tasks"), radarTitle: $("workroom-radar-title"), radarTabs: $("workroom-radar-tabs"), radar: $("workroom-radar-list"), footer: $("workroom-context-footer"), completeToast: $("workroom-complete-toast"), allDialog: $("workroom-all-dialog"), allGroups: $("workroom-all-groups"), operationsDialog: $("workroom-operations-dialog"), operationsTabs: $("workroom-operations-tabs"), operationsContent: $("workroom-operations-content"), openOperations: $("workroom-open-operations"), openAll: $("workroom-open-all"), viewAll: $("workroom-view-all"), openBriefing: $("workroom-open-briefing"),
  openSprint: $("workroom-open-sprint"), sprintLauncherText: $("workroom-sprint-launcher-text"),
  focusOverlay: $("workroom-focus-overlay"), focusClose: $("workroom-focus-close"),
  focusTaskProject: $("workroom-focus-task-project"), focusTaskTitle: $("workroom-focus-task-title"), focusTaskNotes: $("workroom-focus-task-notes"),
  focusRing: $("workroom-focus-ring"), focusTime: $("workroom-focus-time"), focusLabel: $("workroom-focus-label"), focusStatus: $("workroom-focus-status"),
  sprintToggle: $("workroom-sprint-toggle"), sprintCancel: $("workroom-sprint-cancel"), sprintChoices: [...document.querySelectorAll("[data-sprint-minutes]")],
  focusCompleteTask: $("workroom-focus-complete-task"),
  briefingOverlay: $("workroom-briefing-overlay"), briefingClose: $("workroom-briefing-close"),
  briefingFullscreenUpdated: $("workroom-briefing-fullscreen-updated"), fullBriefing: $("workroom-full-briefing"),
  calTitle: $("workroom-calendar-title"), calBody: $("workroom-calendar-body"),
  calViewWeek: $("workroom-cal-view-week"), calViewMonth: $("workroom-cal-view-month"),
  calPrev: $("workroom-cal-prev"), calToday: $("workroom-cal-today"), calNext: $("workroom-cal-next"),
  calAddBtn: $("workroom-cal-add-btn"),
  eventDialog: $("workroom-event-dialog"), eventForm: $("workroom-display-event-form"),
  eventTitle: $("workroom-display-event-title"), eventDate: $("workroom-display-event-date"),
  eventTime: $("workroom-display-event-time"), eventAllDay: $("workroom-display-event-allday"),
  eventCategory: $("workroom-display-event-category"), eventLocation: $("workroom-display-event-location"),
  eventNotes: $("workroom-display-event-notes"),
  eventDetailDialog: $("workroom-event-detail-dialog"),
  eventDetailTitle: $("workroom-event-detail-title"),
  eventDetailKicker: $("workroom-event-detail-kicker"),
  eventDetailBody: $("workroom-event-detail-body"),
};
const PIN_KEY = "workroom-compass-pinned-task";
const SPRINT_KEY = "workroom-compass-sprint";
const QUEUE_LIMIT = 9;
const DAY_MS = 24 * 60 * 60 * 1000;
const quotes = ["Well begun is half done. - Aristotle", "The obstacle is the path. - Zen proverb", "Start where you are. Use what you have. Do what you can. - Arthur Ashe", "The most effective way to do it, is to do it. - Amelia Earhart"];
let state = {
  user: null, session: null, modules: [], tasks: [], tasksLoaded: false,
  projects: [], ideas: [], finance: [], contacts: [], ach: [],
  paymentEntrySources: [], actionStates: [], billVendors: [], billCycles: [],
  calendarEvents: [], summary: {}, briefing: {}, focus: {}, connections: [],
  unsubscribers: [], pinnedTaskId: "", sprint: null, sprintMinutes: 25,
  radarCategory: "attention", operationsCategory: "all",
  activeDialog: null, dialogTrigger: null, focusOverlayTrigger: null, briefingOverlayTrigger: null,
  calendarView: "week", calendarDate: new Date(), selectedCalendarDay: null
};
let celebrationTimer = null;

const clean = (val) => String(val || "").trim();
const storageKey = (key) => `${key}:${state.user?.uid || "signed-out"}`;
const loadStored = (key, fallback = null) => { try { return JSON.parse(window.localStorage.getItem(storageKey(key))) ?? fallback; } catch { return fallback; } };
const saveStored = (key, value) => { try { const scopedKey = storageKey(key); if (value == null || value === "") window.localStorage.removeItem(scopedKey); else window.localStorage.setItem(scopedKey, JSON.stringify(value)); } catch { } };
const hasModule = (moduleId) => state.modules.includes(moduleId);

const removeSubscriptions = () => { state.unsubscribers.forEach((unsubscribe) => unsubscribe()); state.unsubscribers = []; };
const blank = (copy) => `<p class="workroom-tv-empty">${escapeHtml(copy)}</p>`;
const startOfDay = (value = new Date()) => { const date = asDate(value) || new Date(); return new Date(date.getFullYear(), date.getMonth(), date.getDate()); };
const dateKey = (value = new Date()) => { const date = asDate(value); return date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : ""; };
const monthKey = (value = new Date()) => { const date = asDate(value) || new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; };
const monthlyBillCycleId = (vendorId, cycleMonth) => `${vendorId}_${cycleMonth}`;
const pendingMonthlyBillCount = () => { const currentMonth = monthKey(); return state.billVendors.filter((vendor) => { const cycle = state.billCycles.find((item) => item.id === monthlyBillCycleId(vendor.id, currentMonth)); return !cycle?.billEntered || !cycle?.billPaid; }).length; };
const paymentEntryDueDate = (source) => { const completed = asDate(source.lastCompletedAt); if (!completed) return null; const due = startOfDay(completed); due.setDate(due.getDate() + Number(source.intervalDays || 0)); return due; };
const paymentEntryDueOffset = (source, now = new Date()) => { const due = paymentEntryDueDate(source); return due ? dayOffset(due, now) : null; };
const pendingPaymentEntryCount = () => state.paymentEntrySources.filter((source) => paymentEntryDueDate(source) == null || paymentEntryDueOffset(source) <= 0).length;
const actionStateId = (type, id) => `${type}_${String(id).replaceAll("/", "~")}`;
const actionStateFor = (type, id) => state.actionStates.find((item) => item.id === actionStateId(type, id));
const dayOffset = (value, now = new Date()) => { const date = asDate(value); return date ? Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS) : null; };
const relativeDay = (value, now = new Date()) => { const offset = dayOffset(value, now); if (offset == null) return "No date"; if (offset < -1) return `${Math.abs(offset)} days overdue`; if (offset === -1) return "Yesterday"; if (offset === 0) return "Today"; if (offset === 1) return "Tomorrow"; return formatDay(value); };
const dayPhase = (now) => { const minutes = now.getHours() * 60 + now.getMinutes(); if (minutes >= 480 && minutes < 600) return "morning"; if (minutes >= 600 && minutes < 930) return "execution"; if (minutes >= 930 && minutes < 1050) return "wrap"; return "after-hours"; };
const taskBucket = (task, now = new Date()) => { const offset = dayOffset(task.dueDate, now); if (offset != null && offset < 0) return { id: "overdue", label: "Overdue", rank: 0 }; if (offset === 0) return { id: "today", label: "Today", rank: 1 }; if (offset != null && offset <= 7) return { id: "week", label: offset === 1 ? "Tomorrow" : "This week", rank: 2 }; if (offset == null && task.priority === "high") return { id: "high-unscheduled", label: "High priority", rank: 3 }; if (offset != null) return { id: "later", label: "Later", rank: 4 }; return { id: "unscheduled", label: "Unscheduled", rank: 5 }; };
const rankTasks = (tasks, now = new Date()) => [...tasks].sort((left, right) => taskBucket(left, now).rank - taskBucket(right, now).rank || priorityRank(left.priority) - priorityRank(right.priority) || ((asDate(left.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(right.dueDate)?.getTime() || Number.MAX_SAFE_INTEGER)) || ((asDate(left.createdAt)?.getTime() || 0) - (asDate(right.createdAt)?.getTime() || 0)) || String(left.id).localeCompare(String(right.id)));
const eventDate = (event) => {
  if (event.allDay && event.date) {
    const [year, month, day] = String(event.date).split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (event.date) {
    const [year, month, day] = String(event.date).split("-").map(Number);
    if (event.time) {
      const [hours, minutes] = String(event.time).split(":").map(Number);
      return new Date(year, month - 1, day, hours || 0, minutes || 0);
    }
    return new Date(year, month - 1, day);
  }
  return asDate(event.start);
};
const eventWhen = (event) => {
  if (event.allDay) return "All day";
  if (event.time) {
    const [hours, minutes] = String(event.time).split(":").map(Number);
    const date = new Date(2000, 0, 1, hours, minutes);
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  const date = eventDate(event);
  if (!date || Number.isNaN(date.getTime())) return "All day";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
};

const getAllCalendarEvents = () => {
  const custom = (state.calendarEvents || []).map((evt) => ({
    id: evt.id,
    title: evt.title,
    date: evt.date,
    time: evt.time || null,
    allDay: evt.allDay !== false,
    category: evt.category || "",
    location: evt.location || "",
    notes: evt.notes || "",
    startDate: eventDate(evt),
    isCustom: true
  }));
  const google = (state.summary.upcomingEvents || []).map((evt, idx) => ({
    id: evt.id || `google-${idx}`,
    title: evt.title,
    date: evt.date,
    time: evt.time || null,
    allDay: Boolean(evt.allDay),
    category: "Google",
    location: evt.location || "",
    notes: "",
    startDate: eventDate(evt),
    isCustom: false
  }));
  return [...custom, ...google].sort((a, b) => (a.startDate?.getTime() || 0) - (b.startDate?.getTime() || 0));
};

const parseBriefing = (text) => {
  const sections = { "DO TODAY": [], "THIS WEEK": [], WAITING: [], WATCH: [] };
  let active = "";
  String(text || "").split(/\r?\n/).forEach((line) => { const heading = line.trim().replace(/^#+\s*/, "").replace(/:$/, "").toUpperCase(); if (sections[heading]) { active = heading; return; } if (active && line.trim() && !/^none noted\.?$/i.test(line.trim())) sections[active].push(line.trim().replace(/^[-*]\s*/, "")); });
  return sections;
};
const radarItem = (type, title, detail, time, score, id = "", canComplete = false, actionType = type.toLowerCase()) => ({ type, title, detail, time, score, id, canComplete, actionType });
const deriveRadar = (now) => {
  const items = [];
  state.contacts.filter((item) => item.status !== "done").forEach((item) => { const offset = dayOffset(item.followUpDate, now); const score = offset < 0 ? 0 : offset === 0 ? 2 : offset === 1 ? 5 : 20 + (offset ?? 30); items.push(radarItem("Follow-up", item.name, item.reason, relativeDay(item.followUpDate, now), score, item.id, true, "contact")); });
  state.finance.filter((item) => item.status !== "done").forEach((item) => { const offset = dayOffset(item.dueDate, now); const score = offset < 0 ? 0 : offset === 0 ? 2 : offset === 1 ? 5 : 20 + (offset ?? 30); items.push(radarItem("Finance", item.title, item.category || "Reminder", relativeDay(item.dueDate, now), score, item.id, true, "finance")); });
  const allEvents = getAllCalendarEvents();
  allEvents.forEach((event, index) => {
    const date = event.startDate;
    if (!date) return;
    const minutes = (date - now) / 60000;
    if (minutes >= -30 && minutes <= 24 * 60) {
      items.push(radarItem("Calendar", event.title, event.location || (event.isCustom ? "Desk Calendar" : "Calendar"), minutes <= 60 && minutes >= 0 ? `In ${Math.max(1, Math.round(minutes))} min` : eventWhen(event), minutes <= 60 ? 1 : 8 + minutes / 60, event.id || `event-${index}`));
    }
  });
  state.ach.forEach((item) => { const offset = dayOffset(item.withdrawalDate, now); if (offset != null && offset >= 0 && offset <= 3) items.push(radarItem("ACH", `${item.name} - $${Number(item.amount || 0).toFixed(2)}`, item.reason, relativeDay(item.withdrawalDate, now), 6 + offset, item.id, true, "ach")); });
  state.paymentEntrySources.forEach((source) => { const offset = paymentEntryDueOffset(source, now); if (offset == null || offset <= 0) items.push(radarItem("Payment entry", source.name, `Every ${Number(source.intervalDays)} days`, offset == null ? "Needs first entry" : offset < 0 ? `${Math.abs(offset)} days overdue` : "Due today", offset == null ? 0 : Math.max(0, offset), source.id, true, "payment-entry")); });
  state.projects.filter((item) => item.status === "active").forEach((item) => { const offset = dayOffset(item.targetDate, now); if (offset != null && offset <= 7) items.push(radarItem("Project", item.title, "Target date approaching", relativeDay(item.targetDate, now), offset < 0 ? 3 : 12 + offset, item.id, true, "project")); });
  const unread = Number(state.summary.unreadCount || 0); if (unread) items.push(radarItem("Mail", `${unread} unread message${unread === 1 ? "" : "s"}`, state.summary.recentMail?.[0]?.subject || "Inbox needs a look", "Inbox", 50));
  return items.sort((left, right) => left.score - right.score || left.title.localeCompare(right.title));
};
const operationGroups = (now) => {
  const byDate = (key) => (left, right) => {
    const leftTime = asDate(left[key])?.getTime() || Number.MAX_SAFE_INTEGER;
    const rightTime = asDate(right[key])?.getTime() || Number.MAX_SAFE_INTEGER;
    const today = startOfDay(now).getTime();
    const leftPast = leftTime < today; const rightPast = rightTime < today;
    if (leftPast !== rightPast) return leftPast ? 1 : -1;
    return leftPast ? rightTime - leftTime : leftTime - rightTime;
  };
  const contacts = [...state.contacts].filter((item) => item.status !== "done").sort(byDate("followUpDate")).map((item) => radarItem("Contact", item.name, `${item.method || "Follow-up"}${item.reason ? ` - ${item.reason}` : ""}`, relativeDay(item.followUpDate, now), 0, item.id, true, "contact"));
  const finance = [...state.finance].filter((item) => item.status !== "done").sort(byDate("dueDate")).map((item) => radarItem("Finance", item.title, `${item.category || "Reminder"}${item.amount != null ? ` - $${Number(item.amount).toFixed(2)}` : ""}`, relativeDay(item.dueDate, now), 0, item.id, true, "finance"));
  const ach = [...state.ach].sort(byDate("withdrawalDate")).map((item) => radarItem("ACH", `${item.name} - $${Number(item.amount || 0).toFixed(2)}`, `${item.reason}${item.recurring ? " - recurring" : ""}`, relativeDay(item.withdrawalDate, now), 0, item.id, true, "ach"));
  const paymentEntries = [...state.paymentEntrySources].sort((left, right) => (paymentEntryDueOffset(left, now) ?? -Infinity) - (paymentEntryDueOffset(right, now) ?? -Infinity)).map((source) => { const offset = paymentEntryDueOffset(source, now); return radarItem("Payment entry", source.name, `Every ${Number(source.intervalDays)} days`, offset == null ? "Needs first entry" : offset < 0 ? `${Math.abs(offset)} days overdue` : offset === 0 ? "Due today" : `Due ${formatDay(paymentEntryDueDate(source))}`, 0, source.id, true, "payment-entry"); });
  const allEvents = getAllCalendarEvents();
  const calendar = allEvents.map((event) => radarItem("Calendar", event.title, event.location || (event.isCustom ? "Desk Calendar" : "Google Calendar"), `${dayOffset(event.startDate, now) === 0 ? "Today - " : `${formatDay(event.startDate)} - `}${eventWhen(event)}`, 0, event.id, true, "calendar"));
  const mail = (state.summary.recentMail || []).map((message) => radarItem("Mail", message.subject, message.from || "Google Mail", "Unread", 0, message.id, true, "mail"));
  const projects = [...state.projects].filter((item) => item.status === "active").sort(byDate("targetDate")).map((item) => { const projectTasks = state.tasks.filter((task) => task.projectId === item.id); const complete = projectTasks.filter((task) => task.status === "done").length; const percent = projectTasks.length ? Math.round(complete / projectTasks.length * 100) : 0; return radarItem("Project", item.title, `${percent}% complete`, item.targetDate ? `Target ${formatDay(item.targetDate)}` : "No target date", 0, item.id, true, "project"); });
  const ideas = state.ideas.filter((idea) => idea.status !== "archived").map((idea) => radarItem("Idea", idea.title, (idea.tags || []).join(", ") || "Idea & note", idea.status === "developing" ? "Developing" : "Inbox", 0));
  return [
    ...(hasModule("follow-ups") ? [{ id: "contacts", label: "Contacts", items: contacts }] : []),
    ...(hasModule("ideas") ? [{ id: "ideas", label: "Ideas", items: ideas }] : []),
    ...(hasModule("finance") ? [{ id: "finance", label: "Finance", items: finance }] : []),
    ...(hasModule("ach") ? [{ id: "ach", label: "ACH", items: ach }] : []),
    ...(hasModule("payment-entries") ? [{ id: "payment-entries", label: "Payments", items: paymentEntries }] : []),
    ...(hasModule("google") ? [{ id: "calendar", label: "Calendar", items: calendar }, { id: "mail", label: "Mail", items: mail }] : []),
    ...(hasModule("projects") ? [{ id: "projects", label: "Projects", items: projects }] : []),
  ];
};
const deriveDayModel = (now = new Date()) => {
  const openTasks = rankTasks(state.tasks.filter((task) => task.status !== "done" && !actionStateFor("task", task.id)), now);
  const pinned = openTasks.find((task) => task.id === state.pinnedTaskId);
  if (state.tasksLoaded && state.pinnedTaskId && !pinned) { state.pinnedTaskId = ""; saveStored(PIN_KEY, null); }
  const current = pinned || openTasks[0] || null;
  const queued = openTasks.filter((task) => task.id !== current?.id);
  const completedToday = state.tasks.filter((task) => task.status === "done" && dateKey(task.completedAt) === dateKey(now));
  const allEvents = getAllCalendarEvents();
  const events = allEvents.filter((event) => event.startDate && dayOffset(event.startDate, now) === 0).sort((left, right) => (left.startDate?.getTime() || 0) - (right.startDate?.getTime() || 0));
  return { now, phase: dayPhase(now), openTasks, current, queued, completedToday, overdueCount: openTasks.filter((task) => taskBucket(task, now).id === "overdue").length, events, radar: deriveRadar(now), briefingSections: parseBriefing(state.briefing.text), briefingStale: Boolean(state.briefing.text) && state.briefing.dateKey !== dateKey(now), tomorrowCount: openTasks.filter((task) => dayOffset(task.dueDate, now) === 1).length };
};

const mixedActionItems = (model) => {
  const attentionScores = new Map(model.radar.map((item) => [`${item.actionType}:${item.id}`, item.score]));
  const tasks = model.openTasks.map((task, index) => {
    const bucket = taskBucket(task, model.now);
    const isPinned = task.id === state.pinnedTaskId;
    const isTop = !state.pinnedTaskId && index === 0;
    return {
      actionType: "task",
      id: task.id,
      type: "Task",
      title: task.title,
      detail: projectName(task),
      time: task.dueDate ? relativeDay(task.dueDate, model.now) : bucket.label,
      score: isPinned ? -20 : isTop ? -10 : bucket.rank * 10 + priorityRank(task.priority),
      task,
      isPinned,
      isTop,
      bucket
    };
  });
  const operations = operationGroups(model.now).flatMap((group, groupIndex) =>
    group.items.map((item, itemIndex) => ({
      ...item,
      score: attentionScores.get(`${item.actionType}:${item.id}`) ?? 35 + groupIndex * 8 + itemIndex
    }))
  );
  return [...tasks, ...operations]
    .filter((item) => item.id && !actionStateFor(item.actionType, item.id))
    .sort((left, right) => left.score - right.score || left.title.localeCompare(right.title));
};
const reviewLaterItems = () => state.actionStates.filter((item) => item.status === "later").sort((left, right) => (asDate(right.updatedAt)?.getTime() || 0) - (asDate(left.updatedAt)?.getTime() || 0));

const projectName = (task) => state.projects.find((project) => project.id === task?.projectId)?.title || "";
const completeButton = (type, item, label = item.title || item.name) => `<button class="workroom-display-check" data-complete-${type}="${escapeHtml(item.id)}" type="button" aria-label="Complete ${escapeHtml(label)}"></button>`;
const actionButtons = (item) => `<div class="workroom-queue-actions"><button class="workroom-review-later" data-review-later-type="${escapeHtml(item.actionType)}" data-review-later-id="${escapeHtml(item.id)}" type="button" aria-label="Review ${escapeHtml(item.title)} later">Later</button>${completeButton(item.actionType, item)}</div>`;
const operationRow = (item) => `<div class="workroom-radar-item ${item.score <= 3 ? "radar-urgent" : "radar-normal"}"><div><span>${escapeHtml(item.type)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)}${item.detail ? ` - ${escapeHtml(item.detail)}` : ""}</small></div>${item.canComplete && item.id ? actionButtons(item) : ""}</div>`;
const mixedQueueRow = (item) => {
  const isTask = item.actionType === "task";
  const isUrgent = item.score <= 3 || item.bucket?.id === "overdue";
  return `<div class="workroom-mixed-action ${isUrgent ? "is-urgent" : ""} ${item.isPinned ? "is-pinned" : ""}">` +
    `<div class="workroom-mixed-action-leading">` +
      `<span class="workroom-item-badge badge-${escapeHtml(item.actionType)}">${escapeHtml(item.type)}</span>` +
      `${item.isPinned ? `<span class="workroom-item-badge is-pinned-badge">Focus</span>` : ""}` +
      `${isUrgent ? `<span class="workroom-item-badge is-urgent-badge">Urgent</span>` : ""}` +
    `</div>` +
    `<div class="workroom-mixed-action-copy">` +
      `<strong class="workroom-mixed-action-title">${escapeHtml(item.title)}</strong>` +
      `<div class="workroom-mixed-action-meta">` +
        `<span class="workroom-meta-time ${item.bucket?.id === "overdue" ? "is-overdue" : ""}">${escapeHtml(item.time)}</span>` +
        `${item.detail ? `<span class="workroom-meta-sep">•</span><span class="workroom-meta-detail">${escapeHtml(item.detail)}</span>` : ""}` +
      `</div>` +
    `</div>` +
    `<div class="workroom-queue-actions">` +
      `${isTask ? `<button class="workroom-action-sprint-btn" data-focus-task="${escapeHtml(item.id)}" type="button" aria-label="Focus on ${escapeHtml(item.title)}">Focus</button>` : ""}` +
      `<button class="workroom-review-later" data-review-later-type="${escapeHtml(item.actionType)}" data-review-later-id="${escapeHtml(item.id)}" type="button" aria-label="Review ${escapeHtml(item.title)} later">Later</button>` +
      `${completeButton(item.actionType, item)}` +
    `</div>` +
  `</div>`;
};
const reviewLaterRow = (item) => `<div class="workroom-radar-item"><div><span>${escapeHtml(item.itemType)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.time)}${item.detail ? ` - ${escapeHtml(item.detail)}` : ""}</small></div><button class="workroom-restore-action" data-restore-action="${escapeHtml(item.id)}" type="button">Restore</button></div>`;
const taskRow = (task, now) => { const bucket = taskBucket(task, now); const project = projectName(task); return `<div class="workroom-compass-task priority-${escapeHtml(task.priority)}"><button class="workroom-task-select" data-pin-task="${escapeHtml(task.id)}" type="button"><span class="workroom-task-title">${escapeHtml(task.title)}</span><small><span class="workroom-status-label status-${bucket.id}">${escapeHtml(bucket.label)}</span>${project ? ` <span>${escapeHtml(project)}</span>` : ""}${task.dueDate ? ` <span>${escapeHtml(formatDay(task.dueDate))}</span>` : ""}</small></button>${completeButton("task", task)}</div>`; };
const renderDayline = (model) => {
  if (!model.events.length) {
    elements.dayline.innerHTML = `<span class="workroom-dayline-clear">Open runway - no calendar events today.</span>`;
    return;
  }
  const next = model.events.find((event) => !event.allDay && (event.startDate - model.now) / 60000 >= -30);
  elements.dayline.innerHTML = model.events.slice(0, 5).map((event) => {
    const minutes = (event.startDate - model.now) / 60000;
    const elapsed = !event.allDay && minutes < -30;
    const isNext = event === next;
    const countdown = isNext && minutes >= 0 && minutes <= 60 ? `In ${Math.max(1, Math.round(minutes))} min` : eventWhen(event);
    return `<div class="workroom-dayline-event ${elapsed ? "is-elapsed" : ""} ${isNext ? "is-next" : ""}" data-event-id="${escapeHtml(event.id || "")}" role="button" tabindex="0"><time>${escapeHtml(countdown)}</time><strong>${escapeHtml(event.title)}</strong></div>`;
  }).join("");
};
const renderQueue = (model) => {
  const items = mixedActionItems(model);
  elements.tasks.innerHTML = items.length ? items.slice(0, QUEUE_LIMIT).map(mixedQueueRow).join("") : blank("The action queue is clear.");
  const remaining = Math.max(0, items.length - QUEUE_LIMIT);
  elements.viewAll.textContent = remaining ? `View all +${remaining}` : "View all";
  elements.viewAll.hidden = !items.length;
  if (elements.clearPin) elements.clearPin.hidden = !state.pinnedTaskId;
};
const renderRadar = (model) => {
  const groups = operationGroups(model.now).map((group) => ({ ...group, items: group.items.filter((item) => !actionStateFor(item.actionType, item.id)) }));
  const attention = model.radar.filter((item) => !actionStateFor(item.actionType, item.id));
  const categories = [{ id: "attention", label: "Attention", items: attention }, ...groups];
  const selected = categories.find((category) => category.id === state.radarCategory) || categories[0];
  elements.radarTitle.textContent = selected.id === "attention" ? "Needs attention" : selected.label;
  elements.radarTabs.innerHTML = categories.map((category) => `<button class="workroom-radar-tab ${category.id === selected.id ? "is-active" : ""}" data-radar-category="${category.id}" type="button" aria-pressed="${category.id === selected.id}">${escapeHtml(category.label)}<span>${category.items.length}</span></button>`).join("");
  elements.radar.innerHTML = selected.items.length ? selected.items.slice(0, 5).map(operationRow).join("") : blank(`No ${selected.label.toLowerCase()} items right now.`);
};
const renderBriefing = (model) => {
  if (!elements.fullBriefing) return;
  const failed = state.briefing.status === "error";
  if (elements.briefingFullscreenUpdated) {
    elements.briefingFullscreenUpdated.textContent = failed
      ? "Run a new review from the control room."
      : state.briefing.generatedAt
        ? `${model.briefingStale ? "Stale - " : ""}Updated ${formatDateTime(state.briefing.generatedAt)}`
        : "Waiting for the first briefing.";
  }
  elements.fullBriefing.innerHTML = (failed ? `<p class="workroom-briefing-error">${escapeHtml(state.briefing.error || "The latest briefing could not be generated.")}</p>` : "")
    + Object.entries(model.briefingSections).map(([heading, items]) => `<section class="workroom-fullscreen-briefing-section"><h3>${escapeHtml(heading)}</h3>${items.length ? items.map((item) => `<p>${escapeHtml(item)}</p>`).join("") : `<p class="workroom-tv-empty">None noted.</p>`}</section>`).join("")
    + (state.briefing.sourceCounts ? `<p class="workroom-briefing-receipt">Reviewed ${Number(state.briefing.sourceCounts.tasks || 0)} tasks, ${Number(state.briefing.sourceCounts.calendarEvents || 0)} events, ${Number(state.briefing.sourceCounts.recentMail || 0)} mail messages, and ${Number(state.briefing.sourceCounts.slackMessages || 0)} Slack messages.</p>` : "");
};

const getWeekDays = (baseDate) => {
  const current = startOfDay(baseDate);
  const dayOfWeek = current.getDay();
  const start = new Date(current);
  start.setDate(current.getDate() - dayOfWeek);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
};

const formatMonthYear = (date) => new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
const formatShortDay = (date) => new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
const formatRange = (start, end) => {
  const startMonth = new Intl.DateTimeFormat("en-US", { month: "short" }).format(start);
  const endMonth = new Intl.DateTimeFormat("en-US", { month: "short" }).format(end);
  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
};

const renderCalendar = () => {
  if (!elements.calBody) return;
  const allEvents = getAllCalendarEvents();
  const now = new Date();
  const todayKey = dateKey(now);

  if (state.calendarView === "week") {
    elements.calViewWeek?.classList.add("is-active");
    elements.calViewMonth?.classList.remove("is-active");

    const days = getWeekDays(state.calendarDate);
    if (elements.calTitle) elements.calTitle.textContent = formatRange(days[0], days[6]);

    const daysHtml = days.map((day) => {
      const dKey = dateKey(day);
      const isToday = dKey === todayKey;
      const dayName = formatShortDay(day);
      const dayNum = day.getDate();
      const dayEvents = allEvents.filter((evt) => dateKey(evt.startDate || evt.date) === dKey);

      const eventsHtml = dayEvents.length ? dayEvents.map((evt) => `
        <div class="workroom-cal-chip ${evt.category ? `cat-${escapeHtml(evt.category.toLowerCase().replace(/[^a-z0-9]/g, '-'))}` : ""}" data-event-id="${escapeHtml(evt.id)}" role="button" tabindex="0" title="${escapeHtml(evt.title)}">
          <span class="workroom-cal-chip-time">${escapeHtml(eventWhen(evt))}</span>
          <span class="workroom-cal-chip-title">${escapeHtml(evt.title)}</span>
          ${evt.isCustom ? `<button class="workroom-cal-chip-del" data-delete-event="${escapeHtml(evt.id)}" type="button" aria-label="Delete ${escapeHtml(evt.title)}">&times;</button>` : ""}
        </div>
      `).join("") : `<div class="workroom-cal-empty-day" data-add-event-day="${dKey}"><span>+</span></div>`;

      return `
        <div class="workroom-cal-week-col ${isToday ? "is-today" : ""}">
          <div class="workroom-cal-col-header" data-add-event-day="${dKey}">
            <span class="workroom-cal-col-name">${escapeHtml(dayName)}</span>
            <span class="workroom-cal-col-num">${dayNum}</span>
          </div>
          <div class="workroom-cal-col-events">
            ${eventsHtml}
          </div>
        </div>
      `;
    }).join("");

    elements.calBody.innerHTML = `<div class="workroom-cal-week-grid">${daysHtml}</div>`;
  } else {
    elements.calViewWeek?.classList.remove("is-active");
    elements.calViewMonth?.classList.add("is-active");

    const year = state.calendarDate.getFullYear();
    const month = state.calendarDate.getMonth();
    if (elements.calTitle) elements.calTitle.textContent = formatMonthYear(state.calendarDate);

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();

    const weekHeaders = ["S", "M", "T", "W", "T", "F", "S"].map((h) => `<div class="workroom-cal-month-th">${h}</div>`).join("");

    let cellsHtml = "";
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      const prevDate = new Date(year, month - 1, prevMonthLastDay - i);
      const dKey = dateKey(prevDate);
      cellsHtml += `<div class="workroom-cal-cell is-outside" data-select-day="${dKey}"><span class="workroom-cal-cell-num">${prevMonthLastDay - i}</span></div>`;
    }

    for (let d = 1; d <= totalDays; d++) {
      const thisDate = new Date(year, month, d);
      const dKey = dateKey(thisDate);
      const isToday = dKey === todayKey;
      const isSelected = dKey === (state.selectedCalendarDay || todayKey);
      const dayEvents = allEvents.filter((evt) => dateKey(evt.startDate || evt.date) === dKey);
      const dotsHtml = dayEvents.length ? `<span class="workroom-cal-dots">${dayEvents.slice(0, 3).map(() => `<span class="workroom-cal-dot"></span>`).join("")}${dayEvents.length > 3 ? `<span class="workroom-cal-plus">+</span>` : ""}</span>` : "";

      cellsHtml += `
        <div class="workroom-cal-cell ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}" data-select-day="${dKey}">
          <span class="workroom-cal-cell-num">${d}</span>
          ${dotsHtml}
        </div>
      `;
    }

    const totalCells = startOffset + totalDays;
    const remainingCells = (7 - (totalCells % 7)) % 7;
    for (let nextD = 1; nextD <= remainingCells; nextD++) {
      const nextDate = new Date(year, month + 1, nextD);
      const dKey = dateKey(nextDate);
      cellsHtml += `<div class="workroom-cal-cell is-outside" data-select-day="${dKey}"><span class="workroom-cal-cell-num">${nextD}</span></div>`;
    }

    const selDay = state.selectedCalendarDay || todayKey;
    const selEvents = allEvents.filter((evt) => dateKey(evt.startDate || evt.date) === selDay);
    const [sY, sM, sD] = selDay.split("-").map(Number);
    const selDateObj = new Date(sY, sM - 1, sD);
    const selDayLabel = `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(selDateObj)}${selDay === todayKey ? " (Today)" : ""}`;

    const selEventsHtml = selEvents.length ? selEvents.map((evt) => `
      <div class="workroom-cal-chip ${evt.category ? `cat-${escapeHtml(evt.category.toLowerCase().replace(/[^a-z0-9]/g, '-'))}` : ""}" data-event-id="${escapeHtml(evt.id)}" role="button" tabindex="0">
        <span class="workroom-cal-chip-time">${escapeHtml(eventWhen(evt))}</span>
        <span class="workroom-cal-chip-title">${escapeHtml(evt.title)}</span>
        ${evt.location ? `<small class="workroom-cal-chip-loc">${escapeHtml(evt.location)}</small>` : ""}
        ${evt.isCustom ? `<button class="workroom-cal-chip-del" data-delete-event="${escapeHtml(evt.id)}" type="button" aria-label="Delete ${escapeHtml(evt.title)}">&times;</button>` : ""}
      </div>
    `).join("") : `<div class="workroom-cal-no-events">No events scheduled. <button class="workroom-text-button" data-add-event-day="${selDay}" type="button">+ Add event</button></div>`;

    elements.calBody.innerHTML = `
      <div class="workroom-cal-month-wrap">
        <div class="workroom-cal-month-grid">
          ${weekHeaders}
          ${cellsHtml}
        </div>
        <div class="workroom-cal-month-detail">
          <div class="workroom-cal-detail-header">
            <strong>${escapeHtml(selDayLabel)}</strong>
            <button class="workroom-text-button" data-add-event-day="${selDay}" type="button">+ Add</button>
          </div>
          <div class="workroom-cal-detail-list">${selEventsHtml}</div>
        </div>
      </div>
    `;
  }
};

const showEventDetail = (eventId, trigger) => {
  const allEvents = getAllCalendarEvents();
  const evt = allEvents.find((e) => String(e.id) === String(eventId));
  if (!evt || !elements.eventDetailDialog) return;

  if (elements.eventDetailKicker) {
    elements.eventDetailKicker.textContent = evt.category || (evt.isCustom ? "Custom Schedule" : "Google Calendar");
  }
  if (elements.eventDetailTitle) {
    elements.eventDetailTitle.textContent = evt.title;
  }

  const when = eventWhen(evt);
  const formattedDay = evt.startDate
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(evt.startDate)
    : evt.date;

  if (elements.eventDetailBody) {
    elements.eventDetailBody.innerHTML = `
      <div class="workroom-event-detail-meta-grid">
        <div class="workroom-event-detail-row">
          <span class="workroom-event-detail-label">When</span>
          <div class="workroom-event-detail-val">
            <strong>${escapeHtml(formattedDay)}</strong>
            <span>${escapeHtml(when)}</span>
          </div>
        </div>
        ${evt.category ? `
          <div class="workroom-event-detail-row">
            <span class="workroom-event-detail-label">Category</span>
            <div class="workroom-event-detail-val">
              <span class="workroom-item-badge ${`cat-${escapeHtml(evt.category.toLowerCase().replace(/[^a-z0-9]/g, '-'))}`}">${escapeHtml(evt.category)}</span>
            </div>
          </div>
        ` : ""}
        ${evt.location ? `
          <div class="workroom-event-detail-row">
            <span class="workroom-event-detail-label">Location</span>
            <div class="workroom-event-detail-val">
              <span>📍 ${escapeHtml(evt.location)}</span>
            </div>
          </div>
        ` : ""}
        ${evt.notes ? `
          <div class="workroom-event-detail-row">
            <span class="workroom-event-detail-label">Notes</span>
            <div class="workroom-event-detail-val">
              <p class="workroom-event-detail-notes">${escapeHtml(evt.notes)}</p>
            </div>
          </div>
        ` : ""}
        <div class="workroom-event-detail-row">
          <span class="workroom-event-detail-label">Source</span>
          <div class="workroom-event-detail-val">
            <span class="workroom-event-source-tag">${evt.isCustom ? "Desk Custom Calendar" : "Google Calendar"}</span>
          </div>
        </div>
      </div>
      <div class="workroom-event-detail-actions">
        ${evt.isCustom ? `<button class="workroom-button-danger" data-delete-event="${escapeHtml(evt.id)}" type="button">Delete event</button>` : ""}
        <button class="workroom-text-button" data-close-event-detail-dialog type="button">Close</button>
      </div>
    `;
  }

  openDialog(elements.eventDetailDialog, trigger);
};
const renderAllWork = (model) => { const groups = [{ id: "overdue", title: "Overdue" }, { id: "today", title: "Today" }, { id: "week", title: "This week" }, { id: "high-unscheduled", title: "High priority" }, { id: "later", title: "Later" }, { id: "unscheduled", title: "Unscheduled" }]; elements.allGroups.innerHTML = groups.map((group) => { const tasks = model.openTasks.filter((task) => taskBucket(task, model.now).id === group.id); return tasks.length ? `<section><h3>${group.title} <span>${tasks.length}</span></h3>${tasks.map((task) => taskRow(task, model.now)).join("")}</section>` : ""; }).join("") + (model.completedToday.length ? `<section><h3>Finished today <span>${model.completedToday.length}</span></h3>${model.completedToday.map((task) => `<div class="workroom-finished-task">${escapeHtml(task.title)}</div>`).join("")}</section>` : ""); };
const renderOperations = (model) => {
  const active = mixedActionItems(model);
  const later = reviewLaterItems();
  elements.operationsTabs.innerHTML = "";
  elements.operationsContent.innerHTML = `<section><div class="workroom-operations-heading"><h3>Active queue</h3><span>${active.length}</span></div>${active.length ? active.map(mixedQueueRow).join("") : blank("The action queue is clear.")}</section><section><div class="workroom-operations-heading"><h3>Review later</h3><span>${later.length}</span></div>${later.length ? later.map(reviewLaterRow).join("") : blank("Nothing is waiting for later.")}</section>`;
};
const renderFooter = (model) => { if (!model.openTasks.length) elements.footer.textContent = `${model.completedToday.length} finished today. The room is clear.`; else if (model.phase === "wrap") elements.footer.textContent = `${model.completedToday.length} finished today - ${model.tomorrowCount} due tomorrow.`; else if (model.overdueCount) elements.footer.textContent = `${model.overdueCount} overdue item${model.overdueCount === 1 ? "" : "s"}. Clear the oldest promise first.`; else elements.footer.textContent = quotes[new Date().getDate() % quotes.length]; };
const renderSprint = (now = Date.now()) => {
  const model = deriveDayModel();
  const task = state.tasks.find((item) => item.id === (state.sprint?.taskId || state.pinnedTaskId || model.current?.id)) || model.current;
  if (state.tasksLoaded && state.sprint && state.sprint.taskId) {
    const activeSprintTask = state.tasks.find((item) => item.id === state.sprint.taskId && item.status !== "done");
    if (!activeSprintTask) {
      state.sprint = null;
      saveStored(SPRINT_KEY, null);
      document.title = "The Desk";
    }
  }
  const sprint = state.sprint;
  let remaining = state.sprintMinutes * 60 * 1000;
  let progress = 0;
  if (sprint) {
    remaining = sprint.running ? Math.max(0, sprint.endAt - now) : sprint.remainingMs;
    progress = 1 - remaining / sprint.durationMs;
    if (remaining <= 0 && sprint.running) {
      sprint.running = false;
      sprint.remainingMs = 0;
      document.title = "Focus complete - The Desk";
      saveStored(SPRINT_KEY, sprint);
      celebrate("Focus sprint complete! Take a breath.");
    }
  }
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const timeFormatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  if (elements.focusTime) elements.focusTime.textContent = timeFormatted;
  if (elements.focusRing) elements.focusRing.style.setProperty("--focus-progress", `${Math.max(0, Math.min(1, progress)) * 360}deg`);
  if (elements.focusLabel) elements.focusLabel.textContent = sprint ? task?.title || "Focus sprint" : "Focus sprint";
  if (elements.focusStatus) elements.focusStatus.textContent = !sprint ? "Choose a quiet block for this task." : remaining <= 0 ? "Sprint complete. Take a breath." : sprint.running ? "In progress" : "Paused";
  if (elements.sprintToggle) {
    elements.sprintToggle.disabled = !task && !sprint;
    elements.sprintToggle.textContent = !sprint ? "Start" : sprint.running ? "Pause" : remaining <= 0 ? "Restart" : "Resume";
  }
  if (elements.sprintCancel) elements.sprintCancel.hidden = !sprint;
  elements.sprintChoices.forEach((button) => button.classList.toggle("is-active", Number(button.dataset.sprintMinutes) === state.sprintMinutes));

  if (elements.focusTaskTitle) elements.focusTaskTitle.textContent = task ? task.title : "Queue clear";
  if (elements.focusTaskProject) elements.focusTaskProject.textContent = task ? (projectName(task) || "Independent task") : "All clear";
  if (elements.focusTaskNotes) elements.focusTaskNotes.textContent = task ? (task.notes || (task.dueDate ? `Due ${relativeDay(task.dueDate, new Date())}` : "Ready when you are.")) : "Nothing open is asking for your attention.";
  if (elements.focusCompleteTask) elements.focusCompleteTask.hidden = !task;

  if (elements.sprintLauncherText && elements.openSprint) {
    if (sprint?.running) {
      elements.sprintLauncherText.textContent = `${timeFormatted} Focus`;
      elements.openSprint.classList.add("is-sprint-running");
    } else if (sprint && sprint.remainingMs > 0) {
      elements.sprintLauncherText.textContent = `${timeFormatted} Paused`;
      elements.openSprint.classList.remove("is-sprint-running");
    } else {
      elements.sprintLauncherText.textContent = "Focus sprint";
      elements.openSprint.classList.remove("is-sprint-running");
    }
  }
};
const render = () => {
  const model = deriveDayModel();
  document.body.dataset.dayPhase = model.phase;
  elements.completedCount.textContent = String(model.completedToday.length);
  elements.overdueCount.textContent = String(model.overdueCount);
  elements.overdueStat.classList.toggle("is-urgent", model.overdueCount > 0);
  elements.allCount.textContent = String(model.openTasks.length);
  elements.billsCount.textContent = String(pendingMonthlyBillCount());
  elements.paymentEntriesCount.textContent = String(pendingPaymentEntryCount());
  renderDayline(model);
  renderQueue(model);
  renderRadar(model);
  renderCalendar();
  renderBriefing(model);
  renderAllWork(model);
  renderOperations(model);
  renderFooter(model);
  renderSprint();
};

const renderGuestWelcome = () => {
  const guestWelcome = state.focus.guestWelcome || {};
  const name = String(guestWelcome.name || "").trim();
  const active = Boolean(guestWelcome.active && name);
  elements.guestWelcome.hidden = !active;
  elements.guestWelcome.setAttribute("aria-hidden", String(!active));
  if (!active) return;
  elements.guestWelcomeName.replaceChildren(...[...name].map((letter, index) => {
    const span = document.createElement("span");
    span.className = "workroom-guest-letter";
    span.style.setProperty("--guest-letter-index", index);
    span.textContent = letter === " " ? "\u00a0" : letter;
    return span;
  }));
};

const celebrate = (message) => { elements.completeToast.textContent = message; elements.completeToast.classList.add("is-visible"); window.clearTimeout(celebrationTimer); celebrationTimer = window.setTimeout(() => elements.completeToast.classList.remove("is-visible"), 2400); };
const writeActionState = async (item, status) => {
  const reference = doc(actionStatesRef(state.user.uid), actionStateId(item.actionType, item.id));
  const existing = actionStateFor(item.actionType, item.id);
  await setDoc(reference, { itemType: item.actionType, itemId: item.id, status, title: item.title, detail: item.detail || "", time: item.time || "", createdAt: existing?.createdAt || serverTimestamp(), updatedAt: serverTimestamp() });
};
const writeCompletion = async (type, id, item) => {
  if (!state.user) return;
  if (type === "task" || type === "finance" || type === "contact") {
    const collection = type === "task" ? tasksRef : type === "finance" ? financeRef : contactFollowUpsRef;
    await updateDoc(doc(collection(state.user.uid), id), { status: "done", completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  } else if (type === "project") {
    await updateDoc(doc(projectsRef(state.user.uid), id), { status: "complete", updatedAt: serverTimestamp() });
  } else if (type === "payment-entry") {
    await updateDoc(doc(paymentEntrySourcesRef(state.user.uid), id), { lastCompletedAt: startOfDay(), updatedAt: serverTimestamp() });
  } else {
    await writeActionState(item, "done");
  }
  if (type !== "ach" && type !== "calendar" && type !== "mail" && actionStateFor(type, id)) await deleteDoc(doc(actionStatesRef(state.user.uid), actionStateId(type, id)));
  if (type === "task" && state.pinnedTaskId === id) { state.pinnedTaskId = ""; saveStored(PIN_KEY, null); }
  if (type === "task" && state.sprint?.taskId === id) { state.sprint = null; saveStored(SPRINT_KEY, null); document.title = "The Desk"; }
};
const openDialog = (dialog, trigger) => { state.activeDialog = dialog; state.dialogTrigger = trigger; dialog.hidden = false; document.body.classList.add("workroom-dialog-open"); dialog.querySelector(".workroom-dialog-close")?.focus(); };
const closeDialog = () => { if (!state.activeDialog) return; state.activeDialog.hidden = true; document.body.classList.remove("workroom-dialog-open"); state.dialogTrigger?.focus(); state.activeDialog = null; state.dialogTrigger = null; };
const openFocusOverlay = (trigger) => {
  state.focusOverlayTrigger = trigger || document.activeElement;
  if (elements.focusOverlay) {
    elements.focusOverlay.hidden = false;
    document.body.classList.add("workroom-focus-open");
    elements.sprintToggle?.focus();
  }
};
const closeFocusOverlay = () => {
  if (!elements.focusOverlay) return;
  elements.focusOverlay.hidden = true;
  document.body.classList.remove("workroom-focus-open");
  state.focusOverlayTrigger?.focus();
  state.focusOverlayTrigger = null;
};
const openBriefingOverlay = (trigger) => {
  state.briefingOverlayTrigger = trigger || document.activeElement;
  if (elements.briefingOverlay) {
    elements.briefingOverlay.hidden = false;
    document.body.classList.add("workroom-briefing-open");
    elements.briefingClose?.focus();
  }
};
const closeBriefingOverlay = () => {
  if (!elements.briefingOverlay) return;
  elements.briefingOverlay.hidden = true;
  document.body.classList.remove("workroom-briefing-open");
  state.briefingOverlayTrigger?.focus();
  state.briefingOverlayTrigger = null;
};
const openEventDialog = (defaultDate = null, trigger = null) => {
  if (!elements.eventDialog) return;
  if (elements.eventForm) elements.eventForm.reset();
  if (elements.eventDate) elements.eventDate.value = defaultDate || dateKey(state.calendarDate || new Date());
  if (elements.eventAllDay) elements.eventAllDay.checked = true;
  openDialog(elements.eventDialog, trigger || elements.calAddBtn);
  elements.eventTitle?.focus();
};
const closeEventDialog = () => {
  if (elements.eventDialog) closeDialog();
};

const toggleSprint = () => {
  const model = deriveDayModel();
  const current = state.tasks.find((item) => item.id === (state.sprint?.taskId || state.pinnedTaskId || model.current?.id)) || model.current;
  if (!current && !state.sprint) return;
  const targetTaskId = current?.id || state.sprint?.taskId || "";
  if (!state.sprint || state.sprint.remainingMs <= 0 || (targetTaskId && state.sprint.taskId !== targetTaskId)) {
    const durationMs = state.sprintMinutes * 60 * 1000;
    state.sprint = { taskId: targetTaskId, durationMs, remainingMs: durationMs, endAt: Date.now() + durationMs, running: true };
    if (targetTaskId) {
      state.pinnedTaskId = targetTaskId;
      saveStored(PIN_KEY, targetTaskId);
    }
  } else if (state.sprint.running) {
    state.sprint.remainingMs = Math.max(0, state.sprint.endAt - Date.now());
    state.sprint.running = false;
  } else {
    state.sprint.endAt = Date.now() + state.sprint.remainingMs;
    state.sprint.running = true;
  }
  saveStored(SPRINT_KEY, state.sprint);
  render();
};

elements.eventForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.user) return;
  const title = clean(elements.eventTitle.value);
  const dateVal = clean(elements.eventDate.value);
  if (!title || !dateVal) return;
  const isAllDay = Boolean(elements.eventAllDay.checked);
  const timeVal = isAllDay ? null : (clean(elements.eventTime.value) || null);
  const category = clean(elements.eventCategory.value) || null;
  const location = clean(elements.eventLocation.value) || null;
  const notes = clean(elements.eventNotes.value) || null;

  try {
    await addDoc(calendarEventsRef(state.user.uid), {
      title,
      date: dateVal,
      time: timeVal,
      allDay: isAllDay,
      category,
      location,
      notes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    celebrate("Event added to calendar.");
    closeEventDialog();
  } catch (error) {
    celebrate(`Could not save event: ${error.message || "error"}`);
  }
});

document.addEventListener("click", async (event) => {
  const pin = event.target.closest("[data-pin-task]"); if (pin) { if (state.sprint?.taskId && state.sprint.taskId !== pin.dataset.pinTask) { state.sprint = null; saveStored(SPRINT_KEY, null); document.title = "The Desk"; } state.pinnedTaskId = pin.dataset.pinTask; saveStored(PIN_KEY, state.pinnedTaskId); closeDialog(); render(); return; }
  if (event.target.closest("#workroom-clear-pin")) { if (state.sprint?.taskId === state.pinnedTaskId) { state.sprint = null; saveStored(SPRINT_KEY, null); document.title = "The Desk"; } state.pinnedTaskId = ""; saveStored(PIN_KEY, null); render(); return; }
  if (event.target.closest("#workroom-open-sprint")) { openFocusOverlay(event.target.closest("button")); return; }
  if (event.target.closest("#workroom-focus-close, [data-close-focus-overlay]")) { closeFocusOverlay(); return; }
  if (event.target.closest("#workroom-open-briefing")) { openBriefingOverlay(event.target.closest("button")); return; }
  if (event.target.closest("#workroom-briefing-close, [data-close-briefing-overlay]")) { closeBriefingOverlay(); return; }

  if (event.target.closest("#workroom-cal-view-week")) { state.calendarView = "week"; renderCalendar(); return; }
  if (event.target.closest("#workroom-cal-view-month")) { state.calendarView = "month"; renderCalendar(); return; }
  if (event.target.closest("#workroom-cal-prev")) {
    if (state.calendarView === "week") {
      state.calendarDate.setDate(state.calendarDate.getDate() - 7);
    } else {
      state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
    }
    renderCalendar();
    return;
  }
  if (event.target.closest("#workroom-cal-next")) {
    if (state.calendarView === "week") {
      state.calendarDate.setDate(state.calendarDate.getDate() + 7);
    } else {
      state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
    }
    renderCalendar();
    return;
  }
  if (event.target.closest("#workroom-cal-today")) {
    state.calendarDate = new Date();
    state.selectedCalendarDay = dateKey(new Date());
    renderCalendar();
    return;
  }
  const selectDay = event.target.closest("[data-select-day]");
  if (selectDay) {
    state.selectedCalendarDay = selectDay.dataset.selectDay;
    renderCalendar();
    return;
  }
  const addDay = event.target.closest("[data-add-event-day]");
  if (addDay) {
    openEventDialog(addDay.dataset.addEventDay, addDay);
    return;
  }
  if (event.target.closest("#workroom-cal-add-btn")) {
    openEventDialog(state.selectedCalendarDay || dateKey(state.calendarDate || new Date()), event.target.closest("button"));
    return;
  }
  if (event.target.closest("[data-close-event-dialog]")) {
    closeEventDialog();
    return;
  }
  const delEvent = event.target.closest("[data-delete-event]");
  if (delEvent) {
    const eventId = delEvent.dataset.deleteEvent;
    delEvent.disabled = true;
    try {
      await deleteDoc(doc(calendarEventsRef(state.user.uid), eventId));
      celebrate("Event removed.");
      if (state.activeDialog === elements.eventDetailDialog) {
        closeDialog();
      }
    } catch {
      celebrate("Could not delete event.");
      delEvent.disabled = false;
    }
    return;
  }
  if (event.target.closest("[data-close-event-detail-dialog]")) {
    closeDialog();
    return;
  }
  const eventTarget = event.target.closest("[data-event-id]");
  if (eventTarget) {
    showEventDetail(eventTarget.dataset.eventId, eventTarget);
    return;
  }

  const focusTask = event.target.closest("[data-focus-task]");
  if (focusTask) {
    const taskId = focusTask.dataset.focusTask;
    if (state.sprint?.taskId && state.sprint.taskId !== taskId) {
      state.sprint = null;
      saveStored(SPRINT_KEY, null);
      document.title = "The Desk";
    }
    state.pinnedTaskId = taskId;
    saveStored(PIN_KEY, state.pinnedTaskId);
    render();
    openFocusOverlay(focusTask);
    return;
  }
  const completeFocusTask = event.target.closest("#workroom-focus-complete-task");
  if (completeFocusTask) {
    const model = deriveDayModel();
    const taskId = state.sprint?.taskId || state.pinnedTaskId || model.current?.id;
    if (!taskId) return;
    const task = state.tasks.find((item) => item.id === taskId);
    if (task) {
      completeFocusTask.disabled = true;
      try {
        await writeCompletion("task", taskId, { actionType: "task", id: taskId, title: task.title, detail: "", time: "" });
        celebrate("Done - nice work.");
      } catch {
        celebrate("Could not complete task.");
      } finally {
        completeFocusTask.disabled = false;
        render();
      }
    }
    return;
  }
  if (event.target.closest("#workroom-open-all")) { openDialog(elements.allDialog, event.target.closest("button")); return; }
  if (event.target.closest("#workroom-view-all")) { openDialog(elements.operationsDialog, event.target.closest("button")); return; }
  if (event.target.closest("#workroom-open-operations")) { openDialog(elements.operationsDialog, event.target.closest("button")); return; }
  if (event.target.closest("[data-close-display-dialog]")) { closeDialog(); return; }
  const radarCategory = event.target.closest("[data-radar-category]"); if (radarCategory) { state.radarCategory = radarCategory.dataset.radarCategory; renderRadar(deriveDayModel()); return; }
  const operationsCategory = event.target.closest("[data-operations-category]"); if (operationsCategory) { state.operationsCategory = operationsCategory.dataset.operationsCategory; renderOperations(deriveDayModel()); return; }
  const sprintChoice = event.target.closest("[data-sprint-minutes]"); if (sprintChoice) { state.sprintMinutes = Number(sprintChoice.dataset.sprintMinutes); if (!state.sprint) renderSprint(); return; }
  if (event.target.closest("#workroom-sprint-toggle")) { toggleSprint(); return; }
  if (event.target.closest("#workroom-sprint-cancel")) { state.sprint = null; saveStored(SPRINT_KEY, null); document.title = "The Desk"; render(); return; }
  const restore = event.target.closest("[data-restore-action]");
  if (restore) { restore.disabled = true; try { await deleteDoc(doc(actionStatesRef(state.user.uid), restore.dataset.restoreAction)); celebrate("Restored to the action queue."); } catch { celebrate("Could not restore that item."); restore.disabled = false; } return; }
  const later = event.target.closest("[data-review-later-type]");
  if (later) { const item = mixedActionItems(deriveDayModel()).find((entry) => entry.actionType === later.dataset.reviewLaterType && entry.id === later.dataset.reviewLaterId); if (!item) return; later.disabled = true; try { await writeActionState(item, "later"); celebrate("Saved for review later."); } catch { celebrate("Could not save that for later."); later.disabled = false; } return; }
  const complete = event.target.closest(".workroom-display-check"); if (!complete) return;
  const completion = Object.entries(complete.dataset).find(([key]) => key.startsWith("complete")); if (!completion) return;
  const type = completion[0].slice("complete".length).toLowerCase(); const id = completion[1];
  const item = mixedActionItems(deriveDayModel()).find((entry) => entry.actionType === type && entry.id === id) || { actionType: type, id, title: "Completed item", detail: "", time: "" };
  complete.disabled = true; try { await writeCompletion(type, id, item); celebrate("Done - nice work."); } catch { celebrate("Could not update that item."); complete.disabled = false; }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (elements.focusOverlay && !elements.focusOverlay.hidden) {
      closeFocusOverlay();
      return;
    }
    if (elements.briefingOverlay && !elements.briefingOverlay.hidden) {
      closeBriefingOverlay();
      return;
    }
    closeDialog();
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target?.dataset?.eventId) {
    event.preventDefault();
    showEventDetail(event.target.dataset.eventId, event.target);
    return;
  }
  if (event.key !== "Tab" || !state.activeDialog) return;
  const focusable = [...state.activeDialog.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
  if (!focusable.length) return;
  const first = focusable[0]; const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
const tick = () => { const now = new Date(); elements.clock.textContent = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now); elements.date.textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now); renderSprint(now.getTime()); };
tick(); window.setInterval(tick, 1000); window.setInterval(() => { if (state.user) render(); }, 60_000);

onAuthStateChanged(auth, async (user) => {
  removeSubscriptions(); state.user = user;
  state.session = null; state.modules = [];
  if (!user) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.remove("hidden"); elements.gateMessage.textContent = "Sign in to open your Desk display."; return; }
  try { state.session = await resolveDeskSession(user); } catch (error) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.add("hidden"); elements.gateMessage.textContent = `Desk access could not be checked: ${error.message || "unknown error"}`; return; }
  if (!state.session.hasDeskAccess || !state.session.profile.onboardingComplete) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.add("hidden"); elements.gateMessage.textContent = state.session.hasDeskAccess ? "Finish setup in the control room first." : "This account has not been granted Desk access."; return; }
  state.modules = state.session.modules;
  state.pinnedTaskId = loadStored(PIN_KEY, ""); state.sprint = loadStored(SPRINT_KEY, null);
  document.querySelectorAll("[data-module]").forEach((element) => { element.hidden = !hasModule(element.dataset.module); });
  document.querySelectorAll("[data-owner-only]").forEach((element) => { element.hidden = !state.session.isAdmin; });
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  state.unsubscribers.push(
    onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); state.tasksLoaded = true; render(); }),
    onSnapshot(actionStatesRef(user.uid), (snapshot) => { state.actionStates = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(calendarEventsRef(user.uid), (snapshot) => { state.calendarEvents = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
  );
  if (hasModule("projects")) state.unsubscribers.push(onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("ideas")) state.unsubscribers.push(onSnapshot(ideasRef(user.uid), (snapshot) => { state.ideas = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("finance")) state.unsubscribers.push(onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("follow-ups")) state.unsubscribers.push(onSnapshot(contactFollowUpsRef(user.uid), (snapshot) => { state.contacts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("ach")) state.unsubscribers.push(onSnapshot(achEntriesRef(user.uid), (snapshot) => { state.ach = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("payment-entries")) state.unsubscribers.push(onSnapshot(paymentEntrySourcesRef(user.uid), (snapshot) => { state.paymentEntrySources = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("monthly-bills")) state.unsubscribers.push(onSnapshot(monthlyBillVendorsRef(user.uid), (snapshot) => { state.billVendors = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }), onSnapshot(monthlyBillCyclesRef(user.uid), (snapshot) => { state.billCycles = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }));
  if (hasModule("google")) state.unsubscribers.push(onSnapshot(summaryRef(user.uid), (snapshot) => { state.summary = snapshot.data() || {}; render(); }), onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => item.data()); render(); }));
  if (state.session.isAdmin) state.unsubscribers.push(onSnapshot(briefingRef(user.uid), (snapshot) => { state.briefing = snapshot.data() || {}; render(); }));
  if (hasModule("guest-display")) state.unsubscribers.push(onSnapshot(focusRef(user.uid), (snapshot) => { state.focus = snapshot.data() || {}; renderGuestWelcome(); }));
});