import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, onSnapshot, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth } from "./auth-shared.js";
import { asDate, connectionsRef, escapeHtml, financeRef, formatDay, isOwner, priorityRank, projectsRef, summaryRef, tasksRef } from "./workroom-shared.js";

const $ = (id) => document.getElementById(id);
const elements = { gate: $("workroom-display-gate"), gateMessage: $("workroom-display-gate-message"), signIn: $("workroom-display-sign-in"), app: $("workroom-display-app"), clock: $("workroom-clock"), date: $("workroom-date"), tasks: $("workroom-display-tasks"), taskCount: $("workroom-task-count"), projects: $("workroom-display-projects"), events: $("workroom-display-events"), mail: $("workroom-display-mail"), mailCount: $("workroom-mail-count"), finance: $("workroom-display-finance"), completeToast: $("workroom-complete-toast") };
let state = { user: null, tasks: [], projects: [], finance: [], summary: {}, connections: [], unsubscribers: [] };
let celebrationTimer = null;
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

const render = () => {
  const openTasks = soonest(state.tasks.filter((task) => task.status !== "done"));
  const completedTasks = [...state.tasks]
    .filter((task) => task.status === "done")
    .sort((left, right) => (asDate(right.completedAt)?.getTime() || 0) - (asDate(left.completedAt)?.getTime() || 0));
  const visibleTasks = [...openTasks, ...completedTasks].slice(0, 8);
  elements.taskCount.textContent = String(openTasks.length);
  elements.tasks.innerHTML = visibleTasks.length ? visibleTasks.map((task) => `<div class="workroom-tv-row workroom-task-row priority-${escapeHtml(task.priority)} ${task.status === "done" ? "is-done" : ""}"><button class="workroom-display-check" data-complete-task="${escapeHtml(task.id)}" type="button" aria-label="${task.status === "done" ? "Reopen" : "Complete"} ${escapeHtml(task.title)}">${task.status === "done" ? "✓" : ""}</button><span class="workroom-tv-marker ${escapeHtml(task.priority)}"></span><div><strong>${escapeHtml(task.title)}</strong><small><span class="workroom-task-priority ${escapeHtml(task.priority)}">${escapeHtml(task.priority)}</span>${task.dueDate ? ` · Due ${formatDay(task.dueDate)}` : ""}</small></div></div>`).join("") : blank("Your action queue is clear.");
  const activeProjects = state.projects.filter((project) => project.status === "active").slice(0, 5);
  elements.projects.innerHTML = activeProjects.length ? activeProjects.map((project) => { const projectTasks = state.tasks.filter((task) => task.projectId === project.id); const complete = projectTasks.filter((task) => task.status === "done").length; const percent = projectTasks.length ? Math.round(complete / projectTasks.length * 100) : 0; return `<div class="workroom-project-progress"><div><strong>${escapeHtml(project.title)}</strong><small>${project.targetDate ? `Target ${formatDay(project.targetDate)}` : "No target date"}</small></div><div class="workroom-progress-track"><span style="width:${percent}%"></span></div><small>${percent}%</small></div>`; }).join("") : blank("Add a project in the control room.");
  const events = (state.summary.upcomingEvents || []).slice(0, 12);
  elements.events.innerHTML = events.length ? events.map((event) => `<div class="workroom-tv-row"><time>${escapeHtml(calendarWhen(event))}</time><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.location || "Google Calendar")}</small></div></div>`).join("") : blank("Nothing is scheduled in the next 7 days.");
  const mail = (state.summary.recentMail || []).slice(0, 5);
  elements.mailCount.textContent = String(state.summary.unreadCount || mail.length || 0);
  elements.mail.innerHTML = mail.length ? mail.map((message) => `<div class="workroom-tv-row"><span class="workroom-mail-dot"></span><div><strong>${escapeHtml(message.subject)}</strong><small>${escapeHtml(message.from || "Google Mail")}</small></div></div>`).join("") : blank("No unread messages in connected inboxes.");
  const finance = soonest(state.finance.filter((item) => item.status !== "done")).slice(0, 4);
  elements.finance.innerHTML = finance.length ? finance.map((item) => `<div class="workroom-tv-row"><span class="workroom-tv-marker ${escapeHtml(item.urgency)}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.category || "Reminder")}${item.dueDate ? ` · ${formatDay(item.dueDate)}` : ""}</small></div></div>`).join("") : blank("No financial reminders are waiting.");
};

const tick = () => { const now = new Date(); elements.clock.textContent = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now); elements.date.textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now); };
tick(); setInterval(tick, 15_000);

document.addEventListener("click", async (event) => {
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

onAuthStateChanged(auth, (user) => {
  removeSubscriptions();
  state.user = user;
  if (!user || !isOwner(user)) { elements.app.classList.add("hidden"); elements.gate.classList.remove("hidden"); elements.signIn.classList.toggle("hidden", Boolean(user)); elements.gateMessage.textContent = user ? "This private display is reserved for its owner." : "Sign in with the Workroom owner account to view the dashboard."; return; }
  elements.gate.classList.add("hidden"); elements.app.classList.remove("hidden");
  state.unsubscribers.push(
    onSnapshot(tasksRef(user.uid), (snapshot) => { state.tasks = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(projectsRef(user.uid), (snapshot) => { state.projects = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(financeRef(user.uid), (snapshot) => { state.finance = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })); render(); }),
    onSnapshot(summaryRef(user.uid), (snapshot) => { state.summary = snapshot.data() || {}; render(); }),
    onSnapshot(connectionsRef(user.uid), (snapshot) => { state.connections = snapshot.docs.map((item) => item.data()); render(); }),
  );
});
