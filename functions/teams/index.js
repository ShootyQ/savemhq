"use strict";
const admin = require("firebase-admin");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { createService } = require("./service");
const service = createService(admin.firestore());
exports.teamCommand = onCall({ maxInstances: 10 }, async (request) => {
  try {
    return await service(request.auth, request.data || {});
  } catch (error) {
    const codes = [
      "unauthenticated",
      "permission-denied",
      "failed-precondition",
      "invalid-argument",
      "aborted",
    ];
    if (codes.includes(error.code))
      throw new HttpsError(error.code, error.message);
    // Shared validation errors contain only fixed, safe messages.
    if (!error.code && error instanceof Error)
      throw new HttpsError("invalid-argument", error.message);
    console.error("Team command failed", { code: error.code });
    throw new HttpsError(
      "internal",
      "Unable to save. Your entries are still here; try again.",
    );
  }
});
