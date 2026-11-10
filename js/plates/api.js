import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../auth-shared.js";
// This public view is strictly read-only: no bootstrapping or fallback writes.
export const watchCompetition = (next, error) =>
  onSnapshot(
    collection(
      db,
      "competitions",
      String(globalThis.PlateModel.YEAR),
      "months",
    ),
    { includeMetadataChanges: true },
    (snapshot) =>
      next({
        records: snapshot.docs.map((record) => ({
          ...record.data(),
          id: record.id,
        })),
        fromCache: snapshot.metadata.fromCache,
      }),
    error,
  );
