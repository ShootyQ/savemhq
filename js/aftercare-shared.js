import {
  doc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "./auth-shared.js";

export const AFTERCARE_PROGRAM_ID = "school-aftercare";
export const AFTERCARE_PROGRAM_TITLE = "School Aftercare";
export const AFTERCARE_STATUS = {
  checkedIn: "checked-in",
  checkedOut: "checked-out",
};

export const aftercareProgramRef = doc(db, "aftercarePrograms", AFTERCARE_PROGRAM_ID);
export const aftercareStudentsCollection = collection(aftercareProgramRef, "students");
export const aftercareAttendanceCollection = collection(aftercareProgramRef, "attendance");

export const normalizeStudentName = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

export const normalizeStudentSearch = (value = "") => normalizeStudentName(value).toLowerCase();

export const toLocalDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const actorLabelForUser = (user) => {
  const displayName = String(user?.displayName || "").trim();
  if (displayName) {
    return displayName;
  }

  const email = String(user?.email || "").trim();
  if (!email) {
    return "Staff";
  }

  return email.split("@")[0] || email;
};

export const isStudentCheckedIn = (student = {}) => String(student.currentStatus || "") === AFTERCARE_STATUS.checkedIn;

const asDate = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatAftercareTime = (value) => {
  const date = asDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
};

export const formatAftercareDateTime = (value) => {
  const date = asDate(value);
  if (!date) {
    return "";
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const subscribeToAftercareStudents = ({ onData, onError } = {}) => onSnapshot(
  query(aftercareStudentsCollection, orderBy("normalizedName")),
  (snapshot) => {
    onData?.(snapshot.docs.map((studentDoc) => ({ id: studentDoc.id, ...studentDoc.data() })));
  },
  onError
);

export const subscribeToAftercareAttendance = ({ onData, onError } = {}) => onSnapshot(
  query(aftercareAttendanceCollection, orderBy("checkedInAt", "desc")),
  (snapshot) => {
    onData?.(snapshot.docs.map((attendanceDoc) => ({ id: attendanceDoc.id, ...attendanceDoc.data() })));
  },
  onError
);

export const createAftercareStudent = async ({ displayName = "", group = "", isActive = true } = {}) => {
  const normalizedDisplayName = normalizeStudentName(displayName);
  if (!normalizedDisplayName) {
    throw new Error("Student name is required.");
  }

  const studentRef = doc(aftercareStudentsCollection);
  await setDoc(studentRef, {
    displayName: normalizedDisplayName,
    normalizedName: normalizeStudentSearch(normalizedDisplayName),
    group: normalizeStudentName(group) || null,
    isActive: Boolean(isActive),
    currentStatus: AFTERCARE_STATUS.checkedOut,
    currentAttendanceId: null,
    currentCheckInAt: null,
    lastActionAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return studentRef.id;
};

export const saveAftercareStudent = async ({ studentId = "", existingStudent = null, displayName = "", group = "", isActive = true } = {}) => {
  const normalizedDisplayName = normalizeStudentName(displayName);
  if (!studentId) {
    throw new Error("Student id is required.");
  }

  if (!normalizedDisplayName) {
    throw new Error("Student name is required.");
  }

  await setDoc(doc(aftercareStudentsCollection, studentId), {
    displayName: normalizedDisplayName,
    normalizedName: normalizeStudentSearch(normalizedDisplayName),
    group: normalizeStudentName(group) || null,
    isActive: Boolean(isActive),
    currentStatus: String(existingStudent?.currentStatus || AFTERCARE_STATUS.checkedOut),
    currentAttendanceId: existingStudent?.currentAttendanceId || null,
    currentCheckInAt: existingStudent?.currentCheckInAt || null,
    lastActionAt: existingStudent?.lastActionAt || null,
    createdAt: existingStudent?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const setAftercareStudentActive = async ({ studentId = "", isActive = true } = {}) => {
  if (!studentId) {
    throw new Error("Student id is required.");
  }

  await updateDoc(doc(aftercareStudentsCollection, studentId), {
    isActive: Boolean(isActive),
    updatedAt: serverTimestamp(),
  });
};

export const toggleAftercareAttendance = async ({ student = null, user = null } = {}) => {
  if (!student?.id) {
    throw new Error("Student record is missing.");
  }

  if (!user?.uid) {
    throw new Error("You must be signed in.");
  }

  const studentRef = doc(aftercareStudentsCollection, student.id);
  const batch = writeBatch(db);
  const actorLabel = actorLabelForUser(user);
  const studentGroup = normalizeStudentName(student.group) || null;

  if (isStudentCheckedIn(student)) {
    if (!student.currentAttendanceId) {
      throw new Error(`Missing attendance record for ${student.displayName || "student"}.`);
    }

    batch.update(doc(aftercareAttendanceCollection, student.currentAttendanceId), {
      status: AFTERCARE_STATUS.checkedOut,
      checkedOutAt: serverTimestamp(),
      checkedOutByUid: user.uid,
      checkedOutByLabel: actorLabel,
      updatedAt: serverTimestamp(),
    });
    batch.update(studentRef, {
      currentStatus: AFTERCARE_STATUS.checkedOut,
      currentAttendanceId: null,
      currentCheckInAt: null,
      lastActionAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
    return {
      action: AFTERCARE_STATUS.checkedOut,
      studentName: student.displayName,
    };
  }

  const attendanceRef = doc(aftercareAttendanceCollection);
  batch.set(attendanceRef, {
    studentId: student.id,
    studentName: student.displayName || "Student",
    studentGroup,
    dateKey: toLocalDateKey(),
    status: AFTERCARE_STATUS.checkedIn,
    checkedInAt: serverTimestamp(),
    checkedOutAt: null,
    checkedInByUid: user.uid,
    checkedInByLabel: actorLabel,
    checkedOutByUid: null,
    checkedOutByLabel: null,
    updatedAt: serverTimestamp(),
  });
  batch.update(studentRef, {
    currentStatus: AFTERCARE_STATUS.checkedIn,
    currentAttendanceId: attendanceRef.id,
    currentCheckInAt: serverTimestamp(),
    lastActionAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return {
    action: AFTERCARE_STATUS.checkedIn,
    studentName: student.displayName,
  };
};