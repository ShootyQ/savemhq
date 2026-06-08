const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { defineSecret, defineString } = require("firebase-functions/params");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const STRAVA_CLIENT_ID = defineString("STRAVA_CLIENT_ID");
const STRAVA_REDIRECT_URI = defineString("STRAVA_REDIRECT_URI");
const TRIATHLON_DASHBOARD_URL = defineString("TRIATHLON_DASHBOARD_URL");
const STRAVA_CLIENT_SECRET = defineSecret("STRAVA_CLIENT_SECRET");

const ADMIN_EMAIL = "andrewpcarlson85@gmail.com";
const SEASON_ID = "2026-andrew-august-22";
const STRAVA_SCOPE = "read,activity:read_all";

const seasonRef = db.collection("triathlonSeasons").doc(SEASON_ID);
const publicStravaRef = seasonRef.collection("integrations").doc("stravaPublic");
const activityRef = (activityId) => seasonRef.collection("stravaActivities").doc(String(activityId));
const tokenRef = (uid) => db.collection("triathlonSecrets").doc(`${uid}_strava`);

const dashboardUrl = () => TRIATHLON_DASHBOARD_URL.value() || "https://savemhq.com/triathlon-tracker.html";

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
    const message = json?.message || json?.error || text || `HTTP ${response.status}`;
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