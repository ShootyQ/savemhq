import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "./auth-shared.js";

export const GRANDPARENTS_BIRD_TRACKER_ID = "grandparents-window";
export const GRANDPARENTS_BIRD_TRACKER_TITLE = "Grandparents Bird Window";

const birdTrackerCollection = collection(db, "backyardBirds", GRANDPARENTS_BIRD_TRACKER_ID, "species");
const birdMonthsCollection = collection(db, "backyardBirds", GRANDPARENTS_BIRD_TRACKER_ID, "months");
const birdSightingsCollection = collection(db, "backyardBirds", GRANDPARENTS_BIRD_TRACKER_ID, "sightings");
const birdSpeciesDocument = (birdId) => doc(birdTrackerCollection, String(birdId || "").trim());
const birdMonthDocument = (monthId) => doc(birdMonthsCollection, String(monthId || "").trim());
const birdDaysCollection = (monthId) => collection(birdMonthDocument(monthId), "days");
const birdDayDocument = (monthId, dayId) => doc(birdDaysCollection(monthId), String(dayId || "").trim());
const birdSightingDocument = (dayId, birdId) => doc(
  birdSightingsCollection,
  `${String(dayId || "").trim()}__${String(birdId || "").trim()}`
);

const titleCaseSegment = (segment) => {
  const value = String(segment || "").trim();
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

const titleCaseBirdName = (name) => String(name || "")
  .trim()
  .replace(/\s+/g, " ")
  .split(" ")
  .map((word) => word.split("-").map(titleCaseSegment).join("-"))
  .join(" ");

export const normalizeBirdName = (name) => titleCaseBirdName(name);

export const GRANDPARENTS_BIRD_STARTER_SPECIES = [
  "Great Blue Heron",
  "Canada Goose",
  "Wood Duck",
  "Mallard",
  "Turkey Vulture",
  "Cooper's Hawk",
  "Red-Shouldered Hawk",
  "Red-Tailed Hawk",
  "Wild Turkey",
  "Killdeer",
  "Rock Dove",
  "Mourning Dove",
  "Eastern Screech-Owl",
  "Great Horned Owl",
  "Red-Bellied Woodpecker",
  "Downy Woodpecker",
  "Hairy Woodpecker",
  "Northern Flicker",
  "Pileated Woodpecker",
  "Eastern Phoebe",
  "Blue Jay",
  "American Crow",
  "Carolina Chickadee",
  "Tufted Titmouse",
  "White-Breasted Nuthatch",
  "Carolina Wren",
  "Northern Mockingbird",
  "Eastern Bluebird",
  "American Robin",
  "Cedar Waxwing",
  "European Starling",
  "Northern Cardinal",
  "Eastern Towhee",
  "Song Sparrow",
  "Common Grackle",
  "House Finch",
  "American Goldfinch",
  "House Sparrow",
  "Broad-Winged Hawk",
  "Chimney Swift",
  "Ruby-Throated Hummingbird",
  "Eastern Wood-Pewee",
  "Great Crested Flycatcher",
  "Eastern Kingbird",
  "Northern Rough-Winged Swallow",
  "Barn Swallow",
  "Tree Swallow",
  "House Wren",
  "Blue-Gray Gnatcatcher",
  "Gray Catbird",
  "Brown Thrasher",
  "Wood Thrush",
  "Red-Eyed Vireo",
  "Yellow Warbler",
  "Black-Throated Green Warbler",
  "Black-And-White Warbler",
  "American Redstart",
  "Common Yellowthroat",
  "Hooded Warbler",
  "Scarlet Tanager",
  "Rose-Breasted Grosbeak",
  "Indigo Bunting",
  "Chipping Sparrow",
  "Red-Winged Blackbird",
  "Brown-Headed Cowbird",
  "Orchard Oriole",
  "Baltimore Oriole",
  "Yellow-Bellied Sapsucker",
  "Golden-Crowned Kinglet",
  "Ruby-Crowned Kinglet",
  "Yellow-Rumped Warbler",
  "White-Throated Sparrow",
  "Dark-Eyed Junco",
  "Purple Finch",
  "Pine Siskin",
  "Evening Grosbeak",
].map((name) => normalizeBirdName(name));

export const slugifyBirdName = (name) => String(name || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  || "bird";

const dateFromValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value;
  }

  const text = String(value || "").trim();
  if (!text) {
    return new Date();
  }

  const parsed = new Date(`${text}T12:00:00`);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
};

const padNumber = (value) => String(value).padStart(2, "0");

export const toLocalDateInputValue = (value = new Date()) => {
  const date = dateFromValue(value);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
};

export const getMonthIdForDate = (value = new Date()) => {
  const date = dateFromValue(value);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}`;
};

export const getDayIdForDate = (value = new Date()) => toLocalDateInputValue(value);

export const formatMonthLabel = (value = new Date()) => dateFromValue(value).toLocaleDateString(undefined, {
  month: "long",
  year: "numeric",
});

export const formatDayLabel = (value = new Date()) => dateFromValue(value).toLocaleDateString(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const subscribeToBirdSpecies = ({ onData, onError } = {}) => onSnapshot(
  query(birdTrackerCollection, orderBy("name")),
  (snapshot) => {
    const species = snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    }));
    onData?.(species);
  },
  (error) => {
    onError?.(error);
  }
);

export const subscribeToBirdMonths = ({ onData, onError } = {}) => onSnapshot(
  query(birdMonthsCollection, orderBy("sortOrder", "desc")),
  (snapshot) => {
    const months = snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    }));
    onData?.(months);
  },
  (error) => {
    onError?.(error);
  }
);

export const subscribeToBirdDays = (monthId, { onData, onError } = {}) => onSnapshot(
  query(birdDaysCollection(monthId), orderBy("dateKey", "desc")),
  (snapshot) => {
    const days = snapshot.docs.map((entry) => ({
      id: entry.id,
      ...entry.data(),
    }));
    onData?.(days);
  },
  (error) => {
    onError?.(error);
  }
);

export const saveBirdSpecies = async ({ name, user } = {}) => {
  const normalizedName = normalizeBirdName(name);
  const birdId = slugifyBirdName(normalizedName);
  const actorLabel = String(user?.displayName || user?.email || "Family watcher").trim();

  await setDoc(
    birdSpeciesDocument(birdId),
    {
      name: normalizedName,
      slug: birdId,
      source: "manual",
      createdByUid: String(user?.uid || ""),
      createdByLabel: actorLabel,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    id: birdId,
    name: normalizedName,
  };
};

export const seedStarterBirdSpecies = async ({ user, species = [] } = {}) => {
  const actorLabel = String(user?.displayName || user?.email || "Family watcher").trim();
  const existingIds = new Set(
    species.map((bird) => String(bird.slug || bird.id || "").trim()).filter(Boolean)
  );
  const missingBirds = GRANDPARENTS_BIRD_STARTER_SPECIES.filter((birdName) => !existingIds.has(slugifyBirdName(birdName)));

  if (missingBirds.length === 0) {
    return {
      addedCount: 0,
      totalStarterCount: GRANDPARENTS_BIRD_STARTER_SPECIES.length,
    };
  }

  await Promise.all(
    missingBirds.map((birdName) => {
      const birdId = slugifyBirdName(birdName);
      return setDoc(
        birdSpeciesDocument(birdId),
        {
          name: birdName,
          slug: birdId,
          source: "starter",
          createdByUid: String(user?.uid || ""),
          createdByLabel: actorLabel,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    })
  );

  return {
    addedCount: missingBirds.length,
    totalStarterCount: GRANDPARENTS_BIRD_STARTER_SPECIES.length,
  };
};

export const logBirdSighting = async ({ bird, dateValue, includeDaily = false, user } = {}) => {
  const birdName = normalizeBirdName(bird?.name || bird?.label || bird);
  const birdId = slugifyBirdName(bird?.id || birdName);
  const date = dateFromValue(dateValue);
  const monthId = getMonthIdForDate(date);
  const dayId = getDayIdForDate(date);
  const actorLabel = String(user?.displayName || user?.email || "Family watcher").trim();
  const monthNumber = date.getMonth() + 1;
  const year = date.getFullYear();
  const batch = writeBatch(db);

  batch.set(
    birdMonthDocument(monthId),
    {
      monthId,
      label: formatMonthLabel(date),
      year,
      monthNumber,
      sortOrder: (year * 100) + monthNumber,
      birdIds: arrayUnion(birdId),
      birdNames: arrayUnion(birdName),
      lastLoggedBirdId: birdId,
      lastLoggedBirdName: birdName,
      lastLoggedByUid: String(user?.uid || ""),
      lastLoggedByLabel: actorLabel,
      updatedAt: serverTimestamp(),
      lastLoggedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (includeDaily) {
    batch.set(
      birdDayDocument(monthId, dayId),
      {
        dayId,
        monthId,
        dateKey: dayId,
        label: formatDayLabel(date),
        birdIds: arrayUnion(birdId),
        birdNames: arrayUnion(birdName),
        lastLoggedBirdId: birdId,
        lastLoggedBirdName: birdName,
        lastLoggedByUid: String(user?.uid || ""),
        lastLoggedByLabel: actorLabel,
        updatedAt: serverTimestamp(),
        lastLoggedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  batch.set(
    birdSightingDocument(dayId, birdId),
    {
      trackerId: GRANDPARENTS_BIRD_TRACKER_ID,
      birdId,
      birdName,
      monthId,
      dayId,
      dateKey: dayId,
      loggedByUid: String(user?.uid || ""),
      loggedByLabel: actorLabel,
      seenAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();

  return {
    birdId,
    birdName,
    monthId,
    dayId,
  };
};

const toBirdEntries = ({ birdIds = [], birdNames = [] } = {}) => {
  const names = Array.isArray(birdNames) ? birdNames : [];
  const ids = Array.isArray(birdIds) ? birdIds : [];

  return names
    .map((birdName, index) => {
      const normalizedName = normalizeBirdName(birdName);
      const birdId = String(ids[index] || slugifyBirdName(normalizedName)).trim();

      if (!normalizedName || !birdId) {
        return null;
      }

      return {
        id: birdId,
        name: normalizedName,
      };
    })
    .filter(Boolean);
};

const lastBirdFieldsForEntries = (entries, fallback = {}) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      lastLoggedBirdId: "",
      lastLoggedBirdName: "",
      lastLoggedByUid: "",
      lastLoggedByLabel: "",
    };
  }

  const lastEntry = entries[entries.length - 1];
  return {
    lastLoggedBirdId: String(lastEntry.id || "").trim(),
    lastLoggedBirdName: String(lastEntry.name || "").trim(),
    lastLoggedByUid: String(fallback.lastLoggedByUid || "").trim(),
    lastLoggedByLabel: String(fallback.lastLoggedByLabel || "").trim(),
  };
};

export const removeBirdSightingFromDay = async ({ bird, dateValue, day, month, siblingDays = [] } = {}) => {
  const birdName = normalizeBirdName(bird?.name || bird?.label || bird);
  const birdId = slugifyBirdName(bird?.id || birdName);
  const date = dateFromValue(dateValue);
  const monthId = getMonthIdForDate(date);
  const dayId = getDayIdForDate(date);
  const monthNumber = date.getMonth() + 1;
  const year = date.getFullYear();
  const targetDay = day && String(day.dayId || day.id || "") === dayId
    ? day
    : siblingDays.find((entry) => String(entry.dayId || entry.id || "") === dayId);

  if (!targetDay) {
    throw new Error("missing-day");
  }

  const targetDayEntries = toBirdEntries({
    birdIds: targetDay.birdIds,
    birdNames: targetDay.birdNames,
  });
  const nextDayEntries = targetDayEntries.filter((entry) => entry.id !== birdId && entry.name !== birdName);

  if (nextDayEntries.length === targetDayEntries.length) {
    throw new Error("missing-bird");
  }

  const updatedSiblingDays = siblingDays.map((entry) => {
    if (String(entry.dayId || entry.id || "") !== dayId) {
      return entry;
    }

    return {
      ...entry,
      birdIds: nextDayEntries.map((birdEntry) => birdEntry.id),
      birdNames: nextDayEntries.map((birdEntry) => birdEntry.name),
      ...lastBirdFieldsForEntries(nextDayEntries, entry),
    };
  });

  const birdStillExistsInMonth = updatedSiblingDays.some((entry) => {
    const entries = toBirdEntries({
      birdIds: entry.birdIds,
      birdNames: entry.birdNames,
    });
    return entries.some((birdEntry) => birdEntry.id === birdId || birdEntry.name === birdName);
  });

  const monthEntries = toBirdEntries({
    birdIds: month?.birdIds,
    birdNames: month?.birdNames,
  });
  const nextMonthEntries = birdStillExistsInMonth
    ? monthEntries
    : monthEntries.filter((entry) => entry.id !== birdId && entry.name !== birdName);
  const latestDayWithBirds = [...updatedSiblingDays]
    .filter((entry) => Array.isArray(entry.birdNames) && entry.birdNames.length > 0)
    .sort((left, right) => String(right.dateKey || right.dayId || right.id || "").localeCompare(String(left.dateKey || left.dayId || left.id || "")))[0] || null;
  const latestDayEntries = latestDayWithBirds
    ? toBirdEntries({
        birdIds: latestDayWithBirds.birdIds,
        birdNames: latestDayWithBirds.birdNames,
      })
    : [];
  const nextMonthLastFields = latestDayWithBirds
    ? lastBirdFieldsForEntries(latestDayEntries, latestDayWithBirds)
    : lastBirdFieldsForEntries([]);
  const nextDayLastFields = lastBirdFieldsForEntries(nextDayEntries, targetDay);
  const batch = writeBatch(db);

  batch.set(
    birdDayDocument(monthId, dayId),
    {
      dayId,
      monthId,
      dateKey: dayId,
      label: String(targetDay.label || formatDayLabel(date)).trim(),
      birdIds: nextDayEntries.map((entry) => entry.id),
      birdNames: nextDayEntries.map((entry) => entry.name),
      ...nextDayLastFields,
      updatedAt: serverTimestamp(),
      lastLoggedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    birdMonthDocument(monthId),
    {
      monthId,
      label: String(month?.label || formatMonthLabel(date)).trim(),
      year,
      monthNumber,
      sortOrder: (year * 100) + monthNumber,
      birdIds: nextMonthEntries.map((entry) => entry.id),
      birdNames: nextMonthEntries.map((entry) => entry.name),
      ...nextMonthLastFields,
      updatedAt: serverTimestamp(),
      lastLoggedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.delete(birdSightingDocument(dayId, birdId));

  await batch.commit();

  return {
    birdId,
    birdName,
    monthId,
    dayId,
    remainingDayCount: nextDayEntries.length,
    remainingMonthCount: nextMonthEntries.length,
  };
};