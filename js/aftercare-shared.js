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

export const parseStudentNameParts = ({ firstName = "", lastName = "", displayName = "" } = {}) => {
  const normalizedFirstName = normalizeStudentName(firstName);
  const normalizedLastName = normalizeStudentName(lastName);
  const normalizedDisplayName = normalizeStudentName(displayName);

  if (normalizedFirstName || normalizedLastName) {
    const builtDisplayName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(" ");
    return {
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      displayName: builtDisplayName || normalizedDisplayName,
      normalizedName: normalizeStudentSearch(builtDisplayName || normalizedDisplayName),
    };
  }

  if (!normalizedDisplayName) {
    return {
      firstName: "",
      lastName: "",
      displayName: "",
      normalizedName: "",
    };
  }

  const commaParts = normalizedDisplayName.split(",").map((part) => normalizeStudentName(part)).filter(Boolean);
  if (commaParts.length >= 2) {
    const parsedLastName = commaParts[0];
    const parsedFirstName = commaParts.slice(1).join(" ");
    const rebuiltDisplayName = [parsedFirstName, parsedLastName].filter(Boolean).join(" ");
    return {
      firstName: parsedFirstName,
      lastName: parsedLastName,
      displayName: rebuiltDisplayName,
      normalizedName: normalizeStudentSearch(rebuiltDisplayName),
    };
  }

  const nameParts = normalizedDisplayName.split(" ").filter(Boolean);
  if (nameParts.length === 1) {
    return {
      firstName: nameParts[0],
      lastName: "",
      displayName: normalizedDisplayName,
      normalizedName: normalizeStudentSearch(normalizedDisplayName),
    };
  }

  const parsedLastName = nameParts.pop() || "";
  const parsedFirstName = nameParts.join(" ");
  return {
    firstName: parsedFirstName,
    lastName: parsedLastName,
    displayName: normalizedDisplayName,
    normalizedName: normalizeStudentSearch(normalizedDisplayName),
  };
};

export const studentSortValue = (student = {}, sortMode = "first-name") => {
  const parsedName = parseStudentNameParts(student);
  if (sortMode === "last-name") {
    return [parsedName.lastName, parsedName.firstName, parsedName.displayName].filter(Boolean).join(" ").toLowerCase();
  }

  return [parsedName.firstName, parsedName.lastName, parsedName.displayName].filter(Boolean).join(" ").toLowerCase();
};

const buildAftercareStudentPayload = ({ firstName = "", lastName = "", displayName = "", group = "", isActive = true, existingStudent = null, updatedAt = serverTimestamp(), createdAt = null } = {}) => {
  const parsedName = parseStudentNameParts({ firstName, lastName, displayName });
  if (!parsedName.displayName) {
    throw new Error("Student first and last name are required.");
  }

  return {
    firstName: parsedName.firstName || null,
    lastName: parsedName.lastName || null,
    displayName: parsedName.displayName,
    normalizedName: parsedName.normalizedName,
    group: normalizeStudentName(group) || null,
    isActive: Boolean(isActive),
    currentStatus: String(existingStudent?.currentStatus || AFTERCARE_STATUS.checkedOut),
    currentAttendanceId: existingStudent?.currentAttendanceId || null,
    currentCheckInAt: existingStudent?.currentCheckInAt || null,
    lastActionAt: existingStudent?.lastActionAt || null,
    createdAt: existingStudent?.createdAt || createdAt || serverTimestamp(),
    updatedAt,
  };
};

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

export const aftercareEntryTimeMs = (entry = {}) => {
  const date = asDate(entry.updatedAt) || asDate(entry.checkedOutAt) || asDate(entry.checkedInAt);
  return date ? date.getTime() : 0;
};

export const latestAftercareAttendanceByStudent = ({ entries = [], dateKey = "" } = {}) => {
  const normalizedDateKey = String(dateKey || "").trim();
  const latestEntries = new Map();

  entries.forEach((entry) => {
    if (normalizedDateKey && String(entry.dateKey || "").trim() !== normalizedDateKey) {
      return;
    }

    const studentId = String(entry.studentId || "").trim();
    if (!studentId) {
      return;
    }

    const existingEntry = latestEntries.get(studentId);
    if (!existingEntry || aftercareEntryTimeMs(entry) >= aftercareEntryTimeMs(existingEntry)) {
      latestEntries.set(studentId, entry);
    }
  });

  return latestEntries;
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

export const createAftercareStudent = async ({ displayName = "", firstName = "", lastName = "", group = "", isActive = true } = {}) => {
  const studentRef = doc(aftercareStudentsCollection);
  await setDoc(studentRef, buildAftercareStudentPayload({ displayName, firstName, lastName, group, isActive }));
  return studentRef.id;
};

export const saveAftercareStudent = async ({ studentId = "", existingStudent = null, displayName = "", firstName = "", lastName = "", group = "", isActive = true } = {}) => {
  if (!studentId) {
    throw new Error("Student id is required.");
  }

  await setDoc(doc(aftercareStudentsCollection, studentId), buildAftercareStudentPayload({
    existingStudent,
    displayName,
    firstName,
    lastName,
    group,
    isActive,
  }));
};

export const importAftercareStudents = async ({ students = [], existingStudents = [] } = {}) => {
  const batch = writeBatch(db);
  const existingKeys = new Set(
    existingStudents
      .map((student) => {
        const parsedName = parseStudentNameParts(student);
        return [parsedName.lastName, parsedName.firstName].filter(Boolean).join("|").toLowerCase();
      })
      .filter(Boolean)
  );

  let createdCount = 0;
  let skippedCount = 0;

  students.forEach((student) => {
    const payload = buildAftercareStudentPayload(student);
    const dedupeKey = [payload.lastName, payload.firstName].filter(Boolean).join("|").toLowerCase();
    if (dedupeKey && existingKeys.has(dedupeKey)) {
      skippedCount += 1;
      return;
    }

    if (dedupeKey) {
      existingKeys.add(dedupeKey);
    }
    batch.set(doc(aftercareStudentsCollection), payload);
    createdCount += 1;
  });

  if (createdCount > 0) {
    await batch.commit();
  }

  return { createdCount, skippedCount };
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

export const resetAftercareDay = async ({ students = [], user = null } = {}) => {
  if (!user?.uid) {
    throw new Error("You must be signed in.");
  }

  const openStudents = students.filter((student) => isStudentCheckedIn(student) && student.currentAttendanceId);
  if (!openStudents.length) {
    return { count: 0 };
  }

  const batch = writeBatch(db);
  const actorLabel = actorLabelForUser(user);

  openStudents.forEach((student) => {
    batch.update(doc(aftercareAttendanceCollection, student.currentAttendanceId), {
      status: AFTERCARE_STATUS.checkedOut,
      checkedOutAt: serverTimestamp(),
      checkedOutByUid: user.uid,
      checkedOutByLabel: actorLabel,
      updatedAt: serverTimestamp(),
    });

    batch.update(doc(aftercareStudentsCollection, student.id), {
      currentStatus: AFTERCARE_STATUS.checkedOut,
      currentAttendanceId: null,
      currentCheckInAt: null,
      lastActionAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
  return { count: openStudents.length };
};