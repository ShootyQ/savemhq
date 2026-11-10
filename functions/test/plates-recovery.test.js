const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../js/plates/legacy-recovery");
const M = require("../../js/plates/model");
test("verified February archive has the original 28/29 state lists and Savannah’s win", () => {
  assert.equal(R.archive.andyStates.length, 28);
  assert.equal(R.archive.savannahStates.length, 29);
  assert.ok(R.archive.andyStates.includes("District of Columbia"));
  assert.ok(R.archive.savannahStates.includes("Alabama"));
  assert.ok(!R.archive.andyStates.includes("Alabama"));
  assert.equal(new Set(R.archive.andyStates).size, 28);
  assert.equal(new Set(R.archive.savannahStates).size, 29);
  assert.match(R.SOURCE, /c2ad9b777b79a94440d2ea6bdd8ca6510bf1a076/);
  const recovered = R.plan(null, R.fingerprint(null));
  const stats = M.seasonStats(
    M.buildMonths([{ id: "february", ...recovered.patch }]),
  );
  assert.equal(stats.wins.savannah, 1);
  assert.equal(stats.wins.andy, 0);
});
test("recovery allows only missing or empty records and does not mutate the baseline", () => {
  for (const current of [
    null,
    {},
    { locked: true, andyStates: [], savannahStates: [], manualCounts: null },
    { andyStates: [], manualCounts: { andy: null, savannah: null } },
  ]) {
    const original = structuredClone(current);
    assert.equal(R.canRestore(current), true);
    const result = R.plan(current, R.fingerprint(current));
    assert.equal(result.patch.locked, true);
    assert.equal(result.patch.andyStates.length, 28);
    assert.deepEqual(current, original);
    result.patch.andyStates.push("Not in archive");
    assert.equal(R.archive.andyStates.length, 28);
  }
});
test("nonempty state lists, manual totals including zero, and malformed values cannot be overwritten", () => {
  for (const current of [
    { andyStates: ["Minnesota"] },
    { savannahStates: ["Iowa"] },
    { manualCounts: { andy: 28, savannah: 29 } },
    { manualCounts: { andy: 0, savannah: 0 } },
    { manualCounts: { andy: 5 } },
    { andyStates: "Minnesota" },
  ]) {
    assert.equal(R.canRestore(current), false);
    assert.throws(
      () => R.plan(current, R.fingerprint(current)),
      /will not overwrite/,
    );
  }
});
test("changed scores or lock metadata reject stale recovery previews", () => {
  const base = { andyStates: [], savannahStates: [], locked: false };
  for (const changed of [
    { locked: true },
    { andyStates: ["Iowa"] },
    { lockedAt: "2026-11-10T12:00:00Z" },
    { manualCounts: { andy: 0, savannah: 0 } },
  ])
    assert.throws(
      () => R.plan({ ...base, ...changed }, R.fingerprint(base)),
      /changed while/,
    );
});
test("a repeated successful restoration is a no-op; later unlocked or edited records are not reset", () => {
  const restored = {
    ...R.plan(null, R.fingerprint(null)).patch,
    historicalRecovery: { source: R.SOURCE },
  };
  assert.deepEqual(R.plan(restored, R.fingerprint(null)), {
    alreadyRestored: true,
  });
  assert.throws(
    () => R.plan({ ...restored, locked: false }, R.fingerprint(null)),
    /changed while/,
  );
  assert.throws(
    () =>
      R.plan({ ...restored, andyStates: ["Minnesota"] }, R.fingerprint(null)),
    /changed while/,
  );
});
test("public scoreboard remains authoritative and never uses this archive as a fallback", () => {
  const feb = M.buildMonths([
    { id: "february", locked: true, andyStates: [], savannahStates: [] },
  ])[1];
  assert.equal(feb.andy, 0);
  assert.equal(feb.savannah, 0);
  assert.equal(feb.winner, null);
});
