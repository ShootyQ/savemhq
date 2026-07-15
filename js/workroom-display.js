import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth } from "./auth-shared.js";
import { asDate, connectionsRef, escapeHtml, financeRef, focusRef, formatDay, formatDateTime, isOwner, priorityRank, projectsRef, summaryRef, tasksRef } from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = { gate: $("workroom-display-gate"), gateMessage: $("workroom-display-gate-message"), signIn: $("workroom-display-sign-in"), app: $("workroom-display-app"), clock: $("workroom-clock"), date: $("workroom-date"), focus: $("workroom-display-focus"), next: $("workroom-display-next"), intention: $("workroom-display-intention"), tasks: $("workroom-display-tasks"), taskCount: $("workroom-task-count"), projects: $("workroom-display-projects"), events: $("workroom-display-events"), mail: $("workroom-display-mail"), mailCount: $("workroom-mail-count"), finance: $("workroom-display-finance"), sync: $("workroom-sync-status") };
let state = { tasks: [], projects: [], finance: [], focus: {}, summary: {}, connections: [], unsubscribers: [] };
const removeSubscriptions = () => { state.unsubscribers.forEach((unsubscribe) => unsubscribe()); state.unsubscribers = []; };
const soonest = (items, dateKey = "dueDate") => [...items].sort((a, b) => priorityRank(a.priority || a.urgency) - priorityRank(b.priority || b.urgency) || ((asDate(a[dateKey])?.getTime() || Number.MAX_SAFE_INTEGER) - (asDate(b[dateKey])?.getTime() || Number.MAX_SAFE_INTEGER)));
const blank = (copy) => `<p class="workroom-tv-empty">${copy}</p>`;

const render = () => {
  const openTasks = soonest(state.tasks.filter((task) => task.status !== "done")).slice(0, 5);
  elements.taskCount.textContent = String(openTasks.length);
  elements.tasks.innerHTML = openTasks.length ? openTasks.map((task) => `<div class="workroom-tv-row"><span class="workroom-tv-marker ${escapeHtml(task.priority)}"></span><div><strong>${escapeHtml(task.title)}</strong><small>${task.dueDate ? `Due ${formatDay(task.dueDate)}` : task.priority}</small></div></div>`).join("") : blank("Your action queue is clear.");
  const activeProjects = state.projects.filter((project) => project.status === "active").slice(0, 5);
  elements.projects.innerHTML = activeProjects.length ? activeProjects.map((project) => { const projectTasks = state.tasks.filter((task) => task.projectId === project.id); const complete = projectTasks.filter((task) => task.status === "done").length; const percent = projectTasks.length ? Math.round(complete / projectTasks.length * 100) : 0; return `<div class="workroom-project-progress"><div><strong>${escapeHtml(project.title)}</strong><small>${project.targetDate ? `Target ${formatDay(project.targetDate)}` : "No target date"}</small></div><div class="workroom-progress-track"><span style="width:${percent}%"></span></div><small>${percent}%</small></div>`; }).join("") : blank("Add a project in the control room.");
  const events = (state.summary.upcomingEvents || []).slice(0, 5);
  elements.events.innerHTML = events.length ? events.map((event) => `<div class="workroom-tv-row"><time>${event.allDay ? "All day" : formatDateTime(event.start).replace(/^[A-Za-z]{3} \d+, /, "")}</time><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.location || "Calendar")}</small></div></div>`).join("") : blank("Nothing is scheduled in the next 36 hours.");
  const mail = (state.summary.recentMail || []).slice(0, 5);
  elements.mailCount.textContent = String(state.summary.unreadCount || mail.length || 0);
  elements.mail.innerHTML = mail.length ? mail.map((message) => `<div class="workroom-tv-row"><span class="workroom-mail-dot"></span><div><strong>${escapeHtml(message.subject)}</strong><small>${escapeHtml(message.from || "Google Mail")}</small></div></div>`).join("") : blank("No unread messages in connected inboxes.");
  const finance = soonest(state.finance.filter((item) => item.status !== "done")).slice(0, 4);
  elements.finance.innerHTML = finance.length ? finance.map((item) => `<div class="workroom-tv-row"><span class="workroom-tv-marker ${escapeHtml(item.urgency)}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category || "Reminder")}${item.dueDate ? ` · ${formatDay(item.dueDate)}` : ""}</small></div></div>`).join("") : blank("No financial reminders are waiting.");
  elements.focus.textContent = state.focus.primary || "Choose the work that matters.";
  elements.next.textContent = state.focus.next ? `Next: ${state.focus.next}` : "Set a next action in the control room.";
  elements.intention.textContent = state.focus.intention || "Work with intention.";
  elements.sync.textContent = state.summary.syncError ? "Google needs attention — check the control room." : state.summary.lastSyncAt ? `Google synced ${formatDateTime(state.summary.lastSyncAt)}` : "Waiting for Google sync…";
};

const tick = () => { const now = new Date(); elements.clock.textContent = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now); elements.date.textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now); };
tick(); setInterval(tick, 15_000);

onAuthStateChanged(auth, (user) => {
  removeSubscriptions();
  if (!user || !isOwner(user)) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.toggle("hidden", Boolean(user)); elements.gateMessage.textContent = user ? "This private display is reserved for its owner." : "Sign in with the Workroom owner account to view the dashboard."; return; }
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  state.unsubscribers.push(
    onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(focusRef(user.uid), (snapshot) => { state.focus = snapshot.data() || {}; render(); }),
    onSnapshot(summaryRef(user.uid), (snapshot) => { state.summary = snapshot.data() || {}; render(); }),
    onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => item.data()); render(); }),
  );
});
