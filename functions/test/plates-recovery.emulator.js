const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const sdk = require("firebase/firestore");
const R = require("../../js/plates/legacy-recovery"),
  Model = require("../../js/admin/model"),
  Scores = require("../../js/plates/model");
let env;
const projectId = "demo-plate-recovery",
  adminEmail = "andrewpcarlson85@gmail.com",
  target = "competitions/2026/months/february";
function api(uid = "admin", email = adminEmail) {
  const db = env.authenticatedContext(uid, { email }).firestore();
  const code = readFileSync(resolve(__dirname, "../../js/admin/api.js"), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/^export \{.*\};\n?/gm, "")
    .replace(/^export /gm, "");
  const deps = {
    ...Object.fromEntries(
      [
        "collection",
        "doc",
        "onSnapshot",
        "runTransaction",
        "serverTimestamp",
        "deleteField",
      ].map((name) => [name, sdk[name]]),
    ),
    auth: { currentUser: { uid, email } },
    db,
    ADMIN_EMAIL: adminEmail,
    ACCESS_SECTIONS: [],
    getKnownUserProfile: () => null,
    initHeaderAuth: () => {},
    window: { AdminModel: Model, PlateRecovery: R },
  };
  return {
    db,
    ...Function(
      ...Object.keys(deps),
      code + ";return {restoreFebruary,setMonthLock};",
    )(...Object.values(deps)),
  };
}
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Firestore emulator required");
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await sdk.setDoc(
      sdk.doc(ctx.firestore(), "competitions/2026/months/january"),
      {
        locked: true,
        manualCounts: { andy: 28, savannah: 29 },
        andyStates: [],
        savannahStates: [],
      },
    );
    await sdk.setDoc(sdk.doc(ctx.firestore(), "loginApprovals/family"), {
      status: "approved",
      accessSections: ["plates"],
    });
  });
});
test("missing February is restored, finalized and audited; January remains untouched", async () => {
  const client = api();
  const janBefore = (
    await sdk.getDoc(sdk.doc(client.db, "competitions/2026/months/january"))
  ).data();
  await client.restoreFebruary(null);
  const saved = (await sdk.getDoc(sdk.doc(client.db, target))).data();
  assert.deepEqual(saved.andyStates, R.archive.andyStates);
  assert.deepEqual(saved.savannahStates, R.archive.savannahStates);
  assert.equal(saved.locked, true);
  assert.equal(saved.lockedBy, adminEmail);
  assert.equal(saved.historicalRecovery.previousRecord, null);
  assert.equal(saved.historicalRecovery.source, R.SOURCE);
  assert.ok(saved.historicalRecovery.restoredAt.toMillis() > 0);
  assert.deepEqual(
    (
      await sdk.getDoc(sdk.doc(client.db, "competitions/2026/months/january"))
    ).data(),
    janBefore,
  );
  assert.equal(
    Scores.seasonStats(Scores.buildMonths([{ id: "february", ...saved }])).wins
      .savannah,
    1,
  );
});
test("empty existing record keeps unrelated fields, prior lock metadata, and the complete pre-recovery record", async () => {
  const client = api(),
    ref = sdk.doc(client.db, target);
  const before = {
    month: "February",
    order: 1,
    locked: true,
    lockedAt: sdk.Timestamp.fromMillis(1770000000000),
    lockedBy: "original-admin@example.test",
    notes: "Keep this history",
    andyStates: [],
    savannahStates: [],
    manualCounts: null,
  };
  await sdk.setDoc(ref, before);
  await client.restoreFebruary(before);
  const saved = (await sdk.getDoc(ref)).data();
  assert.equal(saved.notes, before.notes);
  assert.deepEqual(saved.lockedAt, before.lockedAt);
  assert.equal(saved.lockedBy, before.lockedBy);
  assert.deepEqual(saved.historicalRecovery.previousRecord, before);
});
test("nonempty/manual scores and concurrently changed records are rejected without writes", async () => {
  const client = api(),
    ref = sdk.doc(client.db, target);
  for (const value of [
    { andyStates: ["Minnesota"], savannahStates: [], locked: false },
    { manualCounts: { andy: 0, savannah: 0 }, locked: true },
  ]) {
    await sdk.setDoc(ref, value);
    await assert.rejects(client.restoreFebruary(value), /will not overwrite/);
    assert.deepEqual((await sdk.getDoc(ref)).data(), value);
  }
  await sdk.setDoc(ref, { locked: true, andyStates: [], savannahStates: [] });
  await assert.rejects(
    client.restoreFebruary({
      locked: false,
      andyStates: [],
      savannahStates: [],
    }),
    /changed while/,
  );
  assert.equal((await sdk.getDoc(ref)).data().historicalRecovery, undefined);
});
test("concurrent recovery and uncertain retries leave one immutable recovery audit", async () => {
  const client = api();
  const result = await Promise.all([
    client.restoreFebruary(null),
    client.restoreFebruary(null),
  ]);
  assert.equal(result.filter((r) => r.alreadyRestored).length, 1);
  const ref = sdk.doc(client.db, target),
    saved = (await sdk.getDoc(ref)).data();
  await client.restoreFebruary(null);
  assert.deepEqual((await sdk.getDoc(ref)).data(), saved);
});
test("signed-out and non-admin users cannot finalize or audit a recovery through existing rules", async () => {
  await assert.rejects(
    api("family", "savannahbcarlson@gmail.com").restoreFebruary(null),
    /administrator/,
  );
  for (const context of [
    env.unauthenticatedContext(),
    env.authenticatedContext("family", { email: "savannahbcarlson@gmail.com" }),
    env.authenticatedContext("other", { email: "other@example.test" }),
  ])
    await assertFails(
      sdk.setDoc(sdk.doc(context.firestore(), target), {
        ...R.plan(null, R.fingerprint(null)).patch,
        historicalRecovery: { source: R.SOURCE },
      }),
    );
});
