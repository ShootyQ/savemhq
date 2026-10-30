import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  limit,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { db } from "../auth-shared.js";
const call = httpsCallable(getFunctions(), "teamCommand");
// Retain the request ID after uncertain failures; changed inputs get a new ID.
const pending = new Map();
export async function command(action, options = {}) {
  const key = JSON.stringify({ action, ...options });
  if (!pending.has(key)) pending.set(key, crypto.randomUUID());
  const result = await call({
    action,
    ...options,
    requestId: pending.get(key),
  });
  pending.delete(key);
  return result.data;
}
export const clearRequests = () => pending.clear();
const rows = (ref, next, error) =>
  onSnapshot(
    ref,
    (s) => next(s.docs.map((d) => ({ ...d.data(), id: d.id }))),
    error,
  );
export const watchRooms = (uid, next, error) =>
  rows(
    query(collection(db, "teamUsers", uid, "rooms"), limit(20)),
    next,
    error,
  );
export const watchInvites = (email, next, error) =>
  rows(
    query(
      collection(db, "teamInvites"),
      where("email", "==", email.toLowerCase()),
      where("status", "==", "pending"),
      limit(50),
    ),
    next,
    error,
  );
export const watchOwnerInvites = (roomId, next, error) =>
  rows(
    query(
      collection(db, "teamInvites"),
      where("roomId", "==", roomId),
      where("status", "==", "pending"),
      limit(50),
    ),
    next,
    error,
  );
export const watchRoom = (roomId, next, error) =>
  onSnapshot(
    doc(db, "teamRooms", roomId),
    (s) => next(s.exists() ? { ...s.data(), id: s.id } : null),
    error,
  );
export const watchRecords = (roomId, kind, next, error) =>
  rows(
    query(
      collection(db, "teamRooms", roomId, kind),
      limit({ members: 50, projects: 100, tasks: 300 }[kind] || 50),
    ),
    next,
    error,
  );
export const watchActivity = (roomId, next, error) =>
  rows(
    query(
      collection(db, "teamRooms", roomId, "activity"),
      orderBy("createdAt", "desc"),
      limit(30),
    ),
    next,
    error,
  );
export const watchComments = (roomId, taskId, next, error) =>
  rows(
    query(
      collection(db, "teamRooms", roomId, "comments"),
      where("taskId", "==", taskId),
      limit(200),
    ),
    next,
    error,
  );

// No copies under workrooms/: these subscriptions read canonical assignments.
export function watchAssignments(uid, next, error) {
  let stopped = false;
  const rooms = new Map();
  const emit = () => {
    if (!stopped) next([...rooms.values()].flatMap((entry) => entry.tasks));
  };
  const stopRooms = watchRooms(
    uid,
    (list) => {
      const active = new Set(list.filter((r) => !r.archived).map((r) => r.id));
      for (const [key, entry] of rooms)
        if (!active.has(key)) {
          entry.stop();
          rooms.delete(key);
        }
      for (const room of list.filter((r) => !r.archived))
        if (!rooms.has(room.id)) {
          const entry = { tasks: [], stop: () => {} };
          rooms.set(room.id, entry);
          entry.stop = rows(
            query(
              collection(db, "teamRooms", room.id, "tasks"),
              where("assigneeUid", "==", uid),
              limit(300),
            ),
            (tasks) => {
              if (stopped || rooms.get(room.id) !== entry) return;
              entry.tasks = tasks
                .filter((t) => !t.projectArchived && t.status !== "cancelled")
                .map((t) => ({
                  ...t,
                  id: `team_${room.id}:${t.id}`,
                  taskId: t.id,
                  roomId: room.id,
                  roomName: room.name,
                  source: "team",
                  teamStatus: t.status,
                  status: t.status === "done" ? "done" : "next",
                  notes: `Team: ${room.name}\n${t.description || ""}`,
                  dueDate: t.dueDate
                    ? Timestamp.fromDate(new Date(t.dueDate + "T12:00:00"))
                    : null,
                  completedAt: t.completedAt
                    ? Timestamp.fromDate(new Date(t.completedAt))
                    : null,
                }));
              emit();
            },
            (err) => {
              entry.tasks = [];
              emit();
              error?.(err);
            },
          );
        }
      emit();
    },
    (err) => {
      for (const entry of rooms.values()) entry.stop();
      rooms.clear();
      emit();
      error?.(err);
    },
  );
  return () => {
    stopped = true;
    stopRooms();
    for (const entry of rooms.values()) entry.stop();
    rooms.clear();
  };
}
export const taskLink = (task) =>
  `teams.html?room=${encodeURIComponent(task.roomId)}&project=${encodeURIComponent(task.projectId)}&task=${encodeURIComponent(task.taskId)}`;
export const completeAssignment = (task, status = "done") =>
  command("taskStatus", {
    roomId: task.roomId,
    id: task.taskId,
    version: task.version,
    payload: { status },
  });
export const watchAccess = (uid, next, error) =>
  onSnapshot(doc(db, "loginApprovals", uid), (s) => next(s.data()), error);
