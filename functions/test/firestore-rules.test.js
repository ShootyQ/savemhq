const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { after, before, beforeEach, test } = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, Timestamp } = require("firebase/firestore");

const PROJECT_ID = "savemhq-desk-rules-test";
const ADMIN_UID = "admin-user";
const ADMIN_EMAIL = "andrewpcarlson85@gmail.com";
const DESK_UID = "approved-desk-user";
const OTHER_UID = "other-desk-user";
const PENDING_UID = "pending-user";
let testEnvironment;

const authedDb = (uid, email) => testEnvironment.authenticatedContext(uid, { email }).firestore();
const profile = (uid, email, modules = ["tasks", "ideas"]) => ({
  ownerUid: uid,
  email,
  displayName: "Desk User",
  workspaceName: "My Desk",
  presetId: "simple",
  enabledModules: modules,
  onboardingComplete: true,
  schemaVersion: 1,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8") },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "loginApprovals", DESK_UID), { status: "approved", accessSections: ["desk"] }),
      setDoc(doc(database, "loginApprovals", OTHER_UID), { status: "approved", accessSections: ["desk"] }),
      setDoc(doc(database, "loginApprovals", PENDING_UID), { status: "pending", accessSections: [] }),
    ]);
  });
});

after(async () => testEnvironment?.cleanup());

test("approved Desk users can create and read only their own profile", async () => {
  const database = authedDb(DESK_UID, "desk@example.com");
  await assertSucceeds(setDoc(doc(database, "workrooms", DESK_UID), profile(DESK_UID, "desk@example.com")));
  await assertSucceeds(getDoc(doc(database, "workrooms", DESK_UID)));
  await assertFails(getDoc(doc(database, "workrooms", OTHER_UID)));
});

test("pending users cannot create a Desk profile", async () => {
  const database = authedDb(PENDING_UID, "pending@example.com");
  await assertFails(setDoc(doc(database, "workrooms", PENDING_UID), profile(PENDING_UID, "pending@example.com")));
});

test("profile validation requires tasks and rejects unknown modules", async () => {
  const database = authedDb(DESK_UID, "desk@example.com");
  await assertFails(setDoc(doc(database, "workrooms", DESK_UID), profile(DESK_UID, "desk@example.com", ["ideas"])));
  await assertFails(setDoc(doc(database, "workrooms", DESK_UID), profile(DESK_UID, "desk@example.com", ["tasks", "unknown"])));
});

test("Ideas accept the supported schema and reject invalid status", async () => {
  const database = authedDb(DESK_UID, "desk@example.com");
  const reference = doc(database, "workrooms", DESK_UID, "ideas", "sermon-note");
  const idea = { title: "Grace", body: "Opening thought", tags: ["sermon"], status: "developing", createdAt: Timestamp.now(), updatedAt: Timestamp.now() };
  await assertSucceeds(setDoc(reference, idea));
  await assertFails(setDoc(reference, { ...idea, status: "published" }));
});

test("cross-UID writes and server-only collections remain denied", async () => {
  const database = authedDb(DESK_UID, "desk@example.com");
  await assertFails(setDoc(doc(database, "workrooms", OTHER_UID, "tasks", "task-1"), { title: "No", projectId: "", status: "next", priority: "medium", dueDate: null, notes: "", completedAt: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
  await assertFails(getDoc(doc(database, "workroomSecrets", `${DESK_UID}_google`)));
  await assertFails(getDoc(doc(database, "workroomAutomationAudit", DESK_UID, "entries", "entry-1")));
});

test("the legacy admin can still read their existing root document", async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "workrooms", ADMIN_UID), { title: "The Workroom" }));
  await assertSucceeds(getDoc(doc(authedDb(ADMIN_UID, ADMIN_EMAIL), "workrooms", ADMIN_UID)));
});