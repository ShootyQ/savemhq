import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { app, db } from "./auth-shared.js";
import { ROAD_TRIP_ID, resolveRoadTripLogger } from "./road-trip-shared.js";

export const KIDS_SAID_IT_BINGO_GAME_ID = "kids-said-it-bingo";
export const KIDS_SAID_IT_BINGO_TITLE = "Kid's Said It Bingo";
export const ALPHABET_GAME_ID = "alphabet-game";
export const ALPHABET_GAME_TITLE = "Alphabet Game";
export const SCAVENGER_HUNT_GAME_ID = "road-trip-scavenger-hunt";
export const SCAVENGER_HUNT_GAME_TITLE = "Road Trip Scavenger Hunt";
export const PHOTO_PROOF_CHALLENGE_GAME_ID = "photo-proof-challenges";
export const PHOTO_PROOF_CHALLENGE_GAME_TITLE = "Photo Proof Challenges";

export const ROAD_TRIP_GAME_DECK = [
  {
    id: KIDS_SAID_IT_BINGO_GAME_ID,
    title: KIDS_SAID_IT_BINGO_TITLE,
    href: "carlsons-kids-said-it-bingo.html",
    badge: "Live now",
    description: "Two live bingo cards for Andy and Savannah, built from the things the kids always circle back to.",
    scoreboardLabel: "Bingo wins",
    isLive: true,
  },
  {
    id: ALPHABET_GAME_ID,
    title: ALPHABET_GAME_TITLE,
    href: "carlsons-alphabet-game.html",
    badge: "Live now",
    description: "Quick win tracker for the alphabet game when all you need is one tap for Andy or Savannah.",
    scoreboardLabel: "Alphabet wins",
    isLive: true,
  },
  {
    id: SCAVENGER_HUNT_GAME_ID,
    title: SCAVENGER_HUNT_GAME_TITLE,
    href: "carlsons-road-trip-scavenger-hunt.html",
    badge: "Live now",
    description: "Spot the roadside oddities, mark them off fast, and see who clears the board first.",
    scoreboardLabel: "Scavenger finds",
    isLive: true,
  },
  {
    id: PHOTO_PROOF_CHALLENGE_GAME_ID,
    title: PHOTO_PROOF_CHALLENGE_GAME_TITLE,
    href: "carlsons-photo-proof-challenges.html",
    badge: "Live now",
    description: "Snap weird roadside proof, stack points for Andy and Savannah, and let approved friends vote on the best shots.",
    scoreboardLabel: "Photo proof points",
    isLive: true,
  },
];

export const PHOTO_PROOF_CHALLENGES = [
  {
    id: "weirdest-gas-station-snack",
    label: "Weirdest gas station snack",
    hint: "Questionable chips, neon jerky, pickle pouches, or anything else that should not exist.",
  },
  {
    id: "funniest-sign",
    label: "Funniest sign",
    hint: "Billboards, church signs, hand-painted warnings, or accidental comedy on the roadside.",
  },
  {
    id: "sketchiest-mascot",
    label: "Sketchiest mascot",
    hint: "The kind of giant statue, costume, or roadside creature that makes the stop slightly unsettling.",
  },
  {
    id: "best-sunset",
    label: "Best sunset",
    hint: "Golden-hour proof that the van route had cinematic moments too.",
  },
  {
    id: "strangest-town-name",
    label: "Strangest town name",
    hint: "A road sign that sounds made up, suspicious, or impossible to explain without a picture.",
  },
];

export const ROAD_TRIP_SCAVENGER_HUNT_ITEMS = [
  "Water tower",
  "Red barn",
  "Horse trailer",
  "Billboard for Jesus",
  "State trooper",
  "Semi with animals",
  "Tiny roadside motel",
  "Wind turbine",
  "Something shaped like the state",
  "Yellow car",
  "Construction cone army",
  "Giant flag",
];

export const KIDS_SAID_IT_BINGO_PHRASES = [
  "Are we there yet?",
  "General Complaining",
  "I have to potty.",
  "Can we have a snack?",
  "How much longer?",
  "I dropped it.",
  "He's touching me.",
  "Can I have my water?",
  "I'm not tired.",
  "My tummy hurts.",
  "I saw an (any animal).",
  "Can we stop?",
  "This is boring.",
  "Can we watch something?",
  "That smells weird.",
  "I want a treat.",
  "Look at that truck.",
  "Can we get McDonald's?",
  "are we there yet?",
  "I'm hot.",
  "I'm cold.",
  "This is my favorite song.",
  "Can we play I Spy?",
  "I need a bandaid.",
  "I'm bored.",
  "I don't like it",
  "Where are we going?",
  "My tablet died.",
  "Can I have a snack?",
  "That's not fair.",
  "Can we go swimming?",
  "I need to stretch.",
  "Look, horses.",
  "I spilled.",
  "I want headphones.",
  "She took my blanket.",
  "Can I open it?",
  "This seatbelt hurts.",
  "Can we go faster?",
  "I want the blue one.",
  "Can we get ice cream?",
  "Turn it up.",
  "Turn it down.",
  "The sun is in my eyes.",
  "I can't find it.",
  "Can we do a different song?",
  "I want to hold it.",
  "Dropped their toy.",
  "Lost their toy.",
  "Spilled their drink.",
  "Spilled their snack.",
  "Needs help opening a snack.",
  "Needs help with the seatbelt.",
  "Blanket fell down.",
  "Lost a shoe.",
  "Dropped the cup.",
  "Needs a wipe.",
  "Needs a cleanup.",
  "Needs a diaper change.",
  "Cried because someone touched their stuff.",
  "Threw something on the floor.",
  "Asked for the window up.",
  "Asked for the window down.",
  "Needs a charger.",
  "Asked to switch seats.",
  "Lost the blanket.",
  "Needs help finding the stuffed animal.",
];

const BINGO_SIZE = 5;
const BINGO_CELL_COUNT = BINGO_SIZE * BINGO_SIZE;
const BINGO_FREE_INDEX = Math.floor(BINGO_CELL_COUNT / 2);
export const KIDS_SAID_IT_BINGO_SIZE = BINGO_SIZE;
export const KIDS_SAID_IT_BINGO_CELL_COUNT = BINGO_CELL_COUNT;
export const KIDS_SAID_IT_BINGO_FREE_INDEX = BINGO_FREE_INDEX;
const storage = getStorage(app);
const tripGameDocument = (gameId) => doc(db, "roadTrips", ROAD_TRIP_ID, "games", gameId);
const kidsSaidItBingoDocument = tripGameDocument(KIDS_SAID_IT_BINGO_GAME_ID);
const alphabetGameDocument = tripGameDocument(ALPHABET_GAME_ID);
const scavengerHuntGameDocument = tripGameDocument(SCAVENGER_HUNT_GAME_ID);
const photoProofEntriesCollection = collection(db, "roadTrips", ROAD_TRIP_ID, "photoProofEntries");
const photoProofEntryDocument = (entryId) => doc(photoProofEntriesCollection, String(entryId || "").trim());
const photoProofVotesCollection = (entryId) => collection(photoProofEntryDocument(entryId), "votes");
const photoProofVoteDocument = (entryId, uid) => doc(photoProofVotesCollection(entryId), String(uid || "").trim());

const playerFieldPrefix = (player) => (String(player || "").trim().toLowerCase() === "savannah" ? "savannah" : "andy");

const createGameItemId = (label) => {
  const base = String(label || "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "item";

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
};

const PLAYER_IDENTITIES = new Set(["andy", "savannah"]);

export const isRoadTripPlayer = (person = "") => PLAYER_IDENTITIES.has(String(person || "").trim().toLowerCase());

export const getPhotoProofChallengeMeta = (challengeId = "") => PHOTO_PROOF_CHALLENGES.find(
  (challenge) => challenge.id === String(challengeId || "").trim().toLowerCase()
) || null;

const sanitizeStorageFileName = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "photo-proof";
};

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error("image-load-failed"));
  };

  image.src = objectUrl;
});

export const preparePhotoProofImage = async (file) => {
  if (!(file instanceof Blob)) {
    throw new Error("missing-photo-file");
  }

  const mimeType = String(file.type || "").toLowerCase();
  if (!mimeType.startsWith("image/")) {
    throw new Error("invalid-photo-file-type");
  }

  const image = await loadImageFromFile(file);
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
    canvas.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.82);
  });

  return compressed;
};

const normalizePhotoProofEntry = (entryId, data) => ({
  id: String(entryId || "").trim(),
  tripId: String(data?.tripId || ROAD_TRIP_ID),
  challengeId: String(data?.challengeId || "").trim().toLowerCase(),
  challengeLabel: String(data?.challengeLabel || "").trim(),
  caption: String(data?.caption || "").trim(),
  photoUrl: String(data?.photoUrl || "").trim(),
  photoPath: String(data?.photoPath || "").trim(),
  uploaderPerson: String(data?.uploaderPerson || "").trim().toLowerCase(),
  uploaderLabel: String(data?.uploaderLabel || "").trim(),
  sourcePage: String(data?.sourcePage || "").trim(),
  createdAt: data?.createdAt?.toDate?.() || null,
  updatedAt: data?.updatedAt?.toDate?.() || null,
});

const normalizePhotoProofVote = (voteId, data) => ({
  id: String(voteId || "").trim(),
  uid: String(data?.uid || voteId || "").trim(),
  voterLabel: String(data?.voterLabel || "").trim(),
  entryId: String(data?.entryId || "").trim(),
  tripId: String(data?.tripId || ROAD_TRIP_ID),
  createdAt: data?.createdAt?.toDate?.() || null,
});

const shuffle = (items) => {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [nextItems[index], nextItems[swapIndex]] = [nextItems[swapIndex], nextItems[index]];
  }

  return nextItems;
};

const createBingoCard = () => {
  const selections = shuffle(KIDS_SAID_IT_BINGO_PHRASES).slice(0, BINGO_CELL_COUNT - 1);
  selections.splice(BINGO_FREE_INDEX, 0, "FREE SPACE");
  return selections;
};

const normalizeMarks = (marks) => {
  const safeMarks = Array.isArray(marks) ? marks : [];
  return [...new Set([BINGO_FREE_INDEX, ...safeMarks.map((value) => Number(value)).filter(Number.isInteger)])].sort((left, right) => left - right);
};

const winningLines = () => {
  const lines = [];

  for (let row = 0; row < BINGO_SIZE; row += 1) {
    lines.push(Array.from({ length: BINGO_SIZE }, (_, column) => row * BINGO_SIZE + column));
  }

  for (let column = 0; column < BINGO_SIZE; column += 1) {
    lines.push(Array.from({ length: BINGO_SIZE }, (_, row) => row * BINGO_SIZE + column));
  }

  lines.push(Array.from({ length: BINGO_SIZE }, (_, index) => index * (BINGO_SIZE + 1)));
  lines.push(Array.from({ length: BINGO_SIZE }, (_, index) => (index + 1) * (BINGO_SIZE - 1)));

  return lines;
};

const BINGO_LINES = winningLines();

const hasBingo = (marks) => {
  const markSet = new Set(normalizeMarks(marks));
  return BINGO_LINES.some((line) => line.every((index) => markSet.has(index)));
};

const createBingoGameState = ({
  round = 1,
  andyWins = 0,
  savannahWins = 0,
  lastWinner = "",
  lastWinnerLabel = "",
  lastWonAt = null,
} = {}) => ({
  tripId: ROAD_TRIP_ID,
  gameId: KIDS_SAID_IT_BINGO_GAME_ID,
  title: KIDS_SAID_IT_BINGO_TITLE,
  round,
  andyCard: createBingoCard(),
  savannahCard: createBingoCard(),
  andyMarks: [BINGO_FREE_INDEX],
  savannahMarks: [BINGO_FREE_INDEX],
  andyWins,
  savannahWins,
  lastWinner,
  lastWinnerLabel,
  lastWonAt,
  updatedAt: serverTimestamp(),
});

const normalizeBingoState = (data) => ({
  tripId: String(data?.tripId || ROAD_TRIP_ID),
  gameId: String(data?.gameId || KIDS_SAID_IT_BINGO_GAME_ID),
  title: String(data?.title || KIDS_SAID_IT_BINGO_TITLE),
  round: Number(data?.round || 1),
  andyCard: Array.isArray(data?.andyCard) ? data.andyCard.map((value) => String(value || "")) : createBingoCard(),
  savannahCard: Array.isArray(data?.savannahCard) ? data.savannahCard.map((value) => String(value || "")) : createBingoCard(),
  andyMarks: normalizeMarks(data?.andyMarks),
  savannahMarks: normalizeMarks(data?.savannahMarks),
  andyWins: Number(data?.andyWins || 0),
  savannahWins: Number(data?.savannahWins || 0),
  lastWinner: String(data?.lastWinner || "").trim().toLowerCase(),
  lastWinnerLabel: String(data?.lastWinnerLabel || "").trim(),
  lastWonAt: data?.lastWonAt?.toDate?.() || null,
  updatedAt: data?.updatedAt?.toDate?.() || null,
});

export const createKidsSaidItBingoPreviewState = () => normalizeBingoState(createBingoGameState());

const createAlphabetGameState = ({
  andyWins = 0,
  savannahWins = 0,
  lastWinner = "",
  lastWinnerLabel = "",
  lastWonAt = null,
} = {}) => ({
  tripId: ROAD_TRIP_ID,
  gameId: ALPHABET_GAME_ID,
  title: ALPHABET_GAME_TITLE,
  andyWins,
  savannahWins,
  lastWinner,
  lastWinnerLabel,
  lastWonAt,
  updatedAt: serverTimestamp(),
});

const normalizeAlphabetGameState = (data) => ({
  tripId: String(data?.tripId || ROAD_TRIP_ID),
  gameId: String(data?.gameId || ALPHABET_GAME_ID),
  title: String(data?.title || ALPHABET_GAME_TITLE),
  andyWins: Number(data?.andyWins || 0),
  savannahWins: Number(data?.savannahWins || 0),
  lastWinner: String(data?.lastWinner || "").trim().toLowerCase(),
  lastWinnerLabel: String(data?.lastWinnerLabel || "").trim(),
  lastWonAt: data?.lastWonAt?.toDate?.() || null,
  updatedAt: data?.updatedAt?.toDate?.() || null,
});

export const createAlphabetGamePreviewState = () => normalizeAlphabetGameState(createAlphabetGameState());

const createScavengerHuntItem = (label, { id = createGameItemId(label), isCustom = false } = {}) => ({
  id,
  label: String(label || "").trim(),
  andyFound: false,
  savannahFound: false,
  isCustom,
});

const createScavengerHuntState = ({ items = ROAD_TRIP_SCAVENGER_HUNT_ITEMS.map((label) => createScavengerHuntItem(label)) } = {}) => ({
  tripId: ROAD_TRIP_ID,
  gameId: SCAVENGER_HUNT_GAME_ID,
  title: SCAVENGER_HUNT_GAME_TITLE,
  items,
  updatedAt: serverTimestamp(),
});

const normalizeScavengerHuntItems = (items) => Array.isArray(items)
  ? items
    .map((item) => ({
      id: String(item?.id || createGameItemId(item?.label || "item")),
      label: String(item?.label || "").trim(),
      andyFound: Boolean(item?.andyFound),
      savannahFound: Boolean(item?.savannahFound),
      isCustom: Boolean(item?.isCustom),
    }))
    .filter((item) => item.label)
  : ROAD_TRIP_SCAVENGER_HUNT_ITEMS.map((label) => createScavengerHuntItem(label));

const normalizeScavengerHuntState = (data) => {
  const items = normalizeScavengerHuntItems(data?.items);

  return {
    tripId: String(data?.tripId || ROAD_TRIP_ID),
    gameId: String(data?.gameId || SCAVENGER_HUNT_GAME_ID),
    title: String(data?.title || SCAVENGER_HUNT_GAME_TITLE),
    items,
    andyFoundCount: items.filter((item) => item.andyFound).length,
    savannahFoundCount: items.filter((item) => item.savannahFound).length,
    updatedAt: data?.updatedAt?.toDate?.() || null,
  };
};

const scavengerHuntDocumentData = ({ items = [] } = {}) => ({
  tripId: ROAD_TRIP_ID,
  gameId: SCAVENGER_HUNT_GAME_ID,
  title: SCAVENGER_HUNT_GAME_TITLE,
  items,
  updatedAt: serverTimestamp(),
});

export const createScavengerHuntPreviewState = () => normalizeScavengerHuntState(createScavengerHuntState());

export const subscribeToScavengerHunt = ({ onData, onError } = {}) =>
  onSnapshot(
    scavengerHuntGameDocument,
    (snapshot) => {
      onData?.(snapshot.exists() ? normalizeScavengerHuntState(snapshot.data()) : null);
    },
    onError
  );

export const ensureScavengerHuntGame = async () => {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(scavengerHuntGameDocument);

    if (snapshot.exists()) {
      return;
    }

    transaction.set(scavengerHuntGameDocument, createScavengerHuntState());
  });
};

export const toggleScavengerHuntItem = async ({ player = "", itemId = "" } = {}) => {
  const normalizedPlayer = playerFieldPrefix(player);
  const playerKey = normalizedPlayer === "andy" ? "andyFound" : "savannahFound";
  const normalizedItemId = String(itemId || "").trim();

  if (!normalizedItemId) {
    throw new Error("missing-scavenger-item-id");
  }

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(scavengerHuntGameDocument);
    const currentState = snapshot.exists()
      ? normalizeScavengerHuntState(snapshot.data())
      : normalizeScavengerHuntState(createScavengerHuntState());

    const nextItems = currentState.items.map((item) => (
      item.id === normalizedItemId
        ? { ...item, [playerKey]: !item[playerKey] }
        : item
    ));

    transaction.set(scavengerHuntGameDocument, scavengerHuntDocumentData({ items: nextItems }));
  });
};

export const addScavengerHuntItem = async (label = "") => {
  const trimmedLabel = String(label || "").trim();

  if (!trimmedLabel) {
    throw new Error("missing-scavenger-label");
  }

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(scavengerHuntGameDocument);
    const currentState = snapshot.exists()
      ? normalizeScavengerHuntState(snapshot.data())
      : normalizeScavengerHuntState(createScavengerHuntState());

    if (currentState.items.some((item) => item.label.toLowerCase() === trimmedLabel.toLowerCase())) {
      return;
    }

    transaction.set(
      scavengerHuntGameDocument,
      scavengerHuntDocumentData({
        items: [...currentState.items, createScavengerHuntItem(trimmedLabel, { isCustom: true })],
      })
    );
  });
};

export const subscribeToPhotoProofEntries = ({ onData, onError } = {}) =>
  onSnapshot(
    query(photoProofEntriesCollection, orderBy("createdAt", "desc"), limit(120)),
    (snapshot) => {
      onData?.(snapshot.docs.map((entryDoc) => normalizePhotoProofEntry(entryDoc.id, entryDoc.data())));
    },
    onError
  );

export const subscribeToPhotoProofVotes = (entryId, { onData, onError } = {}) => {
  const normalizedEntryId = String(entryId || "").trim();

  if (!normalizedEntryId) {
    onData?.([]);
    return () => {};
  }

  return onSnapshot(
    photoProofVotesCollection(normalizedEntryId),
    (snapshot) => {
      onData?.(snapshot.docs.map((voteDoc) => normalizePhotoProofVote(voteDoc.id, voteDoc.data())));
    },
    onError
  );
};

export const submitPhotoProofEntry = async ({
  userEmail = "",
  approvalPerson = "",
  challengeId = "",
  caption = "",
  file = null,
  sourcePage = "",
} = {}) => {
  const logger = resolveRoadTripLogger({ userEmail, approvalPerson });
  const normalizedChallenge = getPhotoProofChallengeMeta(challengeId);
  const trimmedCaption = String(caption || "").trim().slice(0, 180);

  if (!normalizedChallenge) {
    throw new Error("invalid-photo-proof-challenge");
  }

  if (!isRoadTripPlayer(logger.person)) {
    throw new Error("invalid-photo-proof-player");
  }

  if (!(file instanceof Blob)) {
    throw new Error("missing-photo-file");
  }

  const preparedFile = await preparePhotoProofImage(file);
  const normalizedMimeType = String(preparedFile.type || file.type || "image/jpeg").toLowerCase();
  const fileExtension = normalizedMimeType.includes("png") ? "png" : "jpg";
  const storagePath = `roadTrips/${ROAD_TRIP_ID}/photo-proof/${normalizedChallenge.id}/${Date.now()}-${logger.person}-${sanitizeStorageFileName(file.name || normalizedChallenge.id)}.${fileExtension}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, preparedFile, {
    contentType: normalizedMimeType || "image/jpeg",
    cacheControl: "public,max-age=3600",
  });

  const photoUrl = await getDownloadURL(storageRef);

  await addDoc(photoProofEntriesCollection, {
    tripId: ROAD_TRIP_ID,
    challengeId: normalizedChallenge.id,
    challengeLabel: normalizedChallenge.label,
    caption: trimmedCaption,
    photoUrl,
    photoPath: storagePath,
    uploaderPerson: logger.person,
    uploaderLabel: logger.personLabel,
    sourcePage: String(sourcePage || "").trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const togglePhotoProofVote = async ({ entryId = "", uid = "", voterLabel = "" } = {}) => {
  const normalizedEntryId = String(entryId || "").trim();
  const normalizedUid = String(uid || "").trim();

  if (!normalizedEntryId || !normalizedUid) {
    throw new Error("missing-photo-proof-vote-fields");
  }

  await runTransaction(db, async (transaction) => {
    const voteRef = photoProofVoteDocument(normalizedEntryId, normalizedUid);
    const voteSnapshot = await transaction.get(voteRef);

    if (voteSnapshot.exists()) {
      transaction.delete(voteRef);
      return;
    }

    transaction.set(voteRef, {
      tripId: ROAD_TRIP_ID,
      entryId: normalizedEntryId,
      uid: normalizedUid,
      voterLabel: String(voterLabel || "").trim(),
      createdAt: serverTimestamp(),
    });
  });
};

export const subscribeToAlphabetGame = ({ onData, onError } = {}) =>
  onSnapshot(
    alphabetGameDocument,
    (snapshot) => {
      onData?.(snapshot.exists() ? normalizeAlphabetGameState(snapshot.data()) : null);
    },
    onError
  );

export const ensureAlphabetGame = async () => {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(alphabetGameDocument);

    if (snapshot.exists()) {
      return;
    }

    transaction.set(alphabetGameDocument, createAlphabetGameState());
  });
};

export const recordAlphabetGameWin = async (player = "") => {
  const normalizedPlayer = playerFieldPrefix(player);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(alphabetGameDocument);
    const currentState = snapshot.exists() ? normalizeAlphabetGameState(snapshot.data()) : normalizeAlphabetGameState(createAlphabetGameState());

    transaction.set(alphabetGameDocument, createAlphabetGameState({
      andyWins: currentState.andyWins + (normalizedPlayer === "andy" ? 1 : 0),
      savannahWins: currentState.savannahWins + (normalizedPlayer === "savannah" ? 1 : 0),
      lastWinner: normalizedPlayer,
      lastWinnerLabel: normalizedPlayer === "andy" ? "Andy" : "Savannah",
      lastWonAt: serverTimestamp(),
    }));
  });
};

export const subscribeToKidsSaidItBingo = ({ onData, onError } = {}) =>
  onSnapshot(
    kidsSaidItBingoDocument,
    (snapshot) => {
      onData?.(snapshot.exists() ? normalizeBingoState(snapshot.data()) : null);
    },
    onError
  );

export const ensureKidsSaidItBingoGame = async () => {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(kidsSaidItBingoDocument);

    if (snapshot.exists()) {
      return;
    }

    transaction.set(kidsSaidItBingoDocument, createBingoGameState());
  });
};

export const toggleKidsSaidItBingoMark = async ({ player = "", index = -1 } = {}) => {
  const normalizedPlayer = playerFieldPrefix(player);
  const targetIndex = Number(index);

  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= BINGO_CELL_COUNT || targetIndex === BINGO_FREE_INDEX) {
    throw new Error("invalid-bingo-cell");
  }

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(kidsSaidItBingoDocument);
    const currentState = snapshot.exists() ? normalizeBingoState(snapshot.data()) : normalizeBingoState(createBingoGameState());
    const marksKey = `${normalizedPlayer}Marks`;
    const nextMarks = currentState[marksKey].includes(targetIndex)
      ? currentState[marksKey].filter((value) => value !== targetIndex)
      : [...currentState[marksKey], targetIndex];
    const normalizedMarks = normalizeMarks(nextMarks);

    if (hasBingo(normalizedMarks)) {
      transaction.set(
        kidsSaidItBingoDocument,
        createBingoGameState({
          round: Number(currentState.round || 1) + 1,
          andyWins: currentState.andyWins + (normalizedPlayer === "andy" ? 1 : 0),
          savannahWins: currentState.savannahWins + (normalizedPlayer === "savannah" ? 1 : 0),
          lastWinner: normalizedPlayer,
          lastWinnerLabel: normalizedPlayer === "andy" ? "Andy" : "Savannah",
          lastWonAt: serverTimestamp(),
        })
      );
      return;
    }

    transaction.set(kidsSaidItBingoDocument, {
      ...currentState,
      [marksKey]: normalizedMarks,
      updatedAt: serverTimestamp(),
    });
  });
};

export const startNextKidsSaidItBingoRound = async () => {
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(kidsSaidItBingoDocument);
    const currentState = snapshot.exists() ? normalizeBingoState(snapshot.data()) : normalizeBingoState(createBingoGameState());

    transaction.set(
      kidsSaidItBingoDocument,
      createBingoGameState({
        round: Number(currentState.round || 1) + (snapshot.exists() ? 1 : 0),
        andyWins: currentState.andyWins,
        savannahWins: currentState.savannahWins,
        lastWinner: currentState.lastWinner,
        lastWinnerLabel: currentState.lastWinnerLabel,
        lastWonAt: snapshot.exists() ? snapshot.data()?.lastWonAt || null : null,
      })
    );
  });
};