/* Verified historical source, not a public scoreboard fallback. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PlateRecovery = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SOURCE =
    "git:c2ad9b777b79a94440d2ea6bdd8ca6510bf1a076:states-competition.html";
  const archive = {
    year: 2026,
    month: "February",
    id: "february",
    order: 1,
    andyStates: [
      "Arizona",
      "California",
      "Colorado",
      "Delaware",
      "Florida",
      "Georgia",
      "Idaho",
      "Illinois",
      "Iowa",
      "Kansas",
      "Louisiana",
      "Maryland",
      "Michigan",
      "Minnesota",
      "Missouri",
      "New York",
      "North Carolina",
      "North Dakota",
      "Ohio",
      "Oklahoma",
      "Oregon",
      "South Dakota",
      "Tennessee",
      "Texas",
      "Virginia",
      "District of Columbia",
      "Washington",
      "Wisconsin",
    ],
    savannahStates: [
      "Alabama",
      "Arizona",
      "California",
      "Colorado",
      "Delaware",
      "Florida",
      "Illinois",
      "Indiana",
      "Iowa",
      "Louisiana",
      "Maryland",
      "Massachusetts",
      "Michigan",
      "Minnesota",
      "Mississippi",
      "Missouri",
      "Nebraska",
      "New Jersey",
      "New Mexico",
      "North Dakota",
      "Ohio",
      "Oregon",
      "Pennsylvania",
      "South Carolina",
      "South Dakota",
      "Tennessee",
      "Texas",
      "Virginia",
      "Wisconsin",
    ],
  };
  Object.freeze(archive.andyStates);
  Object.freeze(archive.savannahStates);
  Object.freeze(archive);
  const emptyStates = (value) =>
    value == null || (Array.isArray(value) && value.length === 0);
  const emptyManual = (value) =>
    value == null ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((v) => v == null || v === ""));
  const canRestore = (record) =>
    record == null ||
    (emptyStates(record.andyStates) &&
      emptyStates(record.savannahStates) &&
      emptyManual(record.manualCounts));
  function fingerprint(record) {
    return JSON.stringify(
      record == null
        ? null
        : {
            month: record.month ?? null,
            order: record.order ?? null,
            andyStates: record.andyStates ?? null,
            savannahStates: record.savannahStates ?? null,
            manualCounts: record.manualCounts ?? null,
            locked: record.locked === true,
            lockedAt: record.lockedAt ?? null,
            lockedBy: record.lockedBy ?? null,
          },
    );
  }
  function plan(current, expected) {
    if (
      current?.historicalRecovery?.source === SOURCE &&
      current.locked === true &&
      emptyManual(current.manualCounts) &&
      JSON.stringify(current.andyStates) ===
        JSON.stringify(archive.andyStates) &&
      JSON.stringify(current.savannahStates) ===
        JSON.stringify(archive.savannahStates)
    )
      return { alreadyRestored: true };
    if (fingerprint(current) !== expected)
      throw Error(
        "February changed while you reviewed it. Check the latest record and try again.",
      );
    if (!canRestore(current))
      throw Error(
        "February already contains recorded values. Recovery will not overwrite existing scores or state lists.",
      );
    return {
      alreadyRestored: false,
      patch: {
        month: archive.month,
        order: archive.order,
        andyStates: [...archive.andyStates],
        savannahStates: [...archive.savannahStates],
        locked: true,
      },
    };
  }
  return { SOURCE, archive, canRestore, fingerprint, plan };
});
