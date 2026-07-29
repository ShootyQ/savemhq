import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth } from "./auth-shared.js";
import { achEntriesRef, asDate, briefingRef, contactFollowUpsRef, connectionsRef, escapeHtml, financeRef, formatDay, formatDateTime, isOwner, priorityRank, projectsRef, summaryRef, tasksRef } from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = { gate: $("workroom-display-gate"), gateMessage: $("workroom-display-gate-message"), signIn: $("workroom-display-sign-in"), app: $("workroom-display-app"), clock: $("workroom-clock"), date: $("workroom-date"), tasks: $("workroom-display-tasks"), taskCount: $("workroom-task-count"), taskPage: $("workroom-task-page"), signalStage: $("workroom-signal-stage"), signalTitle: $("workroom-signal-title"), signalPosition: $("workroom-signal-position"), signal: $("workroom-display-signal"), overviewSignals: $("workroom-overview-signals"), briefingStage: $("workroom-briefing-stage"), briefingFull: $("workroom-display-briefing-full"), briefingStageUpdated: $("workroom-briefing-stage-updated"), briefing: $("workroom-display-briefing"), briefingUpdated: $("workroom-briefing-updated"), quote: $("workroom-quote-text"), completeToast: $("workroom-complete-toast"), signalPrevious: $("workroom-signal-previous"), signalToggle: $("workroom-signal-toggle"), signalNext: $("workroom-signal-next"), modeButtons: [...document.querySelectorAll("[data-display-mode]")] };
const DISPLAY_MODE_KEY = "workroom-display-mode";
const ROTATION_PAUSED_KEY = "workroom-display-rotation-paused";
const TASKS_PER_PAGE = 7;
const ROTATION_INTERVAL = 12_000;
const preferredDisplayMode = () => {
  try {
    const mode = window.localStorage.getItem(DISPLAY_MODE_KEY);
    return ["focus", "overview", "briefing"].includes(mode) ? mode : "focus";
  } catch { return "focus"; }
};
const preferredRotationPaused = () => {
  try { return window.localStorage.getItem(ROTATION_PAUSED_KEY) === "true"; } catch { return false; }
};
const savePreference = (key, value) => {
  try { window.localStorage.setItem(key, String(value)); } catch { }
};
let state = { user: null, tasks: [], projects: [], finance: [], contacts: [], ach: [], summary: {}, briefing: {}, connections: [], unsubscribers: [], displayMode: preferredDisplayMode(), signalIndex: 0, taskPage: 0, rotationPaused: preferredRotationPaused() };
let celebrationTimer = null;
const quotes = [
  ["Well begun is half done.", "Aristotle"],
  ["No great thing is created suddenly.", "Epictetus"],
  ["Luck is what happens when preparation meets opportunity.", "Seneca"],
  ["The obstacle is the path.", "Zen proverb"],
  ["What we think, we become.", "Buddha"],
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["Energy and persistence conquer all things.", "Benjamin Franklin"],
  ["Nothing great was ever achieved without enthusiasm.", "Ralph Waldo Emerson"],
  ["The future depends on what you do today.", "Mahatma Gandhi"],
  ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
  ["It is never too late to be what you might have been.", "George Eliot"],
  ["The only way out is through.", "Robert Frost"],
  ["The journey of a thousand miles begins with one step.", "Lao Tzu"],
  ["He who has a why can endure almost any how.", "Friedrich Nietzsche"],
  ["The best way out is always through.", "Robert Frost"],
  ["Action may not always bring happiness, but there is no happiness without action.", "William James"],
  ["The future is completely open, and we are writing it moment to moment.", "Pema Chödrön"],
  ["To improve is to change; to be perfect is to change often.", "Winston Churchill"],
  ["Start where you are. Use what you have. Do what you can.", "Arthur Ashe"],
  ["What you do speaks so loudly that I cannot hear what you say.", "Ralph Waldo Emerson"],
  ["The greatest glory in living lies not in never falling, but in rising every time we fall.", "Nelson Mandela"],
  ["A person who never made a mistake never tried anything new.", "Albert Einstein"],
  ["Do not wait; the time will never be just right.", "Napoleon Hill"],
  ["The most effective way to do it, is to do it.", "Amelia Earhart"],
  ["Work gives you meaning and purpose.", "Stephen Hawking"],
  ["The important thing is not to stop questioning.", "Albert Einstein"],
  ["Be faithful to that which exists within yourself.", "André Gide"],
  ["A goal without a plan is just a wish.", "Antoine de Saint-Exupéry"],
  ["We become what we repeatedly do.", "Will Durant"],
  ["Live out of your imagination, not your history.", "Stephen Covey"],
];
let quoteIndex = 0;
const removeSubscriptions = () => { state.unsubscribers.forEach((unsubscribe) => unsubscribe()); state.unsubscribers = []; };
const soonest = (items, dateKey = "dueDate") => [...items].sort((a, b) => priorityRank(a.priority || a.urgency) - priorityRank(b.priority || b.urgency) || ((asDate(a[dateKey])?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(b[dateKey])?.getTime() || Number.MAX_SAFE_INTEGER)));
const blank = (copy) => `<p class="workroom-tv-empty">${copy}</p>`;
const calendarWhen = (event) => {
  const date = event.allDay
    ? (() => { const [year, month, day] = String(event.date || "").split("-").map(Number); return new Date(year, month - 1, day); })()
    : asDate(event.start);
  if (!date || Number.isNaN(date.getTime())) return event.allDay ? "All day" : "—";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
  return event.allDay ? `${day} · All day` : `${day} · ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
};
const celebrate = (message) => {
  elements.completeToast.textContent = message;
  elements.completeToast.classList.add("is-visible");
  window.clearTimeout(celebrationTimer);
  celebrationTimer = window.setTimeout(() => elements.completeToast.classList.remove("is-visible"), 2400);
};
const showQuote = () => {
  const [quote, author] = quotes[quoteIndex];
  quoteIndex = (quoteIndex + 1) % quotes.length;
  elements.quote.textContent = `“${quote}” — ${author}`;
  elements.quote.classList.remove("is-running");
  void elements.quote.offsetWidth;
  elements.quote.classList.add("is-running");
};

const taskRows = (tasks) => tasks.map((task) => `<div class="workroom-tv-row workroom-task-row priority-${escapeHtml(task.priority)}"><button class="workroom-display-check" data-complete-task="${escapeHtml(task.id)}" type="button" aria-label="Complete ${escapeHtml(task.title)}"></button><div><strong>${escapeHtml(task.title)}</strong><small><span class="workroom-task-priority ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>${task.dueDate ? ` - Due ${formatDay(task.dueDate)}` : ""}</small></div></div>`).join("");
const simpleRows = (items) => items.map((item) => `<div class="workroom-tv-row"><span class="workroom-tv-marker ${escapeHtml(item.priority || "low")}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join("");
const getSignals = () => {
  const contacts = [...state.contacts].filter((item) => item.status !== "done").sort((a, b) => (asDate(a.followUpDate)?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(b.followUpDate)?.getTime() || Number.MAX_SAFE_INTEGER)).slice(0, 3);
  const finance = soonest(state.finance.filter((item) => item.status !== "done")).slice(0, 3);
  const ach = [...state.ach].sort((a, b) => (asDate(a.withdrawalDate)?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(b.withdrawalDate)?.getTime() || Number.MAX_SAFE_INTEGER)).slice(0, 3);
  const events = (state.summary.upcomingEvents || []).slice(0, 3);
  const mail = (state.summary.recentMail || []).slice(0, 3);
  const projects = state.projects.filter((project) => project.status === "active").slice(0, 3);
  return [
    { id: "follow-ups", title: "Follow-ups", count: contacts.length, summary: contacts[0] ? `${contacts[0].name} - ${formatDay(contacts[0].followUpDate)}` : "No follow-ups waiting.", rows: simpleRows(contacts.map((item) => ({ title: item.name, detail: `${item.method} - ${item.reason}`, priority: "medium" }))) },
    { id: "finance", title: "Finance", count: finance.length, summary: finance[0] ? `${finance[0].title}${finance[0].dueDate ? ` - ${formatDay(finance[0].dueDate)}` : ""}` : "No financial reminders are waiting.", rows: simpleRows(finance.map((item) => ({ title: item.title, detail: `${item.category || "Reminder"}${item.dueDate ? ` - ${formatDay(item.dueDate)}` : ""}`, priority: item.urgency }))) },
    { id: "ach", title: "ACH", count: ach.length, summary: ach[0] ? `${ach[0].name} - ${formatDay(ach[0].withdrawalDate)}` : "No ACH entries waiting.", rows: simpleRows(ach.map((item) => ({ title: `${item.name} - $${Number(item.amount || 0).toFixed(2)}`, detail: `${item.reason}${item.recurring ? " - recurring" : ""}`, priority: "medium" }))) },
    { id: "calendar", title: "Calendar", count: events.length, summary: events[0] ? `${events[0].title} - ${calendarWhen(events[0])}` : "Nothing scheduled in the next 7 days.", rows: events.map((event) => `<div class="workroom-tv-row"><time>${escapeHtml(calendarWhen(event))}</time><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.location || "Google Calendar")}</small></div></div>`).join("") },
    { id: "mail", title: "Mail", count: Number(state.summary.unreadCount || mail.length || 0), summary: mail[0] ? mail[0].subject : "No unread messages in connected inboxes.", rows: mail.map((message) => `<div class="workroom-tv-row"><span class="workroom-mail-dot"></span><div><strong>${escapeHtml(message.subject)}</strong><small>${escapeHtml(message.from || "Google Mail")}</small></div></div>`).join("") },
    { id: "projects", title: "Projects", count: projects.length, summary: projects[0] ? projects[0].title : "No active projects.", rows: projects.map((project) => { const projectTasks = state.tasks.filter((task) => task.projectId === project.id); const complete = projectTasks.filter((task) => task.status === "done").length; const percent = projectTasks.length ? Math.round(complete / projectTasks.length * 100) : 0; return `<div class="workroom-project-progress"><div><strong>${escapeHtml(project.title)}</strong><small>${project.targetDate ? `Target ${formatDay(project.targetDate)}` : "No target date"}</small></div><div class="workroom-progress-track"><span style="width:${percent}%"></span></div><small>${percent}%</small></div>`; }).join("") },
  ];
};
const updateControls = (signalCount) => {
  const disabled = signalCount < 2;
  elements.signalPrevious.disabled = disabled;
  elements.signalNext.disabled = disabled;
  elements.signalToggle.disabled = signalCount < 2;
  elements.signalToggle.textContent = state.rotationPaused ? ">" : "||";
  elements.signalToggle.setAttribute("aria-pressed", String(state.rotationPaused));
  elements.signalToggle.setAttribute("aria-label", state.rotationPaused ? "Resume signal rotation" : "Pause signal rotation");
  elements.modeButtons.forEach((button) => {
    const active = button.dataset.displayMode === state.displayMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
};
const renderDisplayMode = () => {
  document.body.dataset.displayMode = state.displayMode;
  elements.briefingStage.hidden = state.displayMode !== "briefing";
  elements.overviewSignals.hidden = state.displayMode !== "overview";
};
const render = () => {
  const openTasks = soonest(state.tasks.filter((task) => task.status !== "done"));
  elements.taskCount.textContent = String(openTasks.length);
  const pageCount = Math.max(1, Math.ceil(openTasks.length / TASKS_PER_PAGE));
  state.taskPage %= pageCount;
  const firstTask = state.taskPage * TASKS_PER_PAGE;
  const visibleTasks = openTasks.slice(firstTask, firstTask + TASKS_PER_PAGE);
  elements.tasks.innerHTML = visibleTasks.length ? taskRows(visibleTasks) : blank("Your action queue is clear.");
  elements.taskPage.textContent = openTasks.length > TASKS_PER_PAGE ? `Tasks ${firstTask + 1}-${Math.min(firstTask + TASKS_PER_PAGE, openTasks.length)} of ${openTasks.length}` : openTasks.length ? `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}` : "All clear";
  const allSignals = getSignals();
  const activeSignals = allSignals.filter((signal) => signal.count > 0);
  state.signalIndex = activeSignals.length ? state.signalIndex % activeSignals.length : 0;
  const signal = activeSignals[state.signalIndex];
  elements.signalTitle.textContent = signal?.title || "Signals";
  elements.signalPosition.textContent = activeSignals.length ? `${state.signalIndex + 1} / ${activeSignals.length}` : "0 / 0";
  elements.signal.innerHTML = signal ? signal.rows || blank(signal.summary) : blank("No active signals right now.");
  elements.signalStage.dataset.signal = signal?.id || "empty";
  elements.overviewSignals.innerHTML = allSignals.map((item) => `<article class="workroom-overview-tile"><span>${escapeHtml(item.title)}</span><strong>${item.count}</strong><small>${escapeHtml(item.summary)}</small></article>`).join("");
  const briefingText = String(state.briefing.text || "").trim();
  elements.briefing.textContent = briefingText || "Generate a briefing from the control room.";
  elements.briefingFull.textContent = briefingText || "Generate a briefing from the control room.";
  elements.briefingUpdated.textContent = state.briefing.generatedAt ? `Updated ${formatDateTime(state.briefing.generatedAt)}` : "Waiting for the first briefing.";
  elements.briefingStageUpdated.textContent = elements.briefingUpdated.textContent;
  renderDisplayMode();
  updateControls(activeSignals.length);
};

const tick = () => { const now = new Date(); elements.clock.textContent = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now); elements.date.textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now); };
tick(); setInterval(tick, 15_000);
showQuote();
setInterval(showQuote, 18_000);

const setDisplayMode = (mode) => {
  if (!["focus", "overview", "briefing"].includes(mode)) return;
  state.displayMode = mode;
  savePreference(DISPLAY_MODE_KEY, mode);
  render();
};
const changeSignal = (direction) => {
  const count = getSignals().filter((signal) => signal.count > 0).length;
  if (count < 2) return;
  state.signalIndex = (state.signalIndex + direction + count) % count;
  state.rotationPaused = true;
  savePreference(ROTATION_PAUSED_KEY, true);
  render();
};
const toggleRotation = () => {
  state.rotationPaused = !state.rotationPaused;
  savePreference(ROTATION_PAUSED_KEY, state.rotationPaused);
  render();
};
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
setInterval(() => {
  if (!state.user || state.rotationPaused || reducedMotion()) return;
  const signalCount = getSignals().filter((signal) => signal.count > 0).length;
  const openTaskCount = state.tasks.filter((task) => task.status !== "done").length;
  if (signalCount > 1) state.signalIndex = (state.signalIndex + 1) % signalCount;
  if (openTaskCount > TASKS_PER_PAGE) state.taskPage = (state.taskPage + 1) % Math.ceil(openTaskCount / TASKS_PER_PAGE);
  if (signalCount > 1 || openTaskCount > TASKS_PER_PAGE) render();
}, ROTATION_INTERVAL);

document.addEventListener("click", async (event) => {
  const modeButton = event.target.closest("[data-display-mode]");
  if (modeButton) { setDisplayMode(modeButton.dataset.displayMode); return; }
  if (event.target.closest("#workroom-signal-previous")) { changeSignal(-1); return; }
  if (event.target.closest("#workroom-signal-next")) { changeSignal(1); return; }
  if (event.target.closest("#workroom-signal-toggle")) { toggleRotation(); return; }
  const button = event.target.closest("button[data-complete-task]");
  if (!button || !state.user) return;
  const task = state.tasks.find((item) => item.id === button.dataset.completeTask);
  if (!task) return;
  button.disabled = true;
  try {
    const completing = task.status !== "done";
    await updateDoc(doc(tasksRef(state.user.uid), task.id), {
      status: completing ? "done" : "next",
      completedAt: completing ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
    if (completing) celebrate("✓ Done — nice work.");
  } catch {
    celebrate("Couldn’t update that task.");
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (!state.user || event.target.closest("button, input, select, textarea, a")) return;
  if (["1", "2", "3"].includes(event.key)) {
    setDisplayMode({ 1: "focus", 2: "overview", 3: "briefing" }[event.key]);
    return;
  }
  if (event.key === "ArrowLeft") { event.preventDefault(); changeSignal(-1); return; }
  if (event.key === "ArrowRight") { event.preventDefault(); changeSignal(1); return; }
  if (event.code === "Space") { event.preventDefault(); toggleRotation(); }
});

onAuthStateChanged(auth, (user) => {
  removeSubscriptions();
  state.user = user;
  if (!user || !isOwner(user)) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.toggle("hidden", Boolean(user)); elements.gateMessage.textContent = user ? "This private display is reserved for its owner." : "Sign in with the Workroom owner account to view the dashboard."; return; }
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  state.unsubscribers.push(
    onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(contactFollowUpsRef(user.uid), (snapshot) => { state.contacts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(achEntriesRef(user.uid), (snapshot) => { state.ach = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(summaryRef(user.uid), (snapshot) => { state.summary = snapshot.data() || {}; render(); }),
    onSnapshot(briefingRef(user.uid), (snapshot) => { state.briefing = snapshot.data() || {}; render(); }),
    onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => item.data()); render(); }),
  );
});
