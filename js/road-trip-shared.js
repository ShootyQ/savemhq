import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  deleteObject,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytesResumable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { app, db, getKnownUserProfile, getPersonFromEmail } from "./auth-shared.js";

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
  "kid-said": { label: "Quotes", badge: "", className: "is-quote" },
  song: { label: "Singing", badge: "♪", className: "is-song" },
  doing: { label: "What We're Doing", badge: "D", className: "is-stop" },
};

export const ROAD_TRIP_SUBJECTS = {
  max: { label: "Max", shortLabel: "M", className: "is-max", imageSrc: "images/family/max.png" },
  ellie: { label: "Ellie", shortLabel: "E", className: "is-ellie", imageSrc: "images/family/ellie.png" },
  violet: { label: "Violet", shortLabel: "V", className: "is-violet", imageSrc: "images/family/violet.png" },
  savannah: { label: "Savannah", shortLabel: "S", className: "is-savannah", imageSrc: "images/family/savannah.png" },
  andy: { label: "Andy", shortLabel: "A", className: "is-andy", imageSrc: "images/family/andy.png" },
  family: {
    label: "Family",
    shortLabel: "F",
    className: "is-family",
    imageStack: [
      "images/family/max.png",
      "images/family/ellie.png",
      "images/family/violet.png",
      "images/family/savannah.png",
      "images/family/andy.png",
    ],
  },
};

export const ROAD_TRIP_GAMES = [
  {
    title: "Quick Logger",
    href: "carlsons-road-trip-log.html",
    description: "Capture quotes, one-liners, sing-alongs, and what the crew is doing from one fast page.",
    eventType: "kid-said",
  },
  {
    title: "Quick Logger",
    href: "carlsons-road-trip-log.html",
    description: "Log whatever the crew is doing right now from the same unified logger.",
    eventType: "doing",
  },
];

const tripEventsCollection = collection(db, "roadTrips", ROAD_TRIP_ID, "events");

const tripEventDocument = (eventId) => doc(tripEventsCollection, String(eventId || "").trim());
const tripEventReactionsCollection = (eventId) => collection(tripEventDocument(eventId), "reactions");
const tripEventReactionDocument = (eventId, uid) => doc(tripEventReactionsCollection(eventId), String(uid || "").trim());
const storage = getStorage(app);
const COMPRESSIBLE_EVENT_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ROAD_TRIP_EVENT_PREP_TIMEOUT_MS = 8000;
const ROAD_TRIP_EVENT_UPLOAD_TIMEOUT_MS = 45000;
export const ROAD_TRIP_REACTION_OPTIONS = [
  { id: "heart", label: "Heart", emoji: "❤️" },
  { id: "lol", label: "LOL", emoji: "😂" },
  { id: "shocked", label: "Shocked", emoji: "😮" },
];

const sanitizeStorageFileName = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "road-trip-photo";
};

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  const timeoutId = window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("image-load-timeout"));
  }, ROAD_TRIP_EVENT_PREP_TIMEOUT_MS);

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

const prepareRoadTripEventImage = async (file) => {
  if (!(file instanceof Blob)) {
    throw new Error("missing-road-trip-photo-file");
  }

  const mimeType = String(file.type || "").toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new Error("invalid-road-trip-photo-file-type");
  }

  if (!COMPRESSIBLE_EVENT_IMAGE_TYPES.has(mimeType)) {
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

  const compressed = await new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(file), ROAD_TRIP_EVENT_PREP_TIMEOUT_MS);

    canvas.toBlob((blob) => {
      window.clearTimeout(timeoutId);
      resolve(blob || file);
    }, "image/jpeg", 0.82);
  });

  return compressed;
};

const uploadRoadTripEventPhoto = ({ storageRef, file, onProgress } = {}) => new Promise((resolve, reject) => {
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: String(file?.type || "image/jpeg").toLowerCase() || "image/jpeg",
    cacheControl: "public,max-age=3600",
  });

  const timeoutId = window.setTimeout(() => {
    uploadTask.cancel();
    reject(new Error("storage-upload-timeout"));
  }, ROAD_TRIP_EVENT_UPLOAD_TIMEOUT_MS);

  uploadTask.on(
    "state_changed",
    (snapshot) => {
      if (Number.isFinite(snapshot.totalBytes) && snapshot.totalBytes > 0) {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        onProgress?.(progress);
      }
    },
    (error) => {
      window.clearTimeout(timeoutId);
      reject(error);
    },
    async () => {
      window.clearTimeout(timeoutId);
      try {
        const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
        resolve(downloadUrl);
      } catch (error) {
        reject(error);
      }
    }
  );
});

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
    imageSrc: "",
    imageStack: [],
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
  photoFile = null,
  photoFiles = [],
  sourcePage = "",
  onStatus = null,
  onProgress = null,
} = {}) => {
  const logger = resolveRoadTripLogger({ userEmail, approvalPerson });
  const trimmedContent = String(content || "").trim();
  const subjectMeta = getSubjectMeta(subject, subjectLabel);
  const rawPhotoFiles = [
    ...((Array.isArray(photoFiles) ? photoFiles : []).filter((file) => file instanceof Blob)),
    ...(photoFile instanceof Blob ? [photoFile] : []),
  ];
  const normalizedPhotoFiles = rawPhotoFiles.slice(0, 3);

  if (!logger.person || !trimmedContent || !eventType) {
    throw new Error("missing-road-trip-fields");
  }

  if (rawPhotoFiles.length > 3) {
    throw new Error("too-many-road-trip-photos");
  }

  onStatus?.("Checking location...");
  const locationPromise = captureSubmitLocation();
  const photoUrls = [];
  const photoPaths = [];

  for (const [index, nextPhotoFile] of normalizedPhotoFiles.entries()) {
    onStatus?.(`Preparing photo ${index + 1} of ${normalizedPhotoFiles.length}...`);
    const preparedFile = await prepareRoadTripEventImage(nextPhotoFile);
    const normalizedMimeType = String(preparedFile.type || nextPhotoFile.type || "image/jpeg").toLowerCase();
    const fileExtension = normalizedMimeType.includes("png") ? "png" : "jpg";
    const photoPath = `roadTrips/${ROAD_TRIP_ID}/events/${String(eventType || "moment").trim().toLowerCase()}/${Date.now()}-${index + 1}-${logger.person}-${sanitizeStorageFileName(nextPhotoFile.name || subjectMeta.label)}.${fileExtension}`;
    const storageRef = ref(storage, photoPath);

    onStatus?.(`Uploading photo ${index + 1} of ${normalizedPhotoFiles.length}...`);
    const photoUrl = await uploadRoadTripEventPhoto({
      storageRef,
      file: preparedFile,
      onProgress: (progress) => {
        const overallProgress = Math.round((((index + (Number(progress) / 100)) / normalizedPhotoFiles.length) * 100));
        onProgress?.(overallProgress);
      },
    });

    photoUrls.push(photoUrl);
    photoPaths.push(photoPath);
  }

  const location = await locationPromise;
  const routeLeg = inferRouteLeg(location);

  onStatus?.("Saving moment...");
  await addDoc(tripEventsCollection, {
    tripId: ROAD_TRIP_ID,
    eventType: String(eventType).trim().toLowerCase(),
    person: logger.person,
    personLabel: logger.personLabel,
    subject: String(subject || "").trim().toLowerCase(),
    subjectLabel: subjectMeta.label,
    content: trimmedContent,
    ...(photoUrls.length ? {
      photoUrl: photoUrls[0],
      photoPath: photoPaths[0],
      photoUrls,
      photoPaths,
    } : {}),
    routeLeg,
    lat: Number.isFinite(location.lat) ? location.lat : null,
    lng: Number.isFinite(location.lng) ? location.lng : null,
    locationSource: location.locationSource,
    sourcePage: String(sourcePage || "").trim(),
    createdAt: serverTimestamp(),
  });

  return location;
};

export const deleteRoadTripEvent = async ({ eventId = "", photoPath = "", photoPaths = [] } = {}) => {
  const normalizedEventId = String(eventId || "").trim();
  const normalizedPhotoPaths = [
    ...((Array.isArray(photoPaths) ? photoPaths : []).map((value) => String(value || "").trim()).filter(Boolean)),
    ...[String(photoPath || "").trim()].filter(Boolean),
  ].filter((value, index, values) => values.indexOf(value) === index);

  if (!normalizedEventId) {
    throw new Error("missing-road-trip-event-id");
  }

  for (const normalizedPhotoPath of normalizedPhotoPaths) {
    if (!normalizedPhotoPath) {
      continue;
    }

    try {
      await deleteObject(ref(storage, normalizedPhotoPath));
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (errorCode !== "storage/object-not-found") {
        throw error;
      }
    }
  }

  const reactionSnapshot = await getDocs(tripEventReactionsCollection(normalizedEventId));
  await Promise.all(reactionSnapshot.docs.map((reactionDoc) => deleteDoc(reactionDoc.ref)));

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
        const photoUrls = Array.isArray(data.photoUrls)
          ? data.photoUrls.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const photoPaths = Array.isArray(data.photoPaths)
          ? data.photoPaths.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const fallbackPhotoUrl = String(data.photoUrl || "").trim();
        const fallbackPhotoPath = String(data.photoPath || "").trim();
        const normalizedPhotoUrls = photoUrls.length ? photoUrls : (fallbackPhotoUrl ? [fallbackPhotoUrl] : []);
        const normalizedPhotoPaths = photoPaths.length ? photoPaths : (fallbackPhotoPath ? [fallbackPhotoPath] : []);

        return {
          id: eventDoc.id,
          tripId: String(data.tripId || ROAD_TRIP_ID),
          eventType: String(data.eventType || "").trim().toLowerCase(),
          person: String(data.person || "").trim().toLowerCase(),
          personLabel: String(data.personLabel || "").trim(),
          subject: String(data.subject || "").trim().toLowerCase(),
          subjectLabel: String(data.subjectLabel || "").trim(),
          content: String(data.content || "").trim(),
          photoUrl: normalizedPhotoUrls[0] || fallbackPhotoUrl,
          photoPath: normalizedPhotoPaths[0] || fallbackPhotoPath,
          photoUrls: normalizedPhotoUrls,
          photoPaths: normalizedPhotoPaths,
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

export const subscribeToRoadTripEventReactions = (eventId, { onData, onError } = {}) => {
  const normalizedEventId = String(eventId || "").trim();

  if (!normalizedEventId) {
    onData?.([]);
    return () => {};
  }

  return onSnapshot(
    tripEventReactionsCollection(normalizedEventId),
    (snapshot) => {
      onData?.(snapshot.docs.map((reactionDoc) => {
        const data = reactionDoc.data();
        return {
          id: reactionDoc.id,
          uid: String(data?.uid || reactionDoc.id || "").trim(),
          tripId: String(data?.tripId || ROAD_TRIP_ID).trim(),
          eventId: String(data?.eventId || normalizedEventId).trim(),
          reaction: String(data?.reaction || "").trim().toLowerCase(),
          createdAt: data?.createdAt?.toDate?.() || null,
          updatedAt: data?.updatedAt?.toDate?.() || null,
        };
      }));
    },
    onError
  );
};

export const setRoadTripEventReaction = async ({ eventId = "", uid = "", reaction = "" } = {}) => {
  const normalizedEventId = String(eventId || "").trim();
  const normalizedUid = String(uid || "").trim();
  const normalizedReaction = String(reaction || "").trim().toLowerCase();

  if (!normalizedEventId || !normalizedUid || !normalizedReaction) {
    throw new Error("missing-road-trip-reaction-fields");
  }

  if (!ROAD_TRIP_REACTION_OPTIONS.some((entry) => entry.id === normalizedReaction)) {
    throw new Error("invalid-road-trip-reaction");
  }

  await setDoc(tripEventReactionDocument(normalizedEventId, normalizedUid), {
    tripId: ROAD_TRIP_ID,
    eventId: normalizedEventId,
    uid: normalizedUid,
    reaction: normalizedReaction,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
};