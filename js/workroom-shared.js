import {
  collection,
  doc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { auth, db, isWorkroomOwner } from "./auth-shared.js";

export const workroomRef = (uid) => doc(db, "workrooms", uid);
export const projectsRef = (uid) => collection(workroomRef(uid), "projects");
export const tasksRef = (uid) => collection(workroomRef(uid), "tasks");
export const financeRef = (uid) => collection(workroomRef(uid), "financeReminders");
export const contactFollowUpsRef = (uid) => collection(workroomRef(uid), "contactFollowUps");
export const achEntriesRef = (uid) => collection(workroomRef(uid), "achEntries");
export const focusRef = (uid) => doc(workroomRef(uid), "settings", "focus");
export const summaryRef = (uid) => doc(db, "workroomSummaries", uid);
export const briefingRef = (uid) => doc(db, "workroomAi", uid);
export const connectionsRef = (uid) => collection(db, "workroomConnections", uid, "connections");

export const isOwner = (user = auth.currentUser) => isWorkroomOwner(user);

export const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

export const asDate = (value) => {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDay = (value, options = {}) => {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...options }).format(date) : "No date";
};

export const formatDateTime = (value) => {
  const date = asDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "—";
};

export const dateInputValue = (value = new Date()) => {
  const date = asDate(value) || new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const startOfLocalDay = (value) => {
  const date = asDate(value);
  if (!date) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const priorityRank = (priority) => ({ high: 0, medium: 1, low: 2 }[priority] ?? 3);
