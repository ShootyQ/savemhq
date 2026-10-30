import { initHeaderAuth, ADMIN_EMAIL, auth } from "../auth-shared.js";
import { resolveDeskSession, escapeHtml as e } from "../workroom-shared.js";
import * as api from "./api.js";
const M = globalThis.TeamModel,
  $ = (id) => document.getElementById(id);
let user = null,
  epoch = 0,
  roomEpoch = 0,
  subscriptions = [],
  roomSubscriptions = [],
  commentStop = null,
  rooms = [],
  invites = [],
  room = null,
  members = [],
  projects = [],
  tasks = [],
  activity = [],
  ownerInvites = [],
  projectId = "",
  roomId = "",
  filter = "all",
  editor = null,
  detailId = "",
  busy = false,
  commentAttempt = null;
const route = new URLSearchParams(location.search);
let wantedRoom = route.get("room") || "",
  wantedProject = route.get("project") || "",
  wantedTask = route.get("task") || "";
const myRole = () => members.find((m) => m.id === user?.uid)?.role;
const manages = () => M.manages(myRole());
const editable = () => room && !room.archived && manages();
const project = () => projects.find((p) => p.id === projectId);
const selectedTask = () => tasks.find((t) => t.id === detailId);
const stamp = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "";
};
const notice = (message = "", error = false) => note("notice", message, error);
const note = (id, message, error = false) => {
  $(id).textContent = message;
  $(id).classList.toggle("is-error", error);
};
const stopRoom = () => {
  roomEpoch++;
  for (const id of [
    "project-list",
    "project-heading",
    "task-list",
    "people-list",
    "owner-invites",
    "comments",
    "task-description",
    "task-title",
    "activity-list",
    "room-description",
    "my-role",
    "room-name",
  ])
    $(id).replaceChildren();
  $("members-toggle").hidden = true;
  $("archive-room").hidden = true;
  roomSubscriptions.forEach((stop) => stop());
  roomSubscriptions = [];
  commentStop?.();
  commentStop = null;
  room = null;
  members = [];
  projects = [];
  tasks = [];
  activity = [];
  ownerInvites = [];
  detailId = "";
  $("task-detail").close();
  $("people").close();
};
function clear() {
  subscriptions.forEach((stop) => stop());
  subscriptions = [];
  stopRoom();
  rooms = [];
  invites = [];
  roomId = "";
  projectId = "";
  editor = null;
  api.clearRequests();
  $("editor").close();
  $("editor-form").reset();
  $("editor-fields").innerHTML = "";
  $("comment-form").reset();
  for (const id of [
    "project-list",
    "project-heading",
    "task-list",
    "people-list",
    "owner-invites",
    "comments",
    "task-description",
    "task-title",
    "activity-list",
    "invitations",
    "room-description",
    "my-role",
    "room-name",
  ])
    $(id).replaceChildren();
  $("room-select").innerHTML = '<option value="">Choose a room</option>';
  $("room-work").hidden = true;
  $("teams-app").hidden = true;
}
function accessLost(message) {
  epoch++;
  clear();
  $("gate").hidden = false;
  note("gate-message", message);
}
async function start(nextUser) {
  if (nextUser && auth.currentUser?.uid !== nextUser.uid) return;
  const token = ++epoch;
  clear();
  user = nextUser;
  $("gate").hidden = false;
  $("retry-access").hidden = true;
  if (!user) {
    note("gate-message", "Sign in with Google to open Teams.");
    return;
  }
  try {
    const session = await resolveDeskSession(user);
    if (token !== epoch) return;
    if (!session.hasDeskAccess) {
      note(
        "gate-message",
        "This account needs approved Desk access before joining or creating a team. Invitations do not grant site access.",
      );
      return;
    }
    $("gate").hidden = true;
    $("teams-app").hidden = false;
    const error = (err) => {
      if (token === epoch) notice("Unable to load Teams. " + err.message);
    };
    subscriptions.push(
      api.watchRooms(
        user.uid,
        (list) => {
          if (token !== epoch) return;
          rooms = list;
          renderRooms();
        },
        error,
      ),
    );
    if (user.emailVerified)
      subscriptions.push(
        api.watchInvites(
          user.email,
          (list) => {
            if (token !== epoch) return;
            invites = list;
            renderInvites();
          },
          error,
        ),
      );
    subscriptions.push(
      api.watchAccess(
        user.uid,
        (approval) => {
          if (token !== epoch) return;
          if (
            user.email !== ADMIN_EMAIL &&
            !(
              approval?.status === "approved" &&
              approval.accessSections?.includes("desk")
            )
          )
            accessLost("Your Desk access is no longer active.");
        },
        () => accessLost("Access could not be verified. Sign in again."),
      ),
    );
  } catch (err) {
    if (token !== epoch) return;
    note("gate-message", "Unable to check access: " + err.message);
    $("retry-access").hidden = false;
  }
}
initHeaderAuth({ onStateChange: ({ user: nextUser }) => start(nextUser) });
$("retry-access").onclick = () => start(user);
function renderRooms() {
  $("room-select").innerHTML =
    '<option value="">Choose a room</option>' +
    rooms
      .map(
        (r) =>
          `<option value="${e(r.id)}">${e(r.name)}${r.archived ? " (archived)" : ""}</option>`,
      )
      .join("");
  $("room-empty").hidden = rooms.length > 0;
  if (roomId && !rooms.some((r) => r.id === roomId)) {
    stopRoom();
    roomId = "";
    projectId = "";
    $("room-work").hidden = true;
    $("editor").close();
    editor = null;
    notice("Your membership changed. Choose an available room.");
  }
  if (!roomId && rooms.length) {
    const pick = rooms.find((r) => r.id === wantedRoom) || rooms[0];
    switchRoom(pick.id);
    wantedRoom = "";
  }
  $("room-select").value = roomId;
}
function renderInvites() {
  $("invitations").innerHTML = invites
    .map(
      (i) =>
        `<article class="invitation"><div><strong>${e(i.roomName)}</strong><p>Invited as ${e(i.role)} · ${i.expiresAt <= new Date().toISOString() ? "Expired — ask the owner to reissue" : "Accept by " + e(new Date(i.expiresAt).toLocaleDateString())}</p></div><button class="primary" data-accept="${e(i.id)}" ${i.expiresAt <= new Date().toISOString() ? "disabled" : ""}>Join team room</button></article>`,
    )
    .join("");
  if (route.get("invite") && !invites.some((i) => i.id === route.get("invite")))
    notice(
      "If your invitation is not listed, check that you signed in with the invited email and have Desk approval.",
    );
}
function switchRoom(next) {
  stopRoom();
  roomId = next;
  projectId = "";
  $("room-work").hidden = !next;
  if (!next) return;
  const token = epoch,
    generation = roomEpoch;
  const live = () =>
    token === epoch && generation === roomEpoch && roomId === next;
  const error = (err) => {
    if (!live()) return;
    stopRoom();
    $("room-work").hidden = true;
    for (const id of [
      "project-list",
      "task-list",
      "project-heading",
      "people-list",
      "owner-invites",
      "comments",
      "activity-list",
    ])
      $(id).replaceChildren();
    $("editor").close();
    editor = null;
    notice("Room access ended or could not be verified. " + err.message);
  };
  roomSubscriptions.push(
    api.watchRoom(
      next,
      (value) => {
        if (!live()) return;
        if (!value) {
          error(Error("Room unavailable."));
          return;
        }
        room = value;
        render();
      },
      error,
    ),
  );
  for (const kind of ["members", "projects", "tasks"])
    roomSubscriptions.push(
      api.watchRecords(
        next,
        kind,
        (list) => {
          if (!live()) return;
          if (kind === "members") {
            members = list;
            if (!list.some((m) => m.id === user.uid)) {
              error(Error("Membership ended."));
              return;
            }
          }
          if (kind === "projects") projects = list;
          if (kind === "tasks") tasks = list;
          render();
        },
        error,
      ),
    );
  roomSubscriptions.push(
    api.watchActivity(
      next,
      (list) => {
        if (!live()) return;
        activity = list;
        renderActivity();
      },
      error,
    ),
  );
  // Owner invitation query is created only after membership is known.
  let ownerStop = null;
  roomSubscriptions.push(() => ownerStop?.());
  roomSubscriptions.push(
    api.watchRecords(
      next,
      "members",
      (list) => {
        if (!live()) return;
        const owner = list.find((m) => m.id === user.uid)?.role === "owner";
        if (owner && !ownerStop)
          ownerStop = api.watchOwnerInvites(
            next,
            (items) => {
              if (live()) {
                ownerInvites = items;
                renderPeople();
              }
            },
            error,
          );
        if (!owner && ownerStop) {
          ownerStop();
          ownerStop = null;
          ownerInvites = [];
        }
      },
      error,
    ),
  );
  history.replaceState({}, "", `teams.html?room=${encodeURIComponent(next)}`);
}
$("room-select").onchange = () => {
  if (editor && !confirm("Discard your unsaved form changes?")) {
    $("room-select").value = roomId;
    return;
  }
  $("editor").close();
  editor = null;
  switchRoom($("room-select").value);
};
function render() {
  if (!room) return;
  $("room-name").textContent = room.name;
  $("room-description").textContent = room.description;
  $("my-role").textContent = myRole() ? `Your role: ${myRole()}` : "";
  $("room-state").textContent = room.archived
    ? "Archived room · read only"
    : "Shared projects";
  $("members-toggle").hidden = false;
  $("archive-room").hidden = myRole() !== "owner";
  $("archive-room").textContent = room.archived
    ? "Restore room"
    : "Archive room";
  $("create-project").hidden = !editable();
  if (!projectId || !projects.some((p) => p.id === projectId)) {
    projectId =
      (
        projects.find((p) => p.id === wantedProject) ||
        projects.find((p) => !p.archived) ||
        projects[0]
      )?.id || "";
    if (projectId) wantedProject = "";
  }
  $("project-list").innerHTML = projects.length
    ? [...projects]
        .sort(
          (a, b) =>
            Number(a.archived) - Number(b.archived) ||
            a.title.localeCompare(b.title),
        )
        .map((p) => {
          const progress = M.progress(
            tasks.filter((t) => t.projectId === p.id),
          );
          return `<button class="project-card ${p.id === projectId ? "selected" : ""}" data-project="${e(p.id)}" aria-pressed="${p.id === projectId}"><h3>${e(p.title)}</h3><small>${p.archived ? "Archived" : p.targetDate ? "Target " + e(p.targetDate) : "No target date"}</small><div class="progress-line"><span>${progress.done} of ${progress.total} tasks done</span><strong>${progress.percent}%</strong></div><progress max="100" value="${progress.percent}" aria-label="${e(p.title)} ${progress.percent}% complete"></progress></button>`;
        })
        .join("")
    : '<p class="empty">No shared projects yet. A leader or owner can create the first one.</p>';
  const current = project();
  $("project-work").hidden = !current;
  if (current) {
    const progress = M.progress(
      tasks.filter((t) => t.projectId === current.id),
    );
    $("project-heading").innerHTML =
      `<h2>${e(current.title)}</h2><p>${e(current.description)}</p><p class="muted">${current.archived ? "Archived · " : ""}${progress.percent}% complete · ${progress.done} / ${progress.total} tasks${current.targetDate ? " · Target " + e(current.targetDate) : ""}</p><div class="project-meta">${editable() ? `${!current.archived ? '<button id="edit-project" class="link-button">Edit project</button>' : ""}<button id="archive-project" class="link-button">${current.archived ? "Restore" : "Archive"} project</button>` : ""}</div>`;
  }
  $("create-task").hidden = !editable() || !current || current.archived;
  renderTasks();
  renderPeople();
  renderActivity();
  if (detailId && !selectedTask()) {
    $("task-detail").close();
    detailId = "";
    commentStop?.();
  }
  if (detailId) renderDetail();
  if (wantedTask && tasks.some((t) => t.id === wantedTask)) {
    const taskId = wantedTask;
    wantedTask = "";
    openTask(taskId);
  }
}
function renderTasks() {
  let list = tasks.filter((t) => t.projectId === projectId);
  if (filter === "mine") list = list.filter((t) => t.assigneeUid === user.uid);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const name = (t) =>
    names.get(t.assigneeUid) ||
    (t.assigneeUid ? "Former member" : "Unassigned");
  list.sort((a, b) =>
    filter === "people"
      ? name(a).localeCompare(name(b)) || a.title.localeCompare(b.title)
      : (a.status === "done") - (b.status === "done") ||
        a.title.localeCompare(b.title),
  );
  let lastName = "";
  $("task-list").innerHTML =
    list
      .map((t) => {
        const canChange =
          !room.archived &&
          !project()?.archived &&
          (manages() || t.assigneeUid === user.uid);
        const heading =
          filter === "people" && lastName !== name(t)
            ? `<h3>${e(name(t))}</h3>`
            : "";
        lastName = name(t);
        return (
          heading +
          `<article class="task ${t.status === "done" ? "done" : ""}"><div><button class="title" data-open-task="${e(t.id)}">${e(t.title)}</button><small>${e(name(t))} · ${e(t.priority)} priority${t.dueDate ? " · Due " + e(t.dueDate) : ""}</small></div><select data-task-status="${e(t.id)}" aria-label="Status for ${e(t.title)}" ${canChange ? "" : "disabled"}>${M.STATUSES.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${M.LABELS[s]}</option>`).join("")}</select><div class="task-actions">${editable() && !project()?.archived ? `<button data-edit-task="${e(t.id)}" class="link-button">Edit</button>` : ""}${!room.archived && !project()?.archived && !t.assigneeUid && !["done", "cancelled"].includes(t.status) ? `<button data-claim="${e(t.id)}" class="link-button">Claim</button>` : ""}</div></article>`
        );
      })
      .join("") || '<p class="empty">No tasks in this view yet.</p>';
}
function renderPeople() {
  const owner = myRole() === "owner";
  $("people-list").innerHTML = members
    .map(
      (m) =>
        `<div class="person"><strong>${e(m.name)}</strong><small>${e(m.email)} · ${e(m.role)}</small>${owner && m.role !== "owner" ? `<div class="actions"><select data-member-role="${e(m.id)}" aria-label="Role for ${e(m.name)}" ${room?.archived ? "disabled" : ""}><option value="member" ${m.role === "member" ? "selected" : ""}>Member</option><option value="leader" ${m.role === "leader" ? "selected" : ""}>Leader</option></select><button data-remove-member="${e(m.id)}">Remove member</button></div>` : ""}</div>`,
    )
    .join("");
  $("invite-section").hidden = !owner || room?.archived;
  $("owner-invites").innerHTML = ownerInvites
    .map(
      (i) =>
        `<div class="owner-invite"><strong>${e(i.email)}</strong><p>${e(i.role)} · ${i.expiresAt <= new Date().toISOString() ? "Expired" : "Pending acceptance"}</p><button data-copy-invite="${e(i.id)}">Copy join link</button> <button data-revoke-invite="${e(i.id)}">Revoke invitation</button></div>`,
    )
    .join("");
}
function renderActivity() {
  $("activity-list").innerHTML =
    activity
      .map(
        (a) =>
          `<p><strong>${e(a.actorName)}</strong> · ${e({ saveTask: "saved a task", taskStatus: "updated task status", claimTask: "claimed a task", comment: "posted a comment", saveProject: "saved a project", archiveProject: "archived/restored a project", invite: "created an invitation", revokeInvite: "revoked an invitation", setRole: "changed a member role", removeMember: "removed a member", archiveRoom: "archived/restored the room" }[a.action] || a.action)}<br><span class="muted">${e(stamp(a.createdAt))}</span></p>`,
      )
      .join("") || "<p>No activity yet.</p>";
}
function input(name, label, value = "", type = "text", max = 120) {
  return `<label>${e(label)}<input name="${name}" type="${type}" value="${e(value)}" ${type === "text" ? `maxlength="${max}"` : ""} ${["name", "title"].includes(name) ? "required" : ""}></label>`;
}
const textarea = (name, label, value = "", max = 4000) =>
  `<label>${e(label)}<textarea name="${name}" maxlength="${max}">${e(value)}</textarea></label>`;
function openEditor(kind, record = null) {
  const id = record?.id || crypto.randomUUID();
  editor = { kind, id, version: record?.version, roomId };
  note("editor-error", "");
  $("editor-title").textContent =
    kind === "room"
      ? "Create a team room"
      : `${record ? "Edit" : "New"} ${kind}`;
  if (kind === "room")
    $("editor-fields").innerHTML =
      input("name", "Room name") +
      textarea("description", "What is this room for?", "", 2000);
  if (kind === "project")
    $("editor-fields").innerHTML =
      input("title", "Project name", record?.title) +
      textarea("description", "Project description", record?.description) +
      input(
        "targetDate",
        "Target date (optional)",
        record?.targetDate || "",
        "date",
      );
  if (kind === "task")
    $("editor-fields").innerHTML =
      input("title", "Task title", record?.title || "", "text", 200) +
      textarea("description", "Details", record?.description || "") +
      `<label for="task-assignee">Assigned to</label><select id="task-assignee" name="assigneeUid"><option value="">Unassigned</option>${record?.assigneeUid && !members.some((m) => m.id === record.assigneeUid) ? `<option value="${e(record.assigneeUid)}" selected>Former member — choose a current member</option>` : ""}${members.map((m) => `<option value="${e(m.id)}" ${m.id === record?.assigneeUid ? "selected" : ""}>${e(m.name)}</option>`).join("")}</select><label for="task-priority">Priority</label><select id="task-priority" name="priority">${["low", "medium", "high"].map((v) => `<option ${v === (record?.priority || "medium") ? "selected" : ""}>${v}</option>`).join("")}</select>` +
      input("dueDate", "Due date (optional)", record?.dueDate || "", "date") +
      `<label for="task-status">Status</label><select id="task-status" name="status">${M.STATUSES.map((s) => `<option value="${s}" ${s === (record?.status || "todo") ? "selected" : ""}>${M.LABELS[s]}</option>`).join("")}</select><input name="projectId" type="hidden" value="${e(record?.projectId || projectId)}">`;
  editor.initial = JSON.stringify([...new FormData($("editor-form"))]);
  $("editor").showModal();
  $("editor-fields").querySelector("input")?.focus();
}
function closeEditor() {
  if (busy) return;
  if (
    editor &&
    JSON.stringify([...new FormData($("editor-form"))]) !== editor.initial &&
    !confirm("Discard unsaved changes?")
  )
    return;
  $("editor").close();
  editor = null;
}
$("close-editor").onclick = closeEditor;
$("cancel-editor").onclick = closeEditor;
$("editor").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeEditor();
});
$("editor-form").onsubmit = async (event) => {
  event.preventDefault();
  if (!editor || busy) return;
  const draft = { ...editor },
    payload = Object.fromEntries(new FormData(event.target));
  const token = epoch;
  busy = true;
  $("save-editor").disabled = true;
  note("editor-error", "Saving…");
  try {
    const options = { id: draft.id, payload };
    if (draft.kind !== "room") {
      options.roomId = draft.roomId;
      if (draft.version) options.version = draft.version;
    }
    const result = await api.command(
      draft.kind === "room"
        ? "createRoom"
        : draft.kind === "project"
          ? "saveProject"
          : "saveTask",
      options,
    );
    if (token !== epoch) return;
    $("editor").close();
    editor = null;
    notice("Saved.");
    if (draft.kind === "room") {
      wantedRoom = result.roomId;
      switchRoom(result.roomId);
    }
    if (draft.kind === "project") {
      projectId = result.id;
      render();
    }
  } catch (err) {
    if (token === epoch)
      note(
        "editor-error",
        err.message +
          " Your entries are still here. If another person changed this record, copy your edits and reopen it.",
        true,
      );
  } finally {
    busy = false;
    $("save-editor").disabled = false;
  }
};
async function act(action, options = {}, statusId = "notice") {
  if (busy) return false;
  busy = true;
  const token = epoch;
  note(statusId, "Saving…");
  try {
    await api.command(action, { roomId, ...options });
    if (token === epoch) note(statusId, "Saved.");
    return true;
  } catch (err) {
    // A rejected version check did not commit. A retry can use the live task
    // version; keep the original attempt after uncertain network failures.
    if (
      action === "comment" &&
      (err.code === "functions/aborted" || /record changed/.test(err.message))
    )
      commentAttempt = null;
    if (token === epoch) note(statusId, err.message, true);
    return false;
  } finally {
    busy = false;
  }
}
$("create-room").onclick = () => openEditor("room");
$("create-project").onclick = () => openEditor("project");
$("create-task").onclick = () => openEditor("task");
$("people").addEventListener("cancel", (event) => {
  if (
    busy ||
    ($("invite-form").elements.email.value.trim() &&
      !confirm("Discard the unsent invitation?"))
  )
    event.preventDefault();
});
$("members-toggle").onclick = () => {
  $("people").showModal();
};
$("close-people").onclick = () => {
  if (
    !busy &&
    (!$("invite-form").elements.email.value.trim() ||
      confirm("Discard the unsent invitation?"))
  )
    $("people").close();
};
$("archive-room").onclick = () => {
  if (
    room &&
    confirm(
      `${room.archived ? "Restore" : "Archive"} this room? ${room.archived ? "Members can work on it again." : "Projects remain available to members, but editing and Desk assignments will pause."}`,
    )
  )
    act("archiveRoom", {
      version: room.version,
      payload: { archived: !room.archived },
    });
};
$("invite-form").onsubmit = async (event) => {
  event.preventDefault();
  if (
    await act(
      "invite",
      { payload: Object.fromEntries(new FormData(event.target)) },
      "people-status",
    )
  )
    event.target.reset();
};
function renderDetail() {
  const task = selectedTask();
  if (!task) return;
  $("task-title").textContent = task.title;
  $("task-description").innerHTML =
    `<p>${e(task.description || "No details yet.")}</p><p class="muted">${e(M.LABELS[task.status])} · ${e(members.find((m) => m.id === task.assigneeUid)?.name || (task.assigneeUid ? "Former member" : "Unassigned"))}</p>`;
  $("comment-form").hidden = room.archived || task.projectArchived;
}
function openTask(id) {
  commentAttempt = null;
  commentStop?.();
  detailId = id;
  renderDetail();
  $("comments").textContent = "Loading discussion…";
  note("comment-status", "");
  $("comment-form").reset();
  if (!$("task-detail").open) $("task-detail").showModal();
  const token = epoch,
    currentRoom = roomId;
  commentStop = api.watchComments(
    roomId,
    id,
    (list) => {
      if (token !== epoch || detailId !== id || roomId !== currentRoom) return;
      $("comments").innerHTML =
        list
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(
            (c) =>
              `<article class="comment"><strong>${e(c.authorName)}</strong><small>${e(stamp(c.createdAt))}</small><p>${e(c.body)}</p></article>`,
          )
          .join("") || '<p class="muted">Start the conversation.</p>';
    },
    (err) => note("comment-status", err.message),
  );
}
function closeTask() {
  if (
    $("comment-body").value.trim() &&
    !confirm("Discard your unsent comment?")
  )
    return;
  $("task-detail").close();
  commentStop?.();
  commentStop = null;
  detailId = "";
}
$("close-task").onclick = closeTask;
$("task-detail").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeTask();
});
$("comment-form").onsubmit = async (event) => {
  event.preventDefault();
  const task = selectedTask();
  if (!task) return;
  const body = $("comment-body").value;
  if (
    !commentAttempt ||
    commentAttempt.id !== task.id ||
    commentAttempt.payload.body !== body
  )
    commentAttempt = { id: task.id, version: task.version, payload: { body } };
  if (await act("comment", commentAttempt, "comment-status")) {
    commentAttempt = null;
    event.target.reset();
  }
};
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || busy) return;
  const d = button.dataset;
  if (d.filter) {
    filter = d.filter;
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    renderTasks();
  }
  if (d.project) {
    projectId = d.project;
    render();
  }
  if (d.openTask) openTask(d.openTask);
  if (d.editTask)
    openEditor(
      "task",
      tasks.find((t) => t.id === d.editTask),
    );
  if (button.id === "edit-project") openEditor("project", project());
  if (
    button.id === "archive-project" &&
    confirm(
      `${project().archived ? "Restore" : "Archive"} this project? Tasks and history will be retained.`,
    )
  )
    act("archiveProject", {
      id: projectId,
      version: project().version,
      payload: { archived: !project().archived },
    });
  if (d.claim) {
    const task = tasks.find((t) => t.id === d.claim);
    act("claimTask", { id: task.id, version: task.version });
  }
  if (d.accept) {
    const token = epoch;
    busy = true;
    button.disabled = true;
    try {
      const result = await api.command("acceptInvite", {
        id: d.accept,
        payload: {},
      });
      if (token !== epoch) return;
      wantedRoom = result.roomId;
      switchRoom(result.roomId);
      notice("Welcome to your team room.");
    } catch (err) {
      if (token === epoch) notice(err.message);
    } finally {
      busy = false;
      button.disabled = false;
    }
  }
  if (d.removeMember) {
    const member = members.find((m) => m.id === d.removeMember);
    if (
      confirm(
        `Remove ${member.name}? Their access to this room ends immediately. Tasks and discussion history will remain.`,
      )
    )
      act(
        "removeMember",
        { id: member.id, version: member.version },
        "people-status",
      );
  }
  if (
    d.revokeInvite &&
    confirm("Revoke this invitation? The link will no longer allow joining.")
  )
    act("revokeInvite", { id: d.revokeInvite }, "people-status");
  if (d.copyInvite) {
    const link = new URL("teams.html", location.href);
    link.searchParams.set("invite", d.copyInvite);
    try {
      await navigator.clipboard.writeText(link.href);
      note("people-status", "Join link copied. Send it to the invited email.");
    } catch {
      note("people-status", "Copy this join link: " + link.href);
    }
  }
});
document.addEventListener("change", async (event) => {
  const d = event.target.dataset;
  if (d.taskStatus) {
    const task = tasks.find((t) => t.id === d.taskStatus);
    if (
      !(await act("taskStatus", {
        id: task.id,
        version: task.version,
        payload: { status: event.target.value },
      }))
    )
      renderTasks();
  }
  if (d.memberRole) {
    const member = members.find((m) => m.id === d.memberRole);
    if (!confirm(`Change ${member.name}'s role to ${event.target.value}?`)) {
      renderPeople();
      return;
    }
    if (
      !(await act(
        "setRole",
        {
          id: member.id,
          version: member.version,
          payload: { role: event.target.value },
        },
        "people-status",
      ))
    )
      renderPeople();
  }
});
window.addEventListener("beforeunload", (event) => {
  if (
    (editor &&
      JSON.stringify([...new FormData($("editor-form"))]) !== editor.initial) ||
    $("comment-body").value.trim()
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
