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
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db, getKnownUserProfile, getPersonFromEmail } from "./auth-shared.js";

export const ROAD_TRIP_ID = "carlsons-insane-road-trip-2026";
export const ROAD_TRIP_TITLE = "Carlsons Insane Road Trip";

export const ROAD_TRIP_ROUTE_POINTS = [
  { name: "Minneapolis", lat: 44.9778, lng: -93.265, leg: "Minneapolis to Nashville", stop: true },
  { name: "Des Moines", lat: 41.5868, lng: -93.625, leg: "Minneapolis to Nashville", stop: false },
  { name: "St. Louis", lat: 38.627, lng: -90.1994, leg: "Minneapolis to Nashville", stop: false },
  { name: "Nashville", lat: 36.1627, lng: -86.7816, leg: "Minneapolis to Nashville", stop: true },
  { name: "Knoxville", lat: 35.9606, lng: -83.9207, leg: "Nashville to Asheville", stop: false },
  { name: "Asheville", lat: 35.5951, lng: -82.5515, leg: "Nashville to Asheville", stop: true },
  { name: "Lexington", lat: 38.0406, lng: -84.5037, leg: "Asheville to Minneapolis via Wisconsin", stop: false },
  { name: "Indianapolis", lat: 39.7684, lng: -86.1581, leg: "Asheville to Minneapolis via Wisconsin", stop: false },
  { name: "Chicago", lat: 41.8781, lng: -87.6298, leg: "Asheville to Minneapolis via Wisconsin", stop: false },
  { name: "Milwaukee", lat: 43.0389, lng: -87.9065, leg: "Asheville to Minneapolis via Wisconsin", stop: false },
  { name: "Wisconsin Dells", lat: 43.6275, lng: -89.7709, leg: "Asheville to Minneapolis via Wisconsin", stop: false },
  { name: "Minneapolis", lat: 44.9778, lng: -93.265, leg: "Asheville to Minneapolis via Wisconsin", stop: true },
];

export const ROAD_TRIP_EVENT_TYPES = {
  "kid-said": { label: "Talking", badge: "Q", className: "is-quote" },
  song: { label: "Singing", badge: "♪", className: "is-song" },
  doing: { label: "What We're Doing", badge: "D", className: "is-stop" },
};

export const ROAD_TRIP_SUBJECTS = {
  max: { label: "Max", shortLabel: "M", className: "is-max" },
  ellie: { label: "Ellie", shortLabel: "E", className: "is-ellie" },
  violet: { label: "Violet", shortLabel: "V", className: "is-violet" },
  savannah: { label: "Savannah", shortLabel: "S", className: "is-savannah" },
  andy: { label: "Andy", shortLabel: "A", className: "is-andy" },
  family: { label: "Family", shortLabel: "F", className: "is-family" },
};

export const ROAD_TRIP_GAMES = [
  {
    title: "Talking + Singing",
    href: "carlsons-kid-sayings.html",
    description: "Capture quotes, one-liners, and sing-along moments from one fast page.",
    eventType: "kid-said",
  },
  {
    title: "What We're Doing",
    href: "carlsons-sing-along.html",
    description: "Log whatever the crew is doing right now and pin it on the map.",
    eventType: "doing",
  },
];

const tripEventsCollection = collection(db, "roadTrips", ROAD_TRIP_ID, "events");

const tripEventDocument = (eventId) => doc(tripEventsCollection, String(eventId || "").trim());

export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const formatEventTime = (value) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
};

export const getEventTypeMeta = (eventType) => ROAD_TRIP_EVENT_TYPES[String(eventType || "").toLowerCase()] || {
  label: "Moment",
  badge: "•",
  className: "",
};

export const getSubjectMeta = (subject, fallbackLabel = "") => {
  const normalized = String(subject || "").trim().toLowerCase();
  if (ROAD_TRIP_SUBJECTS[normalized]) {
    return ROAD_TRIP_SUBJECTS[normalized];
  }

  const fallback = String(fallbackLabel || normalized || "Road Trip").trim();
  return {
    label: fallback,
    shortLabel: fallback.slice(0, 1).toUpperCase() || "R",
    className: "",
  };
};

export const getLoggerMeta = (person) => {
  const normalized = String(person || "").trim().toLowerCase();
  const knownProfile = Object.values({
    andy: getKnownUserProfile("andrewpcarlson85@gmail.com"),
    savannah: getKnownUserProfile("savannahbcarlson@gmail.com"),
  }).find((profile) => profile?.person === normalized);

  if (knownProfile) {
    return {
      person: normalized,
      personLabel: knownProfile.displayName,
    };
  }

  return {
    person: normalized,
    personLabel: normalized ? normalized.slice(0, 1).toUpperCase() + normalized.slice(1) : "Logger",
  };
};

export const resolveRoadTripLogger = ({ userEmail = "", approvalPerson = "" } = {}) => {
  const normalizedEmail = String(userEmail || "").trim().toLowerCase();
  const person = String(approvalPerson || getPersonFromEmail(normalizedEmail) || "").trim().toLowerCase();
  const loggerMeta = getLoggerMeta(person);

  return {
    person: loggerMeta.person,
    personLabel: loggerMeta.personLabel,
  };
};

const toRadians = (degrees) => (degrees * Math.PI) / 180;

const distanceBetween = (left, right) => {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(right.lat - left.lat);
  const dLng = toRadians(right.lng - left.lng);
  const startLat = toRadians(left.lat);
  const endLat = toRadians(right.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
};

export const inferRouteLeg = ({ lat, lng } = {}) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return "";
  }

  const nearestPoint = ROAD_TRIP_ROUTE_POINTS.reduce(
    (best, point) => {
      const milesAway = distanceBetween({ lat, lng }, point);
      if (!best || milesAway < best.milesAway) {
        return { point, milesAway };
      }
      return best;
    },
    null
  );

  return nearestPoint?.point?.leg || "";
};

export const captureSubmitLocation = () =>
  new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ lat: null, lng: null, locationSource: "unavailable" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: Number(position.coords.latitude),
          lng: Number(position.coords.longitude),
          locationSource: "gps",
        });
      },
      () => {
        resolve({ lat: null, lng: null, locationSource: "denied" });
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000,
      }
    );
  });

export const submitRoadTripEvent = async ({
  userEmail = "",
  approvalPerson = "",
  eventType = "",
  subject = "",
  subjectLabel = "",
  content = "",
  sourcePage = "",
} = {}) => {
  const logger = resolveRoadTripLogger({ userEmail, approvalPerson });
  const trimmedContent = String(content || "").trim();
  const subjectMeta = getSubjectMeta(subject, subjectLabel);

  if (!logger.person || !trimmedContent || !eventType) {
    throw new Error("missing-road-trip-fields");
  }

  const location = await captureSubmitLocation();
  const routeLeg = inferRouteLeg(location);

  await addDoc(tripEventsCollection, {
    tripId: ROAD_TRIP_ID,
    eventType: String(eventType).trim().toLowerCase(),
    person: logger.person,
    personLabel: logger.personLabel,
    subject: String(subject || "").trim().toLowerCase(),
    subjectLabel: subjectMeta.label,
    content: trimmedContent,
    routeLeg,
    lat: Number.isFinite(location.lat) ? location.lat : null,
    lng: Number.isFinite(location.lng) ? location.lng : null,
    locationSource: location.locationSource,
    sourcePage: String(sourcePage || "").trim(),
    createdAt: serverTimestamp(),
  });

  return location;
};

export const deleteRoadTripEvent = async (eventId) => {
  const normalizedEventId = String(eventId || "").trim();

  if (!normalizedEventId) {
    throw new Error("missing-road-trip-event-id");
  }

  await deleteDoc(tripEventDocument(normalizedEventId));
};

export const subscribeToRoadTripEvents = ({ onData, onError } = {}) => {
  const eventsQuery = query(tripEventsCollection, orderBy("createdAt", "desc"), limit(150));

  return onSnapshot(
    eventsQuery,
    (snapshot) => {
      const events = snapshot.docs.map((eventDoc) => {
        const data = eventDoc.data();
        const createdAt = data.createdAt?.toDate?.() || null;
        return {
          id: eventDoc.id,
          tripId: String(data.tripId || ROAD_TRIP_ID),
          eventType: String(data.eventType || "").trim().toLowerCase(),
          person: String(data.person || "").trim().toLowerCase(),
          personLabel: String(data.personLabel || "").trim(),
          subject: String(data.subject || "").trim().toLowerCase(),
          subjectLabel: String(data.subjectLabel || "").trim(),
          content: String(data.content || "").trim(),
          routeLeg: String(data.routeLeg || "").trim(),
          lat: Number.isFinite(Number(data.lat)) ? Number(data.lat) : null,
          lng: Number.isFinite(Number(data.lng)) ? Number(data.lng) : null,
          locationSource: String(data.locationSource || "").trim(),
          sourcePage: String(data.sourcePage || "").trim(),
          createdAt,
          createdLabel: formatEventTime(createdAt),
        };
      });

      onData?.(events);
    },
    onError
  );
};