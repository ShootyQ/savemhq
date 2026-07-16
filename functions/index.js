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

const dashboardUrl = () => TRIATHLON_DASHBOARD_URL.value() || "https://savemhq.com/triathlon-tracker.html";
const workroomControlUrl = () => WORKROOM_CONTROL_URL.value() || "https://savemhq.com/workroom-control.html";

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