import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { app, db, hasSectionAccess } from "./auth-shared.js";

const SEASON_ID = "2026-andrew-august-22";
const RACE_DATE = new Date("2026-08-22T07:00:00-04:00");
const STORAGE_ROOT = `triathlon/${SEASON_ID}`;
const COMPRESSIBLE_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const IMAGE_PREP_TIMEOUT_MS = 8000;
const IMAGE_UPLOAD_TIMEOUT_MS = 45000;
const DAILY_WORKOUT_TARGET = 3;
const DAILY_WORKOUT_MINUTES = 45;
const DAILY_WATER_TARGET_GALLONS = 1;
const DAILY_PAGES_TARGET = 10;
const DAILY_SUGAR_TARGET_GRAMS = 10;
const storage = getStorage(app);
const functions = getFunctions(app);
const createStravaAuthSession = httpsCallable(functions, "createStravaAuthSession");
const syncStravaActivities = httpsCallable(functions, "syncStravaActivities");
const disconnectStrava = httpsCallable(functions, "disconnectStrava");

const seasonDocument = doc(db, "triathlonSeasons", SEASON_ID);
const weightEntriesCollection = collection(seasonDocument, "weightEntries");
const checkinsCollection = collection(seasonDocument, "checkins");
const photosCollection = collection(seasonDocument, "progressPhotos");
const activitiesCollection = collection(seasonDocument, "stravaActivities");
const stravaStatusDocument = doc(seasonDocument, "integrations", "stravaPublic");

const defaultState = {
  user: null,
  isAdmin: false,
  approvalStatus: "signed-out",
  approvalSections: [],
  userEmail: "",
  canView: false,
  canManage: false,
  weights: [],
  checkins: [],
  photos: [],
  activities: [],
  stravaStatus: null,
  stravaNotice: "",
  photoFilter: "all",
  selectedProgressDate: "",
  unsubscribers: [],
};

let state = { ...defaultState };

const $ = (id) => document.getElementById(id);

const elements = {
  countdown: $("triathlon-countdown"),
  authStatus: $("triathlon-auth-status"),
  locked: $("triathlon-locked"),
  lockedMessage: $("triathlon-locked-message"),
  app: $("triathlon-app"),
  privateSections: [...document.querySelectorAll(".triathlon-private-section")],
  currentWeight: $("triathlon-current-weight"),
  weightChange: $("triathlon-weight-change"),
  goalGap: $("triathlon-goal-gap"),
  latestCheckin: $("triathlon-latest-checkin"),
  progressDate: $("triathlon-progress-date"),
  progressScore: $("triathlon-progress-score"),
  progressWorkouts: $("triathlon-progress-workouts"),
  progressHydration: $("triathlon-progress-hydration"),
  progressNutrition: $("triathlon-progress-nutrition"),
  progressPhoto: $("triathlon-progress-photo"),
  progressGrid: $("triathlon-progress-grid"),
  progressWorkoutList: $("triathlon-progress-workout-list"),
  weightForm: $("triathlon-weight-form"),
  weightValue: $("triathlon-weight-value"),
  weightTime: $("triathlon-weight-time"),
  weightNote: $("triathlon-weight-note"),
  weightSubmit: $("triathlon-weight-submit"),
  weightStatus: $("triathlon-weight-status"),
  weightChart: $("triathlon-weight-chart"),
  weightList: $("triathlon-weight-list"),
  checkinForm: $("triathlon-checkin-form"),
  checkinDate: $("triathlon-checkin-date"),
  sleepHours: $("triathlon-sleep-hours"),
  waist: $("triathlon-waist"),
  energy: $("triathlon-energy"),
  waterGallons: $("triathlon-water-gallons"),
  pagesRead: $("triathlon-pages-read"),
  mealsEaten: $("triathlon-meals-eaten"),
  sugarGrams: $("triathlon-sugar-grams"),
  nutrition: $("triathlon-nutrition"),
  recovery: $("triathlon-recovery"),
  checkinNotes: $("triathlon-checkin-notes"),
  checkinSubmit: $("triathlon-checkin-submit"),
  checkinStatus: $("triathlon-checkin-status"),
  checkinList: $("triathlon-checkin-list"),
  photoForm: $("triathlon-photo-form"),
  photoType: $("triathlon-photo-type"),
  photoTime: $("triathlon-photo-time"),
  photoCaption: $("triathlon-photo-caption"),
  photoFile: $("triathlon-photo-file"),
  photoSubmit: $("triathlon-photo-submit"),
  photoStatus: $("triathlon-photo-status"),
  photoGallery: $("triathlon-photo-gallery"),
  photoProgression: $("triathlon-photo-progression"),
  photoFilters: [...document.querySelectorAll(".triathlon-photo-filter")],
  stravaPill: $("triathlon-strava-pill"),
  stravaStatus: $("triathlon-strava-status"),
  stravaConnect: $("triathlon-strava-connect"),
  stravaSync: $("triathlon-strava-sync"),
  stravaDisconnect: $("triathlon-strava-disconnect"),
  weekRun: $("triathlon-week-run"),
  weekBike: $("triathlon-week-bike"),
  weekSwim: $("triathlon-week-swim"),
  activityList: $("triathlon-activity-list"),
};

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

const toDate = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === "function") {
    return value.toDate();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDateTime = (value) => {
  const date = toDate(value);
  if (!date) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatDateOnly = (value) => {
  const date = toDate(value);
  if (!date) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const formatDateInput = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateKeyForValue = (value) => {
  const date = toDate(value);
  return date ? formatDateInput(date) : "";
};

const formatDateTimeInput = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const parseLocalInputDate = (value) => {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const signedInLabel = () => String(state.user?.displayName || state.user?.email || "Approved user").trim();

const setText = (element, value) => {
  if (element) {
    element.textContent = value;
  }
};

const setDisabled = (elementsToToggle, disabled) => {
  elementsToToggle.forEach((element) => {
    if (element) {
      element.disabled = disabled;
    }
  });
};

const updateCountdown = () => {
  const now = new Date();
  const diff = RACE_DATE.getTime() - now.getTime();
  const days = Math.max(0, Math.ceil(diff / 86_400_000));
  setText(elements.countdown, `${days} day${days === 1 ? "" : "s"}`);
};

const mapSnapshot = (snapshot, normalizer) => snapshot.docs.map((docSnapshot) => normalizer(docSnapshot.id, docSnapshot.data()));

const normalizeWeightEntry = (id, data) => ({
  id,
  weight: Number(data?.weight || 0),
  unit: String(data?.unit || "lb"),
  measuredAt: data?.measuredAt || null,
  note: String(data?.note || "").trim(),
  createdByUid: String(data?.createdByUid || ""),
});

const normalizeCheckin = (id, data) => ({
  id,
  dateKey: String(data?.dateKey || ""),
  sleepHours: data?.sleepHours == null ? null : Number(data.sleepHours),
  waist: data?.waist == null ? null : Number(data.waist),
  energy: String(data?.energy || ""),
  manualWorkoutCount: data?.manualWorkoutCount == null ? 0 : Number(data.manualWorkoutCount),
  waterComplete: data?.waterComplete === true,
  pagesComplete: data?.pagesComplete === true,
  mealComplete: data?.mealComplete === true,
  sugarComplete: data?.sugarComplete === true,
  waterGallons: data?.waterGallons == null ? null : Number(data.waterGallons),
  pagesRead: data?.pagesRead == null ? null : Number(data.pagesRead),
  mealsEaten: data?.mealsEaten == null ? null : Number(data.mealsEaten),
  sugarGrams: data?.sugarGrams == null ? null : Number(data.sugarGrams),
  nutrition: String(data?.nutrition || "").trim(),
  recovery: String(data?.recovery || "").trim(),
  notes: String(data?.notes || "").trim(),
  createdByUid: String(data?.createdByUid || ""),
  createdAt: data?.createdAt || null,
});

const normalizePhoto = (id, data) => ({
  id,
  photoType: String(data?.photoType || "progress").toLowerCase(),
  photoUrl: String(data?.photoUrl || ""),
  photoPath: String(data?.photoPath || ""),
  caption: String(data?.caption || "").trim(),
  takenAt: data?.takenAt || null,
  uploadedByUid: String(data?.uploadedByUid || ""),
  uploadedByLabel: String(data?.uploadedByLabel || ""),
});

const normalizeActivity = (id, data) => ({
  id,
  name: String(data?.name || "Activity"),
  sportType: String(data?.sportType || data?.type || "Workout"),
  startDate: data?.startDate || null,
  startDateLocal: data?.startDateLocal || null,
  distanceMeters: Number(data?.distanceMeters || 0),
  movingTimeSeconds: Number(data?.movingTimeSeconds || 0),
  elevationGainMeters: Number(data?.elevationGainMeters || 0),
  sourceUrl: String(data?.sourceUrl || ""),
});

const canDeleteRecord = (record) => state.canManage || String(record?.createdByUid || record?.uploadedByUid || "") === state.user?.uid;

const formatMaybeNumber = (value, digits = 1) => Number.isFinite(value) ? Number(value).toFixed(digits) : "--";

const consumeStravaCallbackStatus = () => {
  const url = new URL(window.location.href);
  const status = String(url.searchParams.get("strava") || "").trim().toLowerCase();
  if (!status) {
    return;
  }

  state.stravaNotice = {
    connected: "Strava connected. You can sync activities now.",
    denied: "Strava connection was canceled.",
    error: "Strava connection failed. Check the Functions logs and app settings.",
  }[status] || "";

  url.searchParams.delete("strava");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
};

const getSelectedProgressDate = () => state.selectedProgressDate || formatDateInput();

const getCheckinForDate = (dateKey) => state.checkins
  .filter((entry) => entry.dateKey === dateKey)
  .sort((left, right) => (toDate(right.createdAt)?.getTime() || 0) - (toDate(left.createdAt)?.getTime() || 0))[0] || null;

const baseCheckinPayload = (dateKey, existing = null) => ({
  seasonId: SEASON_ID,
  dateKey,
  sleepHours: existing?.sleepHours ?? null,
  waist: existing?.waist ?? null,
  energy: existing?.energy ?? "",
  manualWorkoutCount: Number.isFinite(existing?.manualWorkoutCount) ? Math.max(0, Math.round(existing.manualWorkoutCount)) : 0,
  waterComplete: existing?.waterComplete === true,
  pagesComplete: existing?.pagesComplete === true,
  mealComplete: existing?.mealComplete === true,
  sugarComplete: existing?.sugarComplete === true,
  waterGallons: existing?.waterGallons ?? null,
  pagesRead: existing?.pagesRead ?? null,
  mealsEaten: existing?.mealsEaten ?? null,
  sugarGrams: existing?.sugarGrams ?? null,
  nutrition: existing?.nutrition ?? "",
  recovery: existing?.recovery ?? "",
  notes: existing?.notes ?? "",
  createdByUid: String(existing?.createdByUid || state.user?.uid || ""),
  createdByLabel: String(existing?.createdByLabel || signedInLabel()),
  createdAt: existing?.createdAt || serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const saveCheckinForDate = async (dateKey, patch = {}) => {
  const targetDateKey = String(dateKey || "").trim();
  if (!targetDateKey) {
    throw new Error("missing-date");
  }

  const existing = getCheckinForDate(targetDateKey);
  const payload = {
    ...baseCheckinPayload(targetDateKey, existing),
    ...patch,
    seasonId: SEASON_ID,
    dateKey: targetDateKey,
    createdByUid: String(existing?.createdByUid || state.user?.uid || ""),
    createdByLabel: String(existing?.createdByLabel || signedInLabel()),
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(checkinsCollection, targetDateKey), payload, { merge: true });
  state.selectedProgressDate = targetDateKey;
  if (elements.progressDate) {
    elements.progressDate.value = targetDateKey;
  }
  if (elements.checkinDate) {
    elements.checkinDate.value = targetDateKey;
  }
};

const getProgressSummary = (dateKey = getSelectedProgressDate()) => {
  const targetDateKey = String(dateKey || formatDateInput()).trim();
  const checkin = getCheckinForDate(targetDateKey);
  const activities = state.activities
    .filter((activity) => dateKeyForValue(activity.startDateLocal || activity.startDate) === targetDateKey)
    .sort((left, right) => (toDate(right.startDateLocal || right.startDate)?.getTime() || 0) - (toDate(left.startDateLocal || left.startDate)?.getTime() || 0));
  const qualifyingWorkouts = activities.filter((activity) => Number(activity.movingTimeSeconds || 0) >= DAILY_WORKOUT_MINUTES * 60);
  const progressPhotos = state.photos.filter((photo) => photo.photoType === "progress" && dateKeyForValue(photo.takenAt) === targetDateKey);
  const manualWorkoutCount = Math.max(0, Math.min(DAILY_WORKOUT_TARGET, Math.round(Number(checkin?.manualWorkoutCount || 0))));
  const totalWorkoutCount = Math.max(qualifyingWorkouts.length, manualWorkoutCount);
  const waterDone = checkin?.waterComplete === true || Number(checkin?.waterGallons) >= DAILY_WATER_TARGET_GALLONS;
  const pagesDone = checkin?.pagesComplete === true || Number(checkin?.pagesRead) >= DAILY_PAGES_TARGET;
  const mealDone = checkin?.mealComplete === true || Number(checkin?.mealsEaten) === 1;
  const sugarDone = checkin?.sugarComplete === true || (Number.isFinite(checkin?.sugarGrams) && Number(checkin.sugarGrams) < DAILY_SUGAR_TARGET_GRAMS);

  const items = [
    {
      key: "workouts",
      label: "45 minute workouts",
      value: `${totalWorkoutCount}/${DAILY_WORKOUT_TARGET}`,
      note: qualifyingWorkouts.length
        ? `Strava ${qualifyingWorkouts.length}/${DAILY_WORKOUT_TARGET}${manualWorkoutCount ? ` · manual ${manualWorkoutCount}` : ""}`
        : (manualWorkoutCount ? `Manual ${manualWorkoutCount}/${DAILY_WORKOUT_TARGET}` : "Needs synced workouts or quick logs"),
      complete: totalWorkoutCount >= DAILY_WORKOUT_TARGET,
    },
    {
      key: "water",
      label: "Water",
      value: waterDone ? "Checked off" : (checkin?.waterGallons == null ? "--" : `${formatMaybeNumber(checkin.waterGallons, 2)} gal`),
      note: `Target ${DAILY_WATER_TARGET_GALLONS} gallon`,
      complete: waterDone,
    },
    {
      key: "pages",
      label: "Read 10 pages",
      value: pagesDone ? "Checked off" : (checkin?.pagesRead == null ? "--" : `${Math.round(checkin.pagesRead)} pages`),
      note: `Target ${DAILY_PAGES_TARGET} pages`,
      complete: pagesDone,
    },
    {
      key: "meal",
      label: "One meal",
      value: mealDone ? "Checked off" : (checkin?.mealsEaten == null ? "--" : `${Math.round(checkin.mealsEaten)} meal${Math.round(checkin.mealsEaten) === 1 ? "" : "s"}`),
      note: "Fasting target",
      complete: mealDone,
    },
    {
      key: "sugar",
      label: "Sugar under 10g",
      value: sugarDone ? "Checked off" : (checkin?.sugarGrams == null ? "--" : `${formatMaybeNumber(checkin.sugarGrams, 1)} g`),
      note: `Stay under ${DAILY_SUGAR_TARGET_GRAMS} g`,
      complete: sugarDone,
    },
    {
      key: "photo",
      label: "Progress photo",
      value: progressPhotos.length ? `${progressPhotos.length} logged` : "Open",
      note: progressPhotos[0] ? formatDateTime(progressPhotos[0].takenAt) : "Upload a progress photo",
      complete: progressPhotos.length > 0,
    },
  ];

  return {
    dateKey: targetDateKey,
    checkin,
    activities,
    qualifyingWorkouts,
    manualWorkoutCount,
    totalWorkoutCount,
    progressPhotos,
    items,
    completedCount: items.filter((item) => item.complete).length,
  };
};

const renderAccessState = () => {
  if (!elements.app || !elements.locked) {
    return;
  }

  elements.app.classList.toggle("hidden", !state.canView);
  elements.locked.classList.toggle("hidden", state.canView);
  elements.privateSections.forEach((section) => section.classList.toggle("hidden", !state.canView));

  if (!state.user) {
    setText(elements.authStatus, "Sign in with Google to request or use triathlon access.");
    setText(elements.lockedMessage, "Use Google Login above. Approved triathlon users can view this dashboard.");
    return;
  }

  if (!state.canView) {
    setText(elements.authStatus, "Signed in, but triathlon access is not enabled for this account yet.");
    setText(elements.lockedMessage, "This account is signed in but does not have triathlon access yet. Andy can grant it from Admin.");
    return;
  }

  setText(elements.authStatus, state.canManage ? "Full tracker controls are available." : "Viewing the approved triathlon dashboard.");
};

const renderWeightSummary = () => {
  const sortedWeights = [...state.weights].sort((a, b) => (toDate(a.measuredAt)?.getTime() || 0) - (toDate(b.measuredAt)?.getTime() || 0));
  const first = sortedWeights[0];
  const latest = sortedWeights[sortedWeights.length - 1];
  const dailySummary = getProgressSummary();

  setText(elements.progressScore, `${dailySummary.completedCount}/${dailySummary.items.length}`);

  if (!latest) {
    setText(elements.currentWeight, "--");
    setText(elements.weightChange, "--");
    setText(elements.goalGap, "Set goal");
    return;
  }

  setText(elements.currentWeight, `${latest.weight.toFixed(1)} ${latest.unit}`);
  const change = first ? latest.weight - first.weight : 0;
  setText(elements.weightChange, `${change >= 0 ? "+" : ""}${change.toFixed(1)} ${latest.unit}`);
  setText(elements.goalGap, "Goal ready");
};

const renderWeightChart = () => {
  if (!elements.weightChart) {
    return;
  }

  const sortedWeights = [...state.weights]
    .filter((entry) => entry.weight > 0 && toDate(entry.measuredAt))
    .sort((a, b) => toDate(a.measuredAt).getTime() - toDate(b.measuredAt).getTime());

  if (sortedWeights.length < 2) {
    elements.weightChart.innerHTML = `<p class="small-note">Add at least two weigh-ins to draw the trend.</p>`;
    return;
  }

  const values = sortedWeights.map((entry) => entry.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const width = 520;
  const height = 180;
  const padding = 18;
  const points = sortedWeights.map((entry, index) => {
    const x = padding + (index / Math.max(1, sortedWeights.length - 1)) * (width - padding * 2);
    const y = height - padding - ((entry.weight - min) / range) * (height - padding * 2);
    return { x, y, entry };
  });
  const pointString = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  elements.weightChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weight trend chart">
      <line class="triathlon-chart-grid" x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}"></line>
      <line class="triathlon-chart-grid" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
      <polyline class="triathlon-chart-line" points="${pointString}"></polyline>
      ${points.map((point) => `
        <circle class="triathlon-chart-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4">
          <title>${escapeHtml(`${point.entry.weight.toFixed(1)} ${point.entry.unit} on ${formatDateTime(point.entry.measuredAt)}`)}</title>
        </circle>
      `).join("")}
    </svg>
    <div class="triathlon-chart-labels">
      <span>${min.toFixed(1)} lb</span>
      <span>${max.toFixed(1)} lb</span>
    </div>
  `;
};

const renderWeightList = () => {
  if (!elements.weightList) {
    return;
  }

  if (!state.weights.length) {
    elements.weightList.innerHTML = `<p class="small-note">No weigh-ins yet.</p>`;
    return;
  }

  elements.weightList.innerHTML = state.weights.slice(0, 8).map((entry) => `
    <article class="triathlon-log-item">
      <div>
        <strong>${entry.weight.toFixed(1)} ${escapeHtml(entry.unit)}</strong>
        <p class="small-note">${formatDateTime(entry.measuredAt)}${entry.note ? ` · ${escapeHtml(entry.note)}` : ""}</p>
      </div>
      ${canDeleteRecord(entry) ? `<button class="btn btn-secondary triathlon-delete-weight" type="button" data-id="${escapeHtml(entry.id)}">Delete</button>` : ""}
    </article>
  `).join("");
};

const renderCheckins = () => {
  const latest = state.checkins[0];
  setText(elements.latestCheckin, latest ? latest.dateKey : "--");

  if (!elements.checkinList) {
    return;
  }

  if (!state.checkins.length) {
    elements.checkinList.innerHTML = `<p class="small-note">No check-ins yet.</p>`;
    return;
  }

  elements.checkinList.innerHTML = state.checkins.slice(0, 6).map((entry) => {
    const dailySummary = getProgressSummary(entry.dateKey);
    return `
      <article class="triathlon-log-item triathlon-log-item-stacked">
        <div>
          <strong>${escapeHtml(entry.dateKey)}</strong>
          <p class="small-note">${[
            entry.sleepHours == null ? "" : `${entry.sleepHours}h sleep`,
            entry.waist == null ? "" : `${entry.waist.toFixed(1)} in waist`,
            entry.energy ? `Energy: ${entry.energy}` : "",
          ].filter(Boolean).join(" · ") || "Daily check-in"}</p>
          <div class="triathlon-inline-progress">
            <span class="status-chip ${dailySummary.completedCount >= 5 ? "is-live" : ""}">${dailySummary.completedCount}/${dailySummary.items.length} complete</span>
            <span class="small-note">Water ${entry.waterComplete ? "done" : (entry.waterGallons == null ? "--" : `${formatMaybeNumber(entry.waterGallons, 2)} gal`)} · Read ${entry.pagesComplete ? "done" : (entry.pagesRead == null ? "--" : `${Math.round(entry.pagesRead)} pages`)} · Meal ${entry.mealComplete ? "done" : (entry.mealsEaten == null ? "--" : Math.round(entry.mealsEaten))} · Sugar ${entry.sugarComplete ? "done" : (entry.sugarGrams == null ? "--" : `${formatMaybeNumber(entry.sugarGrams, 1)} g`)} · Workouts ${dailySummary.totalWorkoutCount}/${DAILY_WORKOUT_TARGET} · Photo ${dailySummary.progressPhotos.length ? "yes" : "no"}</span>
          </div>
          ${entry.nutrition ? `<p><strong>Nutrition:</strong> ${escapeHtml(entry.nutrition)}</p>` : ""}
          ${entry.recovery ? `<p><strong>Recovery:</strong> ${escapeHtml(entry.recovery)}</p>` : ""}
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : ""}
        </div>
        ${canDeleteRecord(entry) ? `<button class="btn btn-secondary triathlon-delete-checkin" type="button" data-id="${escapeHtml(entry.id)}">Delete</button>` : ""}
      </article>
    `;
  }).join("");
};

const renderDailyProgress = () => {
  if (!elements.progressGrid || !elements.progressWorkoutList) {
    return;
  }

  const selectedDate = state.selectedProgressDate || state.checkins[0]?.dateKey || formatDateInput();
  state.selectedProgressDate = selectedDate;
  if (elements.progressDate && elements.progressDate.value !== selectedDate) {
    elements.progressDate.value = selectedDate;
  }

  const dailySummary = getProgressSummary(selectedDate);
  setText(elements.progressWorkouts, `${dailySummary.totalWorkoutCount}/${DAILY_WORKOUT_TARGET}`);
  setText(elements.progressHydration, `${dailySummary.checkin?.waterComplete ? "done" : (dailySummary.checkin?.waterGallons == null ? "--" : `${formatMaybeNumber(dailySummary.checkin.waterGallons, 2)} gal`)} / ${dailySummary.checkin?.pagesComplete ? "done" : (dailySummary.checkin?.pagesRead == null ? "--" : `${Math.round(dailySummary.checkin.pagesRead)} p`)}`);
  setText(elements.progressNutrition, `${dailySummary.checkin?.mealComplete ? "done" : (dailySummary.checkin?.mealsEaten == null ? "--" : `${Math.round(dailySummary.checkin.mealsEaten)} meal`)} / ${dailySummary.checkin?.sugarComplete ? "done" : (dailySummary.checkin?.sugarGrams == null ? "--" : `${formatMaybeNumber(dailySummary.checkin.sugarGrams, 1)} g`)}`);
  setText(elements.progressPhoto, dailySummary.progressPhotos.length ? `${dailySummary.progressPhotos.length} logged` : "Open");

  elements.progressGrid.innerHTML = dailySummary.items.map((item) => `
    <article class="triathlon-progress-card ${item.complete ? "is-complete" : ""}">
      <span class="status-chip ${item.complete ? "is-live" : ""}">${item.complete ? "Done" : "Open"}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <div class="triathlon-progress-value">${escapeHtml(item.value)}</div>
      <p class="small-note">${escapeHtml(item.note)}</p>
      ${state.canManage ? `
        <div class="triathlon-progress-actions">
          ${item.key === "workouts" ? `
            <button class="btn btn-secondary triathlon-quick-action" type="button" data-action="workout-dec">-1</button>
            <button class="btn btn-primary triathlon-quick-action" type="button" data-action="workout-inc">+1 workout</button>
          ` : item.key === "photo" ? `
            <a class="btn btn-secondary" href="#triathlon-photos">Upload photo</a>
          ` : `
            <button class="btn ${item.complete ? "btn-secondary" : "btn-primary"} triathlon-quick-action" type="button" data-action="${item.key}-toggle">${item.complete ? "Undo" : "Check off"}</button>
          `}
        </div>
      ` : ""}
    </article>
  `).join("");

  if (!dailySummary.activities.length) {
    elements.progressWorkoutList.innerHTML = `<p class="small-note">No Strava workouts synced for ${escapeHtml(dailySummary.dateKey)} yet.</p>`;
    return;
  }

  elements.progressWorkoutList.innerHTML = dailySummary.activities.map((activity) => {
    const qualifies = Number(activity.movingTimeSeconds || 0) >= DAILY_WORKOUT_MINUTES * 60;
    return `
      <article class="triathlon-log-item">
        <div>
          <strong>${escapeHtml(activity.name)}</strong>
          <p class="small-note">${escapeHtml(activity.sportType)} · ${activityDuration(activity)} · ${formatDateTime(activity.startDateLocal || activity.startDate)}${qualifies ? " · Counts toward the goal" : ""}</p>
        </div>
        ${activity.sourceUrl ? `<a class="btn btn-secondary" href="${escapeHtml(activity.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}
      </article>
    `;
  }).join("");
};

const renderPhotos = () => {
  if (!elements.photoGallery || !elements.photoProgression) {
    return;
  }

  const visiblePhotos = state.photos.filter((photo) => state.photoFilter === "all" || photo.photoType === state.photoFilter);
  const progressPhotos = [...state.photos]
    .filter((photo) => photo.photoType === "progress")
    .sort((left, right) => (toDate(left.takenAt)?.getTime() || 0) - (toDate(right.takenAt)?.getTime() || 0));
  elements.photoFilters.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === state.photoFilter);
  });

  elements.photoProgression.innerHTML = progressPhotos.length
    ? progressPhotos.slice(-8).map((photo) => `
      <article class="triathlon-photo-progression-card">
        <img src="${escapeHtml(photo.photoUrl)}" alt="${escapeHtml(photo.caption || `Progress photo from ${formatDateOnly(photo.takenAt)}`)}" loading="lazy" />
        <strong>${formatDateOnly(photo.takenAt)}</strong>
      </article>
    `).join("")
    : `<p class="small-note">Upload progress photos and they will line up here in order.</p>`;

  if (!visiblePhotos.length) {
    elements.photoGallery.innerHTML = `<p class="small-note">No ${state.photoFilter === "all" ? "" : `${state.photoFilter} `}photos yet.</p>`;
    return;
  }

  elements.photoGallery.innerHTML = visiblePhotos.map((photo) => `
    <article class="triathlon-photo-card">
      <img src="${escapeHtml(photo.photoUrl)}" alt="${escapeHtml(photo.caption || `${photo.photoType} photo`)}" loading="lazy" />
      <div>
        <span class="status-chip">${escapeHtml(photo.photoType)}</span>
        <strong>${formatDateOnly(photo.takenAt)}</strong>
        ${photo.caption ? `<p>${escapeHtml(photo.caption)}</p>` : ""}
        <p class="small-note">Uploaded by ${escapeHtml(photo.uploadedByLabel || "an approved user")}</p>
      </div>
      ${canDeleteRecord(photo) ? `<button class="btn btn-secondary triathlon-delete-photo" type="button" data-id="${escapeHtml(photo.id)}">Delete</button>` : ""}
    </article>
  `).join("");
};

const activityDistance = (activity) => {
  const miles = activity.distanceMeters / 1609.344;
  return miles > 0 ? `${miles.toFixed(2)} mi` : "--";
};

const activityDuration = (activity) => {
  const minutes = Math.round(activity.movingTimeSeconds / 60);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "--";
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
};

const renderActivities = () => {
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const totals = state.activities.reduce((accumulator, activity) => {
    const startDate = toDate(activity.startDate);
    if (!startDate || startDate < weekStart) {
      return accumulator;
    }

    const sport = activity.sportType.toLowerCase();
    const miles = activity.distanceMeters / 1609.344;
    if (sport.includes("run")) {
      accumulator.run += miles;
    } else if (sport.includes("ride") || sport.includes("bike")) {
      accumulator.bike += miles;
    } else if (sport.includes("swim")) {
      accumulator.swim += miles;
    }
    return accumulator;
  }, { run: 0, bike: 0, swim: 0 });

  setText(elements.weekRun, totals.run ? `${totals.run.toFixed(1)} mi` : "--");
  setText(elements.weekBike, totals.bike ? `${totals.bike.toFixed(1)} mi` : "--");
  setText(elements.weekSwim, totals.swim ? `${totals.swim.toFixed(2)} mi` : "--");

  if (!elements.activityList) {
    return;
  }

  if (!state.activities.length) {
    elements.activityList.innerHTML = `<p class="small-note">No Strava activities synced yet.</p>`;
    return;
  }

  elements.activityList.innerHTML = state.activities.slice(0, 10).map((activity) => `
    <article class="triathlon-log-item">
      <div>
        <strong>${escapeHtml(activity.name)}</strong>
        <p class="small-note">${escapeHtml(activity.sportType)} · ${activityDistance(activity)} · ${activityDuration(activity)} · ${formatDateTime(activity.startDate)}</p>
      </div>
      ${activity.sourceUrl ? `<a class="btn btn-secondary" href="${escapeHtml(activity.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : ""}
    </article>
  `).join("");
};

const renderStrava = () => {
  const status = state.stravaStatus || {};
  const connected = status.connected === true;
  setText(elements.stravaPill, connected ? "Connected" : "Not connected");
  elements.stravaPill?.classList.toggle("is-live", connected);
  if (state.stravaNotice) {
    setText(elements.stravaStatus, state.stravaNotice);
    return;
  }

  setText(
    elements.stravaStatus,
    connected
      ? `Connected${status.lastSyncAt ? ` · Last sync ${formatDateTime(status.lastSyncAt)}` : ""}.`
      : "Strava OAuth is ready for the Firebase Functions layer. Manual tracking works now."
  );
};

const renderAll = () => {
  renderAccessState();
  renderWeightSummary();
  renderWeightChart();
  renderWeightList();
  renderCheckins();
  renderDailyProgress();
  renderPhotos();
  renderActivities();
  renderStrava();
};

const clearSubscriptions = () => {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe?.());
  state.unsubscribers = [];
};

const subscribeToDashboard = () => {
  clearSubscriptions();

  if (!state.canView) {
    state.weights = [];
    state.checkins = [];
    state.photos = [];
    state.activities = [];
    state.stravaStatus = null;
    renderAll();
    return;
  }

  state.unsubscribers = [
    onSnapshot(query(weightEntriesCollection, orderBy("measuredAt", "desc"), limit(120)), (snapshot) => {
      state.weights = mapSnapshot(snapshot, normalizeWeightEntry);
      renderAll();
    }, (error) => setText(elements.weightStatus, `Weight history failed to load (${error.code || "unknown"}).`)),
    onSnapshot(query(checkinsCollection, orderBy("dateKey", "desc"), limit(60)), (snapshot) => {
      state.checkins = mapSnapshot(snapshot, normalizeCheckin);
      renderAll();
    }, (error) => setText(elements.checkinStatus, `Check-ins failed to load (${error.code || "unknown"}).`)),
    onSnapshot(query(photosCollection, orderBy("takenAt", "desc"), limit(120)), (snapshot) => {
      state.photos = mapSnapshot(snapshot, normalizePhoto);
      renderAll();
    }, (error) => setText(elements.photoStatus, `Photos failed to load (${error.code || "unknown"}).`)),
    onSnapshot(query(activitiesCollection, orderBy("startDate", "desc"), limit(80)), (snapshot) => {
      state.activities = mapSnapshot(snapshot, normalizeActivity);
      renderAll();
    }, () => renderActivities()),
    onSnapshot(stravaStatusDocument, (snapshot) => {
      state.stravaStatus = snapshot.exists() ? snapshot.data() : null;
      renderStrava();
    }, () => renderStrava()),
  ];
};

const ensureCanManage = () => {
  if (!state.canManage) {
    throw new Error("triathlon-manager-required");
  }
};

const submitWeight = async (event) => {
  event.preventDefault();
  try {
    ensureCanManage();
    setDisabled([elements.weightSubmit], true);
    setText(elements.weightStatus, "Saving weigh-in...");
    const weight = Number(elements.weightValue.value);
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error("invalid-weight");
    }

    await addDoc(weightEntriesCollection, {
      seasonId: SEASON_ID,
      weight,
      unit: "lb",
      measuredAt: parseLocalInputDate(elements.weightTime.value),
      note: String(elements.weightNote.value || "").trim(),
      createdByUid: state.user.uid,
      createdByLabel: signedInLabel(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    elements.weightForm.reset();
    elements.weightTime.value = formatDateTimeInput();
    setText(elements.weightStatus, "Weigh-in saved.");
  } catch (error) {
    setText(elements.weightStatus, `Could not save weigh-in (${error.message || error.code || "unknown"}).`);
  } finally {
    setDisabled([elements.weightSubmit], false);
  }
};

const submitCheckin = async (event) => {
  event.preventDefault();
  try {
    ensureCanManage();
    setDisabled([elements.checkinSubmit], true);
    setText(elements.checkinStatus, "Saving check-in...");
    const dateKey = String(elements.checkinDate.value || "").trim();
    if (!dateKey) {
      throw new Error("missing-date");
    }

    const sleepHours = elements.sleepHours.value ? Number(elements.sleepHours.value) : null;
    const waist = elements.waist.value ? Number(elements.waist.value) : null;
    const waterGallons = elements.waterGallons.value ? Number(elements.waterGallons.value) : null;
    const pagesRead = elements.pagesRead.value ? Number(elements.pagesRead.value) : null;
    const mealsEaten = elements.mealsEaten.value ? Number(elements.mealsEaten.value) : null;
    const sugarGrams = elements.sugarGrams.value ? Number(elements.sugarGrams.value) : null;
    await saveCheckinForDate(dateKey, {
      sleepHours: Number.isFinite(sleepHours) ? sleepHours : null,
      waist: Number.isFinite(waist) ? waist : null,
      energy: String(elements.energy.value || "").trim(),
      waterGallons: Number.isFinite(waterGallons) ? waterGallons : null,
      pagesRead: Number.isFinite(pagesRead) ? pagesRead : null,
      mealsEaten: Number.isFinite(mealsEaten) ? mealsEaten : null,
      sugarGrams: Number.isFinite(sugarGrams) ? sugarGrams : null,
      waterComplete: Number.isFinite(waterGallons) ? waterGallons >= DAILY_WATER_TARGET_GALLONS : undefined,
      pagesComplete: Number.isFinite(pagesRead) ? pagesRead >= DAILY_PAGES_TARGET : undefined,
      mealComplete: Number.isFinite(mealsEaten) ? mealsEaten === 1 : undefined,
      sugarComplete: Number.isFinite(sugarGrams) ? sugarGrams < DAILY_SUGAR_TARGET_GRAMS : undefined,
      nutrition: String(elements.nutrition.value || "").trim(),
      recovery: String(elements.recovery.value || "").trim(),
      notes: String(elements.checkinNotes.value || "").trim(),
    });

    elements.checkinForm.reset();
    elements.checkinDate.value = formatDateInput();
    state.selectedProgressDate = dateKey;
    if (elements.progressDate) {
      elements.progressDate.value = dateKey;
    }
    setText(elements.checkinStatus, "Check-in saved.");
  } catch (error) {
    setText(elements.checkinStatus, `Could not save check-in (${error.message || error.code || "unknown"}).`);
  } finally {
    setDisabled([elements.checkinSubmit], false);
  }
};

const handleQuickProgressAction = async (action) => {
  ensureCanManage();
  const selectedDate = getSelectedProgressDate();
  const summary = getProgressSummary(selectedDate);
  const existing = summary.checkin;
  const patches = {
    "workout-inc": { manualWorkoutCount: Math.min(DAILY_WORKOUT_TARGET, summary.manualWorkoutCount + 1) },
    "workout-dec": { manualWorkoutCount: Math.max(0, summary.manualWorkoutCount - 1) },
    "water-toggle": { waterComplete: !(existing?.waterComplete === true) },
    "pages-toggle": { pagesComplete: !(existing?.pagesComplete === true) },
    "meal-toggle": { mealComplete: !(existing?.mealComplete === true) },
    "sugar-toggle": { sugarComplete: !(existing?.sugarComplete === true) },
  };
  const patch = patches[action];
  if (!patch) {
    return;
  }

  setText(elements.checkinStatus, "Saving quick checkoff...");
  await saveCheckinForDate(selectedDate, patch);
  setText(elements.checkinStatus, "Daily progress updated.");
};

const sanitizeStorageFileName = (value = "") => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9.-]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-+|-+$/g, "") || "triathlon-photo";

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  const timeoutId = window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("image-load-timeout"));
  }, IMAGE_PREP_TIMEOUT_MS);

  image.onload = () => {
    window.clearTimeout(timeoutId);
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };
  image.onerror = () => {
    window.clearTimeout(timeoutId);
    URL.revokeObjectURL(objectUrl);
    reject(new Error("image-load-failed"));
  };
  image.src = objectUrl;
});

const prepareTriathlonImage = async (file) => {
  if (!(file instanceof Blob)) {
    throw new Error("missing-photo-file");
  }

  const mimeType = String(file.type || "").toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new Error("invalid-photo-file-type");
  }

  if (!COMPRESSIBLE_IMAGE_TYPES.has(mimeType)) {
    return file;
  }

  let image;
  try {
    image = await loadImageFromFile(file);
  } catch {
    return file;
  }

  const maxDimension = 1600;
  const longestSide = Math.max(image.naturalWidth || image.width || 0, image.naturalHeight || image.height || 0);
  if (longestSide <= maxDimension && file.size <= 1_500_000 && ["image/jpeg", "image/webp"].includes(mimeType)) {
    return file;
  }

  const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
  const width = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(file), IMAGE_PREP_TIMEOUT_MS);
    canvas.toBlob((blob) => {
      window.clearTimeout(timeoutId);
      resolve(blob || file);
    }, "image/jpeg", 0.82);
  });
};

const uploadBlob = ({ storageReference, file, onProgress } = {}) => new Promise((resolve, reject) => {
  const uploadTask = uploadBytesResumable(storageReference, file, {
    contentType: String(file?.type || "image/jpeg").toLowerCase() || "image/jpeg",
    cacheControl: "public,max-age=3600",
  });
  const timeoutId = window.setTimeout(() => {
    uploadTask.cancel();
    reject(new Error("storage-upload-timeout"));
  }, IMAGE_UPLOAD_TIMEOUT_MS);

  uploadTask.on(
    "state_changed",
    (snapshot) => {
      if (Number.isFinite(snapshot.totalBytes) && snapshot.totalBytes > 0) {
        onProgress?.(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
      }
    },
    (error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    },
    async () => {
      window.clearTimeout(timeoutId);
      try {
        resolve(await getDownloadURL(uploadTask.snapshot.ref));
      } catch (error) {
        reject(error);
      }
    }
  );
});

const submitPhoto = async (event) => {
  event.preventDefault();
  let photoPath = "";
  try {
    ensureCanManage();
    setDisabled([elements.photoSubmit], true);
    const file = elements.photoFile.files?.[0];
    if (!file) {
      throw new Error("missing-photo-file");
    }

    const photoType = String(elements.photoType.value || "progress").toLowerCase() === "training" ? "training" : "progress";
    setText(elements.photoStatus, "Preparing photo...");
    const preparedFile = await prepareTriathlonImage(file);
    const extension = preparedFile.type === "image/png" ? "png" : "jpg";
    photoPath = `${STORAGE_ROOT}/${photoType}/${Date.now()}-${sanitizeStorageFileName(file.name)}.${extension}`;
    setText(elements.photoStatus, "Uploading photo...");
    const photoUrl = await uploadBlob({
      storageReference: ref(storage, photoPath),
      file: preparedFile,
      onProgress: (progress) => setText(elements.photoStatus, `Uploading photo... ${progress}%`),
    });

    setText(elements.photoStatus, "Saving photo...");
    await addDoc(photosCollection, {
      seasonId: SEASON_ID,
      photoType,
      photoUrl,
      photoPath,
      caption: String(elements.photoCaption.value || "").trim(),
      takenAt: parseLocalInputDate(elements.photoTime.value),
      uploadedByUid: state.user.uid,
      uploadedByLabel: signedInLabel(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    elements.photoForm.reset();
    elements.photoType.value = photoType;
    elements.photoTime.value = formatDateTimeInput();
    setText(elements.photoStatus, "Photo uploaded.");
  } catch (error) {
    if (photoPath) {
      deleteObject(ref(storage, photoPath)).catch(() => {});
    }
    setText(elements.photoStatus, `Could not upload photo (${error.message || error.code || "unknown"}).`);
  } finally {
    setDisabled([elements.photoSubmit], false);
  }
};

const deleteWeight = async (id) => {
  if (!state.canManage) {
    return;
  }
  await deleteDoc(doc(weightEntriesCollection, id));
};

const deleteCheckin = async (id) => {
  if (!state.canManage) {
    return;
  }
  await deleteDoc(doc(checkinsCollection, id));
};

const deletePhoto = async (id) => {
  const photo = state.photos.find((entry) => entry.id === id);
  if (!photo || !canDeleteRecord(photo)) {
    return;
  }

  if (photo.photoPath) {
    await deleteObject(ref(storage, photo.photoPath)).catch((error) => {
      if (error?.code !== "storage/object-not-found") {
        throw error;
      }
    });
  }
  await deleteDoc(doc(photosCollection, id));
};

const connectStrava = async () => {
  try {
    ensureCanManage();
    setDisabled([elements.stravaConnect, elements.stravaSync, elements.stravaDisconnect], true);
    setText(elements.stravaStatus, "Opening Strava connection...");
    const result = await createStravaAuthSession();
    const authorizeUrl = String(result?.data?.authorizeUrl || "");
    if (!authorizeUrl) {
      throw new Error("missing-authorize-url");
    }
    window.location.assign(authorizeUrl);
  } catch (error) {
    setText(elements.stravaStatus, `Could not start Strava OAuth (${error.message || error.code || "unknown"}).`);
    setDisabled([elements.stravaConnect, elements.stravaSync, elements.stravaDisconnect], false);
  }
};

const syncStrava = async () => {
  try {
    ensureCanManage();
    setDisabled([elements.stravaConnect, elements.stravaSync, elements.stravaDisconnect], true);
    setText(elements.stravaStatus, "Syncing Strava activities...");
    const result = await syncStravaActivities();
    const syncedCount = Number(result?.data?.syncedCount || 0);
    setText(elements.stravaStatus, `Strava sync complete. ${syncedCount} activities checked.`);
  } catch (error) {
    setText(elements.stravaStatus, `Could not sync Strava (${error.message || error.code || "unknown"}).`);
  } finally {
    setDisabled([elements.stravaConnect, elements.stravaSync, elements.stravaDisconnect], false);
  }
};

const disconnectStravaIntegration = async () => {
  try {
    ensureCanManage();
    setDisabled([elements.stravaConnect, elements.stravaSync, elements.stravaDisconnect], true);
    setText(elements.stravaStatus, "Disconnecting Strava...");
    await disconnectStrava();
    setText(elements.stravaStatus, "Strava disconnected.");
  } catch (error) {
    setText(elements.stravaStatus, `Could not disconnect Strava (${error.message || error.code || "unknown"}).`);
  } finally {
    setDisabled([elements.stravaConnect, elements.stravaSync, elements.stravaDisconnect], false);
  }
};

const bindEvents = () => {
  elements.weightForm?.addEventListener("submit", submitWeight);
  elements.checkinForm?.addEventListener("submit", submitCheckin);
  elements.photoForm?.addEventListener("submit", submitPhoto);

  elements.weightList?.addEventListener("click", (event) => {
    const button = event.target.closest(".triathlon-delete-weight");
    if (button?.dataset.id) {
      deleteWeight(button.dataset.id).catch((error) => setText(elements.weightStatus, `Could not delete weigh-in (${error.code || "unknown"}).`));
    }
  });

  elements.checkinList?.addEventListener("click", (event) => {
    const button = event.target.closest(".triathlon-delete-checkin");
    if (button?.dataset.id) {
      deleteCheckin(button.dataset.id).catch((error) => setText(elements.checkinStatus, `Could not delete check-in (${error.code || "unknown"}).`));
    }
  });

  elements.photoGallery?.addEventListener("click", (event) => {
    const button = event.target.closest(".triathlon-delete-photo");
    if (button?.dataset.id) {
      deletePhoto(button.dataset.id).catch((error) => setText(elements.photoStatus, `Could not delete photo (${error.code || "unknown"}).`));
    }
  });

  elements.photoFilters.forEach((button) => {
    button.addEventListener("click", () => {
      state.photoFilter = button.dataset.filter || "all";
      renderPhotos();
    });
  });

  elements.progressGrid?.addEventListener("click", (event) => {
    const button = event.target.closest(".triathlon-quick-action");
    if (!button?.dataset.action) {
      return;
    }

    handleQuickProgressAction(button.dataset.action).catch((error) => {
      setText(elements.checkinStatus, `Could not update daily progress (${error.message || error.code || "unknown"}).`);
    });
  });

  elements.progressDate?.addEventListener("change", () => {
    state.selectedProgressDate = String(elements.progressDate.value || "").trim() || formatDateInput();
    renderDailyProgress();
    renderWeightSummary();
  });

  elements.stravaConnect?.addEventListener("click", connectStrava);
  elements.stravaSync?.addEventListener("click", syncStrava);
  elements.stravaDisconnect?.addEventListener("click", disconnectStravaIntegration);
};

const setInitialInputs = () => {
  if (elements.weightTime) {
    elements.weightTime.value = formatDateTimeInput();
  }
  if (elements.photoTime) {
    elements.photoTime.value = formatDateTimeInput();
  }
  if (elements.checkinDate) {
    elements.checkinDate.value = formatDateInput();
  }
  if (elements.progressDate) {
    elements.progressDate.value = formatDateInput();
    state.selectedProgressDate = elements.progressDate.value;
  }
};

const applyManageState = () => {
  setDisabled([
    elements.weightValue,
    elements.weightTime,
    elements.weightNote,
    elements.weightSubmit,
    elements.checkinDate,
    elements.sleepHours,
    elements.waist,
    elements.energy,
    elements.waterGallons,
    elements.pagesRead,
    elements.mealsEaten,
    elements.sugarGrams,
    elements.nutrition,
    elements.recovery,
    elements.checkinNotes,
    elements.checkinSubmit,
    elements.photoType,
    elements.photoTime,
    elements.photoCaption,
    elements.photoFile,
    elements.photoSubmit,
    elements.stravaConnect,
    elements.stravaSync,
    elements.stravaDisconnect,
  ], !state.canManage);
};

export const initTriathlonTracker = ({ initHeaderAuth } = {}) => {
  updateCountdown();
  consumeStravaCallbackStatus();
  setInitialInputs();
  bindEvents();
  applyManageState();
  renderAll();

  initHeaderAuth?.({
    signedOutText: "Signed out.",
    onStateChange: ({ user, isAdmin = false, approvalStatus = "signed-out", approvalSections = [] } = {}) => {
      const userEmail = String(user?.email || "").toLowerCase();
      const canView = hasSectionAccess({
        isAdmin,
        approvalStatus,
        approvalSections,
        userEmail,
      }, "triathlon");
      state = {
        ...state,
        user,
        isAdmin,
        approvalStatus,
        approvalSections,
        userEmail,
        canView,
        canManage: Boolean(isAdmin),
      };
      applyManageState();
      subscribeToDashboard();
    },
  });
};