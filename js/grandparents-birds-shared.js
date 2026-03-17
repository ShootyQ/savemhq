import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "./auth-shared.js";

export const GRANDPARENTS_BIRD_TRACKER_ID = "grandparents-window";
export const GRANDPARENTS_BIRD_TRACKER_TITLE = "Grandparents Bird Window";

const birdTrackerCollection = collection(db, "backyardBirds", GRANDPARENTS_BIRD_TRACKER_ID, "species");
const birdMonthsCollection = collection(db, "backyardBirds", GRANDPARENTS_BIRD_TRACKER_ID, "months");
const birdSpeciesDocument = (birdId) => doc(birdTrackerCollection, String(birdId || "").trim());
const birdMonthDocument = (monthId) => doc(birdMonthsCollection, String(monthId || "").trim());
const birdDaysCollection = (monthId) => collection(birdMonthDocument(monthId), "days");
const birdDayDocument = (monthId, dayId) => doc(birdDaysCollection(monthId), String(dayId || "").trim());

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

  await setDoc(
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
    await setDoc(
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

  return {
    birdId,
    birdName,
    monthId,
    dayId,
  };
};