const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { defineSecret, defineString } = require("firebase-functions/params");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const STRAVA_CLIENT_ID = defineString("STRAVA_CLIENT_ID");
const STRAVA_REDIRECT_URI = defineString("STRAVA_REDIRECT_URI");
const TRIATHLON_DASHBOARD_URL = defineString("TRIATHLON_DASHBOARD_URL");
const STRAVA_CLIENT_SECRET = defineSecret("STRAVA_CLIENT_SECRET");
const GOOGLE_CLIENT_ID = defineString("GOOGLE_CLIENT_ID");
const GOOGLE_REDIRECT_URI = defineString("GOOGLE_REDIRECT_URI");
const WORKROOM_CONTROL_URL = defineString("WORKROOM_CONTROL_URL");
const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");
const WORKROOM_AUTOMATION_KEY = defineSecret("WORKROOM_AUTOMATION_KEY");
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
const OPENAI_MODEL = defineString("OPENAI_MODEL", { default: "gpt-4o-mini" });

const ADMIN_EMAIL = "andrewpcarlson85@gmail.com";
const SEASON_ID = "2026-andrew-august-22";
const STRAVA_SCOPE = "read,activity:read_all";
const GOOGLE_SCOPE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.metadata",
].join(" ");

const seasonRef = db.collection("triathlonSeasons").doc(SEASON_ID);
const publicStravaRef = seasonRef.collection("integrations").doc("stravaPublic");
const activityRef = (activityId) => seasonRef.collection("stravaActivities").doc(String(activityId));
const tokenRef = (uid) => db.collection("triathlonSecrets").doc(`${uid}_strava`);
const workroomConnectionRef = (uid, connectionId) => db.collection("workroomConnections").doc(uid).collection("connections").doc(connectionId);
const workroomSecretRef = (uid, connectionId) => db.collection("workroomSecrets").doc(`${uid}_${connectionId}`);
const workroomSummaryRef = (uid) => db.collection("workroomSummaries").doc(uid);
const workroomTasksCollectionRef = (uid) => db.collection("workrooms").doc(uid).collection("tasks");
const workroomProjectsCollectionRef = (uid) => db.collection("workrooms").doc(uid).collection("projects");
const workroomFinanceCollectionRef = (uid) => db.collection("workrooms").doc(uid).collection("financeReminders");
const workroomContactCollectionRef = (uid) => db.collection("workrooms").doc(uid).collection("contactFollowUps");
const workroomAchCollectionRef = (uid) => db.collection("workrooms").doc(uid).collection("achEntries");
const workroomAutomationUsageRef = (uid, dateKey) => db.collection("workroomAutomationUsage").doc(`${uid}_${dateKey}`);
const workroomAutomationIdempotencyRef = (uid, requestId) => db.collection("workroomAutomationIdempotency").doc(`${uid}_${requestId}`);
const workroomAutomationAuditRef = (uid, auditId) => db.collection("workroomAutomationAudit").doc(uid).collection("entries").doc(auditId);
const workroomAiRef = (uid) => db.collection("workroomAi").doc(uid);
const workroomAiHistoryRef = (uid, dateKey) => workroomAiRef(uid).collection("briefings").doc(dateKey);

const dashboardUrl = () => TRIATHLON_DASHBOARD_URL.value() || "https://savemhq.com/triathlon-tracker.html";
const workroomControlUrl = () => WORKROOM_CONTROL_URL.value() || "https://savemhq.com/workroom-control.html";

const briefingDateKey = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const briefingValue = (value) => {
  if (value == null) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.toMillis === "function") return new Date(value.toMillis()).toISOString();
  return value;
};

const briefingRecord = (snapshot) => ({
  id: snapshot.id,
  ...Object.fromEntries(Object.entries(snapshot.data() || {}).map(([key, value]) => [key, briefingValue(value)])),
});

const loadBriefingCollection = async (collectionRef, limit = 40) => {
  const snapshot = await collectionRef.limit(limit).get();
  return snapshot.docs.map(briefingRecord);
};

const loadWorkroomBriefingInput = async (uid) => {
  const [tasks, projects, financeReminders, contactFollowUps, achEntries, summarySnapshot] = await Promise.all([
    loadBriefingCollection(workroomTasksCollectionRef(uid), 60),
    loadBriefingCollection(workroomProjectsCollectionRef(uid), 30),
    loadBriefingCollection(workroomFinanceCollectionRef(uid), 30),
    loadBriefingCollection(workroomContactCollectionRef(uid), 30),
    loadBriefingCollection(workroomAchCollectionRef(uid), 30),
    workroomSummaryRef(uid).get(),
  ]);
  const summary = summarySnapshot.exists ? briefingRecord(summarySnapshot) : {};
  return {
    tasks: tasks.filter((task) => task.status !== "done"),
    projects: projects.filter((project) => project.status !== "complete"),
    financeReminders: financeReminders.filter((item) => item.status !== "done"),
    contactFollowUps: contactFollowUps.filter((item) => item.status !== "done"),
    achEntries,
    google: {
      upcomingEvents: Array.isArray(summary.upcomingEvents) ? summary.upcomingEvents.slice(0, 18) : [],
      recentMail: Array.isArray(summary.recentMail) ? summary.recentMail.slice(0, 12) : [],
      unreadCount: Number(summary.unreadCount || 0),
      lastSyncAt: summary.lastSyncAt || null,
      syncError: summary.syncError || "",
    },
  };
};

const generateWorkroomBriefing = async (uid) => {
  const input = await loadWorkroomBriefingInput(uid);
  const dateKey = briefingDateKey();
  const OpenAI = require("openai");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
  const response = await client.responses.create({
    model: OPENAI_MODEL.value(),
    instructions: "You are the private Workroom briefing assistant. Produce a concise, practical briefing in plain text with exactly these headings: DO TODAY, THIS WEEK, WAITING, WATCH. Use only the supplied facts. Do not invent dates, people, commitments, or task status. If a section has nothing relevant, write \"None noted.\" Keep the entire briefing under 1800 characters.",
    input: JSON.stringify(input),
    max_output_tokens: 700,
  });
  const text = String(response.output_text || "").trim();
  if (!text) throw new Error("OpenAI returned an empty briefing.");
  const metadata = {
    status: "ready",
    text: text.slice(0, 6000),
    dateKey,
    model: OPENAI_MODEL.value(),
    generatedAt: FieldValue.serverTimestamp(),
    sourceCounts: {
      tasks: input.tasks.length,
      projects: input.projects.length,
      financeReminders: input.financeReminders.length,
      contactFollowUps: input.contactFollowUps.length,
      achEntries: input.achEntries.length,
      calendarEvents: input.google.upcomingEvents.length,
      recentMail: input.google.recentMail.length,
    },
    googleLastSyncAt: input.google.lastSyncAt || null,
    googleSyncError: input.google.syncError || "",
    updatedAt: FieldValue.serverTimestamp(),
  };
  await Promise.all([
    workroomAiRef(uid).set(metadata, { merge: true }),
    workroomAiHistoryRef(uid, dateKey).set(metadata, { merge: true }),
  ]);
  return { ok: true, dateKey, text: metadata.text, sourceCounts: metadata.sourceCounts };
};

const requireAuth = (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in before using Strava sync.");
  }
  return request.auth;
};

const requireTriathlonManager = (auth) => {
  const email = String(auth.token.email || "").toLowerCase();
  if (email !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Only the triathlon tracker owner can manage Strava sync.");
  }
};

const requireWorkroomOwner = (auth) => {
  const email = String(auth.token.email || "").toLowerCase();
  if (email !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Only the Workroom owner can manage Google connections.");
  }
};

const WORKROOM_INGESTION_SOURCES = new Set(["voice", "slack", "gmail", "gpt", "manual", "api"]);
const WORKROOM_ACTION_OPERATIONS = new Set([
  "createTask",
  "createProject",
  "createFinanceReminder",
  "createContactFollowUp",
  "createAchEntry",
]);
const WORKROOM_ACTION_SOURCES = new Set(["chatgpt-action", "gpt", "manual", "api"]);
const WORKROOM_ACTION_DAILY_TOTAL_LIMIT = 40;
const WORKROOM_ACTION_DAILY_OPERATION_LIMITS = {
  createTask: 20,
  createProject: 5,
  createFinanceReminder: 8,
  createContactFollowUp: 8,
  createAchEntry: 5,
};
const WORKROOM_PROJECT_COLORS = new Set(["fern", "sky", "sun", "clay"]);
const WORKROOM_PRIORITY = new Set(["high", "medium", "low"]);
const WORKROOM_CONTACT_METHOD = new Set(["phone", "email"]);

const clean = (value) => String(value || "").trim();

const fail = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
};

const ensureString = (value, maxLength, field) => {
  const normalized = clean(value);
  if (!normalized) fail(400, "invalid_payload", `${field} is required.`);
  if (normalized.length > maxLength) fail(400, "invalid_payload", `${field} exceeds ${maxLength} characters.`);
  return normalized;
};

const optionalString = (value, maxLength, field) => {
  const normalized = clean(value);
  if (!normalized) return "";
  if (normalized.length > maxLength) fail(400, "invalid_payload", `${field} exceeds ${maxLength} characters.`);
  return normalized;
};

const ensureEnum = (value, set, fallback, field) => {
  const normalized = clean(value).toLowerCase();
  if (!normalized && fallback) return fallback;
  if (!set.has(normalized)) fail(400, "invalid_payload", `${field} must be one of: ${[...set].join(", ")}.`);
  return normalized;
};

const toTimestampOrNull = (value, field) => {
  if (value == null || value === "") return null;
  const normalized = clean(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T12:00:00`)
    : new Date(normalized);
  if (Number.isNaN(date.getTime())) fail(400, "invalid_payload", `${field} must be a valid date.`);
  return admin.firestore.Timestamp.fromDate(date);
};

const toRequiredTimestamp = (value, field) => {
  const stamp = toTimestampOrNull(value, field);
  if (!stamp) fail(400, "invalid_payload", `${field} is required.`);
  return stamp;
};

const toOptionalAmount = (value, field) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail(400, "invalid_payload", `${field} must be a valid number.`);
  return number;
};

const toRequiredAmount = (value, field) => {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(400, "invalid_payload", `${field} must be a valid number.`);
  if (number < 0) fail(400, "invalid_payload", `${field} must be zero or greater.`);
  return number;
};

const parseBoolean = (value, defaultValue = false) => {
  if (value == null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = clean(value).toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  fail(400, "invalid_payload", "recurring must be true or false.");
};

const createPayloadHash = (operation, payload) => crypto
  .createHash("sha256")
  .update(`${operation}:${JSON.stringify(payload || {})}`)
  .digest("hex");

const usageDateKey = () => new Date().toISOString().slice(0, 10);

const ensureWorkroomOwnerUid = async (uid) => {
  const user = await admin.auth().getUser(uid).catch(() => null);
  if (!user) fail(403, "permission_denied", "That uid is not allowed for Workroom automation.");
  const email = clean(user.email).toLowerCase();
  if (email !== ADMIN_EMAIL) fail(403, "permission_denied", "That uid is not allowed for Workroom automation.");
};

const normalizeActionSource = (value) => {
  const normalized = clean(value).toLowerCase();
  return WORKROOM_ACTION_SOURCES.has(normalized) ? normalized : "chatgpt-action";
};

const validateActionRequest = (body) => {
  const uid = ensureString(body?.uid, 128, "uid");
  const requestId = ensureString(body?.requestId, 120, "requestId");
  if (!/^[a-zA-Z0-9._:-]+$/.test(requestId)) {
    fail(400, "invalid_payload", "requestId contains unsupported characters.");
  }
  const operation = ensureString(body?.operation, 64, "operation");
  if (!WORKROOM_ACTION_OPERATIONS.has(operation)) {
    fail(400, "invalid_payload", `operation must be one of: ${[...WORKROOM_ACTION_OPERATIONS].join(", ")}.`);
  }
  const source = normalizeActionSource(body?.source);
  const payload = typeof body?.payload === "object" && body?.payload != null ? body.payload : null;
  if (!payload) fail(400, "invalid_payload", "payload is required.");
  return { uid, requestId, operation, source, payload };
};

const buildTaskDoc = ({ payload, source, requestId }) => {
  const title = ensureString(payload.title, 180, "title");
  const notes = optionalString(payload.notes, 1000, "notes");
  const projectId = optionalString(payload.projectId, 150, "projectId");
  const priority = ensureEnum(payload.priority, WORKROOM_PRIORITY, "medium", "priority");
  return {
    title,
    projectId,
    status: "next",
    priority,
    dueDate: toTimestampOrNull(payload.dueDate, "dueDate"),
    notes,
    source,
    ingestionHash: crypto.createHash("sha256").update(`gpt-action:${requestId}:${title.toLowerCase()}`).digest("hex"),
    completedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const buildProjectDoc = ({ payload }) => ({
  title: ensureString(payload.title, 120, "title"),
  status: "active",
  color: ensureEnum(payload.color, WORKROOM_PROJECT_COLORS, "fern", "color"),
  outcome: optionalString(payload.outcome, 600, "outcome"),
  targetDate: toTimestampOrNull(payload.targetDate, "targetDate"),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

const buildFinanceDoc = ({ payload }) => ({
  title: ensureString(payload.title, 160, "title"),
  category: optionalString(payload.category, 50, "category"),
  urgency: ensureEnum(payload.urgency, WORKROOM_PRIORITY, "medium", "urgency"),
  dueDate: toTimestampOrNull(payload.dueDate, "dueDate"),
  reference: optionalString(payload.reference, 160, "reference"),
  amount: toOptionalAmount(payload.amount, "amount"),
  status: "open",
  completedAt: null,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

const buildContactDoc = ({ payload }) => ({
  name: ensureString(payload.name, 120, "name"),
  followUpDate: toRequiredTimestamp(payload.followUpDate, "followUpDate"),
  reason: ensureString(payload.reason, 500, "reason"),
  method: ensureEnum(payload.method, WORKROOM_CONTACT_METHOD, "email", "method"),
  contactDetail: ensureString(payload.contactDetail, 160, "contactDetail"),
  status: "open",
  completedAt: null,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

const buildAchDoc = ({ payload }) => ({
  name: ensureString(payload.name, 120, "name"),
  amount: toRequiredAmount(payload.amount, "amount"),
  withdrawalDate: toRequiredTimestamp(payload.withdrawalDate, "withdrawalDate"),
  reason: ensureString(payload.reason, 500, "reason"),
  recurring: parseBoolean(payload.recurring, false),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

const WORKROOM_ACTION_BUILDERS = {
  createTask: { collection: workroomTasksCollectionRef, buildDoc: buildTaskDoc },
  createProject: { collection: workroomProjectsCollectionRef, buildDoc: buildProjectDoc },
  createFinanceReminder: { collection: workroomFinanceCollectionRef, buildDoc: buildFinanceDoc },
  createContactFollowUp: { collection: workroomContactCollectionRef, buildDoc: buildContactDoc },
  createAchEntry: { collection: workroomAchCollectionRef, buildDoc: buildAchDoc },
};

const executeWorkroomAction = async ({ uid, requestId, operation, source, payload }) => {
  const actionDefinition = WORKROOM_ACTION_BUILDERS[operation];
  if (!actionDefinition) fail(400, "invalid_payload", "Unsupported operation.");
  const dateKey = usageDateKey();
  const usageRef = workroomAutomationUsageRef(uid, dateKey);
  const idempotencyRef = workroomAutomationIdempotencyRef(uid, requestId);
  const payloadHash = createPayloadHash(operation, payload);
  const operationLimit = WORKROOM_ACTION_DAILY_OPERATION_LIMITS[operation] || WORKROOM_ACTION_DAILY_TOTAL_LIMIT;
  const now = FieldValue.serverTimestamp();

  return db.runTransaction(async (transaction) => {
    const [usageSnapshot, idempotencySnapshot] = await Promise.all([
      transaction.get(usageRef),
      transaction.get(idempotencyRef),
    ]);

    if (idempotencySnapshot.exists) {
      const existing = idempotencySnapshot.data() || {};
      return {
        replayed: true,
        operation,
        createdId: String(existing.createdId || ""),
        collectionPath: String(existing.collectionPath || ""),
        dateKey,
      };
    }

    const usage = usageSnapshot.data() || {};
    const totals = {
      total: Number(usage.total || 0),
      createTask: Number(usage.createTask || 0),
      createProject: Number(usage.createProject || 0),
      createFinanceReminder: Number(usage.createFinanceReminder || 0),
      createContactFollowUp: Number(usage.createContactFollowUp || 0),
      createAchEntry: Number(usage.createAchEntry || 0),
    };

    if (totals.total >= WORKROOM_ACTION_DAILY_TOTAL_LIMIT) {
      fail(429, "daily_limit_exceeded", "Daily Workroom automation limit reached.");
    }
    if (totals[operation] >= operationLimit) {
      fail(429, "operation_limit_exceeded", `Daily limit reached for ${operation}.`);
    }

    const targetCollection = actionDefinition.collection(uid);
    const targetRef = targetCollection.doc();
    const docData = actionDefinition.buildDoc({ payload, source, requestId });
    transaction.set(targetRef, docData);
    transaction.set(usageRef, {
      uid,
      dateKey,
      total: totals.total + 1,
      createTask: totals.createTask + (operation === "createTask" ? 1 : 0),
      createProject: totals.createProject + (operation === "createProject" ? 1 : 0),
      createFinanceReminder: totals.createFinanceReminder + (operation === "createFinanceReminder" ? 1 : 0),
      createContactFollowUp: totals.createContactFollowUp + (operation === "createContactFollowUp" ? 1 : 0),
      createAchEntry: totals.createAchEntry + (operation === "createAchEntry" ? 1 : 0),
      updatedAt: now,
    }, { merge: true });
    transaction.set(idempotencyRef, {
      uid,
      requestId,
      operation,
      source,
      payloadHash,
      createdId: targetRef.id,
      collectionPath: targetRef.path,
      dateKey,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });

    return {
      replayed: false,
      operation,
      createdId: targetRef.id,
      collectionPath: targetRef.path,
      dateKey,
    };
  });
};

const normalizeTaskTitle = (value) => clean(value).replace(/^[\-•\*\d\.)\s]+/, "").slice(0, 180);

const normalizeTaskInputText = (value) => String(value || "").replace(/\r\n/g, "\n").trim();

const inferPriority = (text) => {
  const value = text.toLowerCase();
  if (/(urgent|asap|today|critical|immediately|by eod|high priority)/.test(value)) return "high";
  if (/(someday|later|low priority|whenever|backlog)/.test(value)) return "low";
  return "medium";
};

const inferDueDate = (text) => {
  const value = text.toLowerCase();
  const now = new Date();
  const atNoon = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  if (/(\btoday\b|by eod|end of day)/.test(value)) return atNoon(now);
  if (/\btomorrow\b/.test(value)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return atNoon(tomorrow);
  }
  const inDays = value.match(/in\s+(\d{1,2})\s+days?/);
  if (inDays) {
    const target = new Date(now);
    target.setDate(now.getDate() + Number(inDays[1]));
    return atNoon(target);
  }
  const byDate = value.match(/\b(?:by|due)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (byDate) {
    const date = new Date(`${byDate[1]}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

const parseTaskCandidates = (text) => {
  const normalized = normalizeTaskInputText(text);
  if (!normalized) return [];
  const lines = normalized.split("\n").map((line) => clean(line)).filter(Boolean);
  const bulletLike = lines.filter((line) => /^([\-•\*]|\d+[\.)])\s+/.test(line));
  const units = bulletLike.length >= 2 ? bulletLike : lines;
  const tasks = [];
  for (const unit of units) {
    const title = normalizeTaskTitle(unit);
    if (!title) continue;
    tasks.push({
      title,
      notes: unit.slice(0, 1000),
      priority: inferPriority(unit),
      dueDate: inferDueDate(unit),
    });
  }
  return tasks.slice(0, 40);
};

const computeIngestionHash = ({ title, notes, source }) => crypto
  .createHash("sha256")
  .update(`${clean(source).toLowerCase()}::${clean(title).toLowerCase()}::${clean(notes).toLowerCase()}`)
  .digest("hex");

const createTasksFromAutomationText = async ({ uid, source, text }) => {
  const normalizedSource = WORKROOM_INGESTION_SOURCES.has(clean(source).toLowerCase()) ? clean(source).toLowerCase() : "manual";
  const candidates = parseTaskCandidates(text);
  if (!candidates.length) {
    return { createdCount: 0, skippedCount: 0 };
  }

  const collection = workroomTasksCollectionRef(uid);
  const hashes = candidates.map((candidate) => computeIngestionHash({ ...candidate, source: normalizedSource }));
  const existingHashMatches = await Promise.all(hashes.map((hash) => collection.where("ingestionHash", "==", hash).limit(1).get()));

  const now = FieldValue.serverTimestamp();
  let createdCount = 0;
  let skippedCount = 0;
  const batch = db.batch();
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const hash = hashes[index];
    if (!candidate.title) {
      skippedCount += 1;
      continue;
    }
    if (!existingHashMatches[index].empty) {
      skippedCount += 1;
      continue;
    }
    batch.set(collection.doc(), {
      title: candidate.title,
      projectId: "",
      status: "next",
      priority: candidate.priority,
      dueDate: candidate.dueDate ? admin.firestore.Timestamp.fromDate(candidate.dueDate) : null,
      notes: candidate.notes,
      source: normalizedSource,
      ingestionHash: hash,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    createdCount += 1;
  }
  if (createdCount) {
    await batch.commit();
  }
  return { createdCount, skippedCount };
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const message = json?.error_description || json?.message || json?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return json;
};

const tokenPayloadFromExchange = (payload, uid) => ({
  uid,
  athleteId: payload?.athlete?.id ? String(payload.athlete.id) : "",
  athleteName: [payload?.athlete?.firstname, payload?.athlete?.lastname].filter(Boolean).join(" ").trim(),
  accessToken: String(payload?.access_token || ""),
  refreshToken: String(payload?.refresh_token || ""),
  expiresAt: Number(payload?.expires_at || 0),
  scope: STRAVA_SCOPE,
  updatedAt: FieldValue.serverTimestamp(),
});

const writePublicStravaStatus = async ({ connected, tokenData = {}, status = "connected", error = "" } = {}) => publicStravaRef.set({
  connected: Boolean(connected),
  status,
  error,
  athleteId: String(tokenData.athleteId || ""),
  athleteName: String(tokenData.athleteName || ""),
  scope: String(tokenData.scope || STRAVA_SCOPE),
  tokenExpiresAt: tokenData.expiresAt || null,
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

const exchangeCodeForToken = async (code) => fetchJson("https://www.strava.com/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_id: STRAVA_CLIENT_ID.value(),
    client_secret: STRAVA_CLIENT_SECRET.value(),
    code,
    grant_type: "authorization_code",
  }),
});

const refreshAccessToken = async (tokenData) => {
  const payload = await fetchJson("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID.value(),
      client_secret: STRAVA_CLIENT_SECRET.value(),
      refresh_token: tokenData.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  return {
    ...tokenData,
    accessToken: String(payload.access_token || ""),
    refreshToken: String(payload.refresh_token || tokenData.refreshToken || ""),
    expiresAt: Number(payload.expires_at || 0),
    updatedAt: FieldValue.serverTimestamp(),
  };
};

const getFreshTokenData = async (uid) => {
  const snapshot = await tokenRef(uid).get();
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", "Strava is not connected yet.");
  }

  let tokenData = snapshot.data();
  const expiresAt = Number(tokenData.expiresAt || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAt <= nowSeconds + 120) {
    tokenData = await refreshAccessToken(tokenData);
    await tokenRef(uid).set(tokenData, { merge: true });
    await writePublicStravaStatus({ connected: true, tokenData, status: "connected" });
  }

  return tokenData;
};

const normalizeActivity = (activity) => ({
  seasonId: SEASON_ID,
  stravaId: String(activity.id),
  name: String(activity.name || "Strava activity"),
  sportType: String(activity.sport_type || activity.type || "Workout"),
  startDate: activity.start_date ? admin.firestore.Timestamp.fromDate(new Date(activity.start_date)) : null,
  startDateLocal: activity.start_date_local ? admin.firestore.Timestamp.fromDate(new Date(activity.start_date_local)) : null,
  timezone: String(activity.timezone || ""),
  distanceMeters: Number(activity.distance || 0),
  movingTimeSeconds: Number(activity.moving_time || 0),
  elapsedTimeSeconds: Number(activity.elapsed_time || 0),
  elevationGainMeters: Number(activity.total_elevation_gain || 0),
  averageSpeed: Number(activity.average_speed || 0),
  maxSpeed: Number(activity.max_speed || 0),
  trainer: Boolean(activity.trainer),
  commute: Boolean(activity.commute),
  private: Boolean(activity.private),
  sourceUrl: `https://www.strava.com/activities/${activity.id}`,
  source: "strava",
  syncedAt: FieldValue.serverTimestamp(),
});

const syncActivitiesForUid = async (uid) => {
  const tokenData = await getFreshTokenData(uid);
  const after = Math.floor((Date.now() - 120 * 86_400_000) / 1000);
  const activities = await fetchJson(`https://www.strava.com/api/v3/athlete/activities?per_page=100&after=${after}`, {
    headers: { authorization: `Bearer ${tokenData.accessToken}` },
  });
  const batch = db.batch();
  const normalizedActivities = Array.isArray(activities) ? activities.map(normalizeActivity) : [];

  normalizedActivities.forEach((activity) => {
    batch.set(activityRef(activity.stravaId), activity, { merge: true });
  });

  batch.set(publicStravaRef, {
    connected: true,
    status: "connected",
    error: "",
    athleteId: String(tokenData.athleteId || ""),
    athleteName: String(tokenData.athleteName || ""),
    scope: String(tokenData.scope || STRAVA_SCOPE),
    lastSyncAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  return normalizedActivities.length;
};

exports.createStravaAuthSession = onCall(async (request) => {
  const auth = requireAuth(request);
  requireTriathlonManager(auth);

  const state = crypto.randomBytes(24).toString("hex");
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000);
  await db.collection("triathlonOAuthStates").doc(state).set({
    uid: auth.uid,
    email: String(auth.token.email || ""),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    used: false,
  });

  const authorizeUrl = new URL("https://www.strava.com/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", STRAVA_CLIENT_ID.value());
  authorizeUrl.searchParams.set("redirect_uri", STRAVA_REDIRECT_URI.value());
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("approval_prompt", "auto");
  authorizeUrl.searchParams.set("scope", STRAVA_SCOPE);
  authorizeUrl.searchParams.set("state", state);

  return { authorizeUrl: authorizeUrl.toString() };
});

exports.handleStravaCallback = onRequest({ secrets: [STRAVA_CLIENT_SECRET] }, async (request, response) => {
  try {
    const code = String(request.query.code || "").trim();
    const state = String(request.query.state || "").trim();
    const error = String(request.query.error || "").trim();
    if (error) {
      response.redirect(`${dashboardUrl()}?strava=denied`);
      return;
    }
    if (!code || !state) {
      response.status(400).send("Missing Strava code or state.");
      return;
    }

    const stateRef = db.collection("triathlonOAuthStates").doc(state);
    const stateSnapshot = await stateRef.get();
    const stateData = stateSnapshot.data();
    if (!stateSnapshot.exists || stateData.used === true || stateData.expiresAt.toMillis() < Date.now()) {
      response.status(403).send("Invalid or expired Strava state.");
      return;
    }

    const payload = await exchangeCodeForToken(code);
    const tokenData = tokenPayloadFromExchange(payload, stateData.uid);
    await tokenRef(stateData.uid).set(tokenData, { merge: true });
    await writePublicStravaStatus({ connected: true, tokenData, status: "connected" });
    await stateRef.set({ used: true, usedAt: FieldValue.serverTimestamp() }, { merge: true });
    await syncActivitiesForUid(stateData.uid);

    response.redirect(`${dashboardUrl()}?strava=connected`);
  } catch (error) {
    await publicStravaRef.set({
      connected: false,
      status: "error",
      error: String(error.message || "Strava connection failed."),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => {});
    response.redirect(`${dashboardUrl()}?strava=error`);
  }
});

exports.syncStravaActivities = onCall({ secrets: [STRAVA_CLIENT_SECRET] }, async (request) => {
  const auth = requireAuth(request);
  requireTriathlonManager(auth);
  const syncedCount = await syncActivitiesForUid(auth.uid);
  return { syncedCount };
});

exports.disconnectStrava = onCall(async (request) => {
  const auth = requireAuth(request);
  requireTriathlonManager(auth);
  await tokenRef(auth.uid).delete();
  await publicStravaRef.set({
    connected: false,
    status: "disconnected",
    error: "",
    lastDisconnectedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { connected: false };
});

const googleTokenFromExchange = (payload, uid, connectionId, existing = {}) => ({
  uid,
  connectionId,
  accessToken: String(payload.access_token || ""),
  refreshToken: String(payload.refresh_token || existing.refreshToken || ""),
  expiresAt: Math.floor(Date.now() / 1000) + Number(payload.expires_in || 0),
  scope: String(payload.scope || GOOGLE_SCOPE),
  updatedAt: FieldValue.serverTimestamp(),
});

const exchangeGoogleCode = async (code) => fetchJson("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID.value(),
    client_secret: GOOGLE_CLIENT_SECRET.value(),
    redirect_uri: GOOGLE_REDIRECT_URI.value(),
    grant_type: "authorization_code",
  }).toString(),
});

const refreshGoogleToken = async (tokenData) => {
  const payload = await fetchJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID.value(),
      client_secret: GOOGLE_CLIENT_SECRET.value(),
      refresh_token: tokenData.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  return googleTokenFromExchange(payload, tokenData.uid, tokenData.connectionId, tokenData);
};

const getFreshGoogleToken = async (uid, connectionId) => {
  const snapshot = await workroomSecretRef(uid, connectionId).get();
  if (!snapshot.exists) {
    throw new HttpsError("failed-precondition", "This Google account is not connected.");
  }
  let tokenData = snapshot.data();
  if (!tokenData.refreshToken) {
    throw new HttpsError("failed-precondition", "Reconnect Google to allow background sync.");
  }
  if (Number(tokenData.expiresAt || 0) <= Math.floor(Date.now() / 1000) + 120) {
    tokenData = await refreshGoogleToken(tokenData);
    await workroomSecretRef(uid, connectionId).set(tokenData, { merge: true });
  }
  return tokenData;
};

const googleApi = (path, tokenData) => fetchJson(`https://www.googleapis.com${path}`, {
  headers: { authorization: `Bearer ${tokenData.accessToken}` },
});

const safeHeader = (headers, name) => String((headers || []).find((header) => String(header.name).toLowerCase() === name)?.value || "").trim();

const formatGoogleEvent = (event, calendarId, connectionId) => ({
  id: `${connectionId}:${calendarId}:${event.id}`,
  title: String(event.summary || "Busy"),
  location: String(event.location || ""),
  start: event.start?.dateTime ? admin.firestore.Timestamp.fromDate(new Date(event.start.dateTime)) : null,
  end: event.end?.dateTime ? admin.firestore.Timestamp.fromDate(new Date(event.end.dateTime)) : null,
  allDay: Boolean(event.start?.date && !event.start?.dateTime),
  date: String(event.start?.date || ""),
  connectionId,
});

const syncGoogleConnection = async (uid, connectionId, connectionData) => {
  const tokenData = await getFreshGoogleToken(uid, connectionId);
  const selectedCalendars = Array.isArray(connectionData.selectedCalendars) && connectionData.selectedCalendars.length
    ? connectionData.selectedCalendars.slice(0, 12)
    : ["primary"];
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const calendarEvents = (await Promise.all(selectedCalendars.map(async (calendarId) => {
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: windowEnd.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "24",
    });
    const payload = await googleApi(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`, tokenData);
    return (payload.items || []).map((event) => formatGoogleEvent(event, calendarId, connectionId));
  }))).flat();
  const mailList = await googleApi("/gmail/v1/users/me/messages?labelIds=INBOX&labelIds=UNREAD&maxResults=8", tokenData);
  const recentMail = (await Promise.all((mailList.messages || []).slice(0, 8).map(async ({ id }) => {
    const message = await googleApi(`/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, tokenData);
    return {
      id: `${connectionId}:${message.id}`,
      from: safeHeader(message.payload?.headers, "from"),
      subject: safeHeader(message.payload?.headers, "subject") || "(No subject)",
      receivedAt: message.internalDate ? admin.firestore.Timestamp.fromMillis(Number(message.internalDate)) : null,
      connectionId,
    };
  }))).filter(Boolean);
  return {
    calendarEvents,
    recentMail,
    unreadCount: Number(mailList.resultSizeEstimate || recentMail.length),
  };
};

const syncWorkroomGoogle = async (uid) => {
  const connections = await db.collection("workroomConnections").doc(uid).collection("connections").where("status", "==", "connected").get();
  const output = { events: [], mail: [], unreadCount: 0, errors: [] };
  for (const connection of connections.docs) {
    try {
      const synced = await syncGoogleConnection(uid, connection.id, connection.data());
      output.events.push(...synced.calendarEvents);
      output.mail.push(...synced.recentMail);
      output.unreadCount += synced.unreadCount;
      await connection.ref.set({ lastSyncAt: FieldValue.serverTimestamp(), error: "", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    } catch (error) {
      output.errors.push("A connected Google account needs attention.");
      await connection.ref.set({ error: String(error.message || "Google sync failed."), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  output.events.sort((left, right) => (left.start?.toMillis?.() || Number.MAX_SAFE_INTEGER) - (right.start?.toMillis?.() || Number.MAX_SAFE_INTEGER));
  output.mail.sort((left, right) => (right.receivedAt?.toMillis?.() || 0) - (left.receivedAt?.toMillis?.() || 0));
  await workroomSummaryRef(uid).set({
    upcomingEvents: output.events.slice(0, 18),
    recentMail: output.mail.slice(0, 12),
    unreadCount: output.unreadCount,
    syncError: output.errors[0] || "",
    lastSyncAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { eventCount: output.events.length, mailCount: output.mail.length, errorCount: output.errors.length };
};

exports.createWorkroomGoogleAuthSession = onCall(async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  const state = crypto.randomBytes(24).toString("hex");
  const connectionId = crypto.randomBytes(12).toString("hex");
  await db.collection("workroomOAuthStates").doc(state).set({
    uid: auth.uid,
    email: String(auth.token.email || ""),
    connectionId,
    used: false,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
    createdAt: FieldValue.serverTimestamp(),
  });
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID.value());
  authorizeUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI.value());
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GOOGLE_SCOPE);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("include_granted_scopes", "true");
  authorizeUrl.searchParams.set("state", state);
  return { authorizeUrl: authorizeUrl.toString() };
});

exports.handleWorkroomGoogleCallback = onRequest({ secrets: [GOOGLE_CLIENT_SECRET] }, async (request, response) => {
  const state = String(request.query.state || "").trim();
  let stateData = null;
  try {
    const code = String(request.query.code || "").trim();
    const oauthError = String(request.query.error || "").trim();
    if (oauthError || !code || !state) {
      console.warn("Workroom Google OAuth callback was denied or incomplete.", {
        hasCode: Boolean(code),
        hasState: Boolean(state),
        oauthError: oauthError || "none",
      });
      const reason = oauthError || "missing_parameters";
      response.redirect(`${workroomControlUrl()}?google=denied&reason=${encodeURIComponent(reason)}`);
      return;
    }
    const stateRef = db.collection("workroomOAuthStates").doc(state);
    const stateSnapshot = await stateRef.get();
    stateData = stateSnapshot.data();
    if (!stateSnapshot.exists || stateData.used || stateData.expiresAt.toMillis() < Date.now()) {
      response.status(403).send("Invalid or expired Google connection state.");
      return;
    }
    const payload = await exchangeGoogleCode(code);
    const tokenData = googleTokenFromExchange(payload, stateData.uid, stateData.connectionId);
    await workroomSecretRef(stateData.uid, stateData.connectionId).set(tokenData, { merge: true });
    await workroomConnectionRef(stateData.uid, stateData.connectionId).set({
      status: "connected",
      selectedCalendars: ["primary"],
      connectedAt: FieldValue.serverTimestamp(),
      lastSyncAt: null,
      error: "",
      updatedAt: FieldValue.serverTimestamp(),
    });
    await stateRef.set({ used: true, usedAt: FieldValue.serverTimestamp() }, { merge: true });
    await syncWorkroomGoogle(stateData.uid);
    response.redirect(`${workroomControlUrl()}?google=connected`);
  } catch (error) {
    console.error("Workroom Google OAuth callback failed.", {
      message: String(error?.message || "Unknown error"),
      statePresent: Boolean(state),
    });
    if (stateData?.uid && stateData?.connectionId) {
      await workroomConnectionRef(stateData.uid, stateData.connectionId).set({
        status: "error",
        selectedCalendars: [],
        error: String(error?.message || "Google connection failed.").slice(0, 240),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }
    const reason = String(error?.message || "connection_failed").slice(0, 120);
    response.redirect(`${workroomControlUrl()}?google=error&reason=${encodeURIComponent(reason)}`);
  }
});

exports.listWorkroomGoogleCalendars = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  const connectionId = String(request.data?.connectionId || "").trim();
  if (!connectionId) throw new HttpsError("invalid-argument", "Choose a Google connection.");
  const tokenData = await getFreshGoogleToken(auth.uid, connectionId);
  const payload = await googleApi("/calendar/v3/users/me/calendarList?minAccessRole=reader", tokenData);
  return { calendars: (payload.items || []).slice(0, 50).map((calendar) => ({ id: String(calendar.id), summary: String(calendar.summary || "Calendar"), primary: calendar.primary === true })) };
});

exports.setWorkroomGoogleCalendars = onCall(async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  const connectionId = String(request.data?.connectionId || "").trim();
  const calendarIds = [...new Set((Array.isArray(request.data?.calendarIds) ? request.data.calendarIds : []).map(String).map((id) => id.trim()).filter(Boolean))].slice(0, 12);
  if (!connectionId || !calendarIds.length) throw new HttpsError("invalid-argument", "Select at least one calendar.");
  await workroomConnectionRef(auth.uid, connectionId).set({ selectedCalendars: calendarIds, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return syncWorkroomGoogle(auth.uid);
});

exports.syncWorkroomGoogle = onCall({ secrets: [GOOGLE_CLIENT_SECRET] }, async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  return syncWorkroomGoogle(auth.uid);
});

exports.disconnectWorkroomGoogle = onCall(async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  const connectionId = String(request.data?.connectionId || "").trim();
  if (!connectionId) throw new HttpsError("invalid-argument", "Choose a Google connection.");
  await workroomSecretRef(auth.uid, connectionId).delete();
  await workroomConnectionRef(auth.uid, connectionId).delete();
  return syncWorkroomGoogle(auth.uid);
});

exports.scheduledWorkroomGoogleSync = onSchedule({ schedule: "every 10 minutes", secrets: [GOOGLE_CLIENT_SECRET] }, async () => {
  const connections = await db.collectionGroup("connections").where("status", "==", "connected").get();
  const ownerUids = [...new Set(connections.docs.map((connection) => connection.ref.parent.parent?.id).filter(Boolean))];
  await Promise.all(ownerUids.map((uid) => syncWorkroomGoogle(uid)));
});

exports.generateWorkroomBriefing = onCall({ secrets: [OPENAI_API_KEY] }, async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  return generateWorkroomBriefing(auth.uid);
});

exports.scheduledWorkroomBriefing = onSchedule({
  schedule: "30 7 * * 1-5",
  timeZone: "America/Chicago",
  secrets: [OPENAI_API_KEY],
}, async () => {
  await generateWorkroomBriefing("RHkEW2ABlqYmwBqeEE0JX40zNND3");
});

exports.parseWorkroomAutomationText = onCall(async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  const source = clean(request.data?.source || "manual");
  const text = normalizeTaskInputText(request.data?.text || "");
  if (!text) {
    throw new HttpsError("invalid-argument", "Provide text to parse into tasks.");
  }
  return createTasksFromAutomationText({ uid: auth.uid, source, text });
});

exports.ingestWorkroomAutomation = onRequest({ secrets: [WORKROOM_AUTOMATION_KEY] }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const headerKey = clean(request.get("x-workroom-key"));
  const configuredKey = clean(WORKROOM_AUTOMATION_KEY.value());
  if (!configuredKey || headerKey !== configuredKey) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  const uid = clean(request.body?.uid);
  const source = clean(request.body?.source || "api");
  const text = normalizeTaskInputText(request.body?.text || "");
  if (!uid || !text) {
    response.status(400).json({ error: "missing_uid_or_text" });
    return;
  }

  try {
    const result = await createTasksFromAutomationText({ uid, source, text });
    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    response.status(500).json({ error: "ingestion_failed", message: String(error?.message || "Unknown error") });
  }
});

exports.executeWorkroomAction = onRequest({ secrets: [WORKROOM_AUTOMATION_KEY] }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const headerKey = clean(request.get("x-workroom-key"));
  const configuredKey = clean(WORKROOM_AUTOMATION_KEY.value());
  if (!configuredKey || headerKey !== configuredKey) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }

  let action = null;
  let auditId = "";
  try {
    action = validateActionRequest(request.body || {});
    await ensureWorkroomOwnerUid(action.uid);
    auditId = crypto.randomBytes(12).toString("hex");
    const payloadHash = createPayloadHash(action.operation, action.payload);
    const auditRef = workroomAutomationAuditRef(action.uid, auditId);
    await auditRef.set({
      uid: action.uid,
      requestId: action.requestId,
      operation: action.operation,
      source: action.source,
      payloadHash,
      status: "received",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const result = await executeWorkroomAction(action);
    await auditRef.set({
      status: result.replayed ? "replayed" : "completed",
      createdId: result.createdId,
      collectionPath: result.collectionPath,
      replayed: result.replayed,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    response.status(200).json({ ok: true, auditId, ...result });
  } catch (error) {
    const status = Number(error?.status || 500);
    const code = clean(error?.code || "action_execution_failed");
    const message = clean(error?.message || "Unable to execute Workroom action.");
    if (action?.uid && auditId) {
      await workroomAutomationAuditRef(action.uid, auditId).set({
        status: "rejected",
        errorCode: code,
        errorMessage: message.slice(0, 240),
        failedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }
    response.status(status).json({ ok: false, error: code, message, auditId: auditId || null });
  }
});

exports.getWorkroomAutomationStatus = onCall(async (request) => {
  const auth = requireAuth(request);
  requireWorkroomOwner(auth);
  const uid = auth.uid;
  const dateKey = usageDateKey();
  const usageSnapshot = await workroomAutomationUsageRef(uid, dateKey).get();
  const usage = usageSnapshot.data() || {};
  const counts = {
    total: Number(usage.total || 0),
    createTask: Number(usage.createTask || 0),
    createProject: Number(usage.createProject || 0),
    createFinanceReminder: Number(usage.createFinanceReminder || 0),
    createContactFollowUp: Number(usage.createContactFollowUp || 0),
    createAchEntry: Number(usage.createAchEntry || 0),
  };

  const recentSnapshot = await db.collection("workroomAutomationAudit")
    .doc(uid)
    .collection("entries")
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();

  const recent = recentSnapshot.docs.map((item) => {
    const data = item.data() || {};
    return {
      id: item.id,
      requestId: String(data.requestId || ""),
      operation: String(data.operation || ""),
      source: String(data.source || ""),
      status: String(data.status || ""),
      createdId: String(data.createdId || ""),
      errorCode: String(data.errorCode || ""),
      errorMessage: String(data.errorMessage || ""),
      createdAt: data.createdAt || null,
      completedAt: data.completedAt || null,
      failedAt: data.failedAt || null,
    };
  });

  return {
    dateKey,
    limits: {
      total: WORKROOM_ACTION_DAILY_TOTAL_LIMIT,
      createTask: WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createTask,
      createProject: WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createProject,
      createFinanceReminder: WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createFinanceReminder,
      createContactFollowUp: WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createContactFollowUp,
      createAchEntry: WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createAchEntry,
    },
    counts,
    remaining: {
      total: Math.max(0, WORKROOM_ACTION_DAILY_TOTAL_LIMIT - counts.total),
      createTask: Math.max(0, WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createTask - counts.createTask),
      createProject: Math.max(0, WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createProject - counts.createProject),
      createFinanceReminder: Math.max(0, WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createFinanceReminder - counts.createFinanceReminder),
      createContactFollowUp: Math.max(0, WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createContactFollowUp - counts.createContactFollowUp),
      createAchEntry: Math.max(0, WORKROOM_ACTION_DAILY_OPERATION_LIMITS.createAchEntry - counts.createAchEntry),
    },
    recent,
  };
});