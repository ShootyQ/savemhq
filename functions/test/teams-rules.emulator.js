const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  setDoc,
  updateDoc,
} = require("firebase/firestore");
const { Firestore } = require("@google-cloud/firestore");
const { createService, inviteId } = require("../teams/service");
let env,
  db,
  service,
  n = 0;
let now = new Date("2026-10-30T12:00:00Z");
const PROJECT = "demo-teams";
const auth = (uid) => ({
  uid,
  token: {
    email:
      uid === "admin" ? "andrewpcarlson85@gmail.com" : uid + "@example.test",
    email_verified: true,
    name: uid.toUpperCase(),
  },
});
const send = (uid, action, options = {}) =>
  service(auth(uid), {
    action,
    roomId: "room",
    requestId: "request" + ++n,
    ...options,
  });
const create = () =>
  send("owner", "createRoom", {
    id: "room",
    payload: { name: "Launch team", description: "Shared work" },
  });
async function join(uid, role = "member") {
  const invitation = await send("owner", "invite", {
    payload: { email: uid + "@example.test", role },
  });
  await send(uid, "acceptInvite", { id: invitation.id });
  return invitation;
}
const web = (uid) => env.authenticatedContext(uid, auth(uid).token).firestore();
const project = () =>
  send("owner", "saveProject", {
    id: "project",
    payload: {
      title: "Website",
      description: "Build it",
      targetDate: "2026-11-10",
    },
  });
const task = (id = "task", assigneeUid = "member", extra = {}) =>
  send("owner", "saveTask", {
    id,
    payload: {
      title: "Build page",
      description: "Private team content",
      projectId: "project",
      assigneeUid,
      status: "todo",
      priority: "high",
      dueDate: "2026-11-01",
      ...extra,
    },
  });
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw Error("Emulator required");
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
    },
  });
  db = new Firestore({ projectId: PROJECT });
  service = createService(db, () => now);
});
after(async () => {
  await env?.cleanup();
  await db?.terminate();
});
beforeEach(async () => {
  await env.clearFirestore();
  now = new Date("2026-10-30T12:00:00Z");
  for (const uid of [
    "owner",
    "member",
    "leader",
    "outsider",
    "pending",
    "revoked",
    "noDesk",
    "admin",
  ])
    await db
      .doc("loginApprovals/" + uid)
      .set({
        email: auth(uid).token.email,
        status: ["pending", "revoked"].includes(uid) ? uid : "approved",
        accessSections: uid === "noDesk" ? ["business"] : ["desk"],
      });
  await create();
});
test("room isolation, signed-out/pending/revoked users and browser writes are denied", async () => {
  await join("member");
  await project();
  await task();
  for (const path of [
    "teamRooms/room",
    "teamRooms/room/projects/project",
    "teamRooms/room/tasks/task",
    "teamRooms/room/members/owner",
  ]) {
    await assertSucceeds(getDoc(doc(web("member"), path)));
    for (const ctx of [
      env.unauthenticatedContext(),
      ...["outsider", "pending", "revoked", "noDesk", "admin"].map((uid) =>
        env.authenticatedContext(uid, auth(uid).token),
      ),
    ])
      await assertFails(getDoc(doc(ctx.firestore(), path)));
    await assertFails(setDoc(doc(web("owner"), path), { ownerUid: "member" }));
  }
  await assertSucceeds(
    getDocs(collection(web("member"), "teamRooms/room/tasks")),
  );
  await assertFails(getDocs(collection(web("owner"), "teamRooms")));
  await assertSucceeds(
    getDocs(collection(web("member"), "teamUsers/member/rooms")),
  );
  await assertFails(
    getDocs(collection(web("outsider"), "teamUsers/member/rooms")),
  );
  await assertFails(
    setDoc(doc(web("member"), "teamUsers/member/rooms/fake"), {
      role: "owner",
    }),
  );
  await db.doc("workrooms/owner/tasks/personal").set({ title: "Owner only" });
  await assertFails(
    getDoc(doc(web("member"), "workrooms/owner/tasks/personal")),
  );
  await assertFails(
    getDoc(doc(web("owner"), "teamUsers/owner/requests/request1")),
  );
});
test("invitations bind verified email, role, expiry, explicit acceptance and Desk approval", async () => {
  const invitation = await send("owner", "invite", {
    payload: { email: "MEMBER@example.test", role: "leader" },
  });
  assert.equal(invitation.id, inviteId("room", "member@example.test"));
  await assertSucceeds(
    getDocs(
      query(
        collection(web("member"), "teamInvites"),
        where("email", "==", "member@example.test"),
        where("status", "==", "pending"),
      ),
    ),
  );
  await assertSucceeds(
    getDocs(
      query(
        collection(web("owner"), "teamInvites"),
        where("roomId", "==", "room"),
        where("status", "==", "pending"),
      ),
    ),
  );
  await assertFails(
    getDoc(doc(web("outsider"), "teamInvites/" + invitation.id)),
  );
  await assertFails(
    getDoc(
      doc(
        env
          .authenticatedContext("member", {
            email: "member@example.test",
            email_verified: false,
          })
          .firestore(),
        "teamInvites/" + invitation.id,
      ),
    ),
  );
  await assert.rejects(
    send("outsider", "acceptInvite", { id: invitation.id }),
    /different email/,
  );
  await assert.rejects(
    service(
      {
        ...auth("member"),
        token: { ...auth("member").token, email_verified: false },
      },
      { action: "acceptInvite", requestId: "unverified", id: invitation.id },
    ),
    /verified/,
  );
  await assert.rejects(
    send("pending", "acceptInvite", { id: invitation.id }),
    /Desk access/,
  );
  await send("member", "acceptInvite", { id: invitation.id });
  assert.equal(
    (await db.doc("teamRooms/room/members/member").get()).data().role,
    "leader",
  );
  await assert.rejects(
    send("member", "acceptInvite", { id: invitation.id }),
    /no longer pending/,
  );
  const expired = await send("owner", "invite", {
    payload: { email: "outsider@example.test", role: "member" },
  });
  now = new Date("2026-11-15T12:00:00Z");
  await assert.rejects(
    send("outsider", "acceptInvite", { id: expired.id }),
    /expired/,
  );
});
test("members cannot escalate roles, assign other people or manage invitations; owner protected", async () => {
  await join("member");
  await project();
  await task();
  for (const [action, options] of [
    ["invite", { payload: { email: "outsider@example.test", role: "leader" } }],
    ["setRole", { id: "owner", version: 1, payload: { role: "member" } }],
    ["saveProject", { id: "fake", payload: { title: "No" } }],
    [
      "saveTask",
      { id: "fake", payload: { projectId: "project", title: "No" } },
    ],
    ["archiveRoom", { version: 1, payload: { archived: true } }],
  ])
    await assert.rejects(send("member", action, options), /owner|leader/);
  await assert.rejects(
    send("owner", "removeMember", { id: "owner", version: 1 }),
    /owner cannot/,
  );
  await assert.rejects(
    send("owner", "setRole", {
      id: "owner",
      version: 1,
      payload: { role: "member" },
    }),
    /owner cannot/,
  );
  await send("owner", "setRole", {
    id: "member",
    version: 1,
    payload: { role: "leader" },
  });
  await send("member", "saveProject", {
    id: "allowed",
    payload: { title: "Leader project" },
  });
});
test("canonical tasks update from Desk, enforce assignee policy, retain rates of progress and comments", async () => {
  await join("member");
  await join("leader", "leader");
  await project();
  await task();
  await assert.rejects(
    send("outsider", "taskStatus", {
      id: "task",
      version: 1,
      payload: { status: "done" },
    }),
    /belong/,
  );
  await send("member", "taskStatus", {
    id: "task",
    version: 1,
    payload: { status: "in-progress" },
  });
  await send("member", "comment", {
    id: "task",
    version: 2,
    payload: { body: "Working on it" },
  });
  await send("member", "taskStatus", {
    id: "task",
    version: 3,
    payload: { status: "done" },
  });
  assert.equal(
    (await db.doc("teamRooms/room/tasks/task").get()).data().status,
    "done",
  );
  assert.equal((await db.collection("teamRooms/room/comments").get()).size, 1);
  assert.equal(
    (await db.collection("workrooms/member/tasks").get()).size,
    0,
    "no mirrored tasks",
  );
  await task("other", "leader");
  await assert.rejects(
    send("member", "taskStatus", {
      id: "other",
      version: 1,
      payload: { status: "done" },
    }),
    /only your assigned/,
  );
  await send("leader", "taskStatus", {
    id: "other",
    version: 1,
    payload: { status: "cancelled" },
  });
});
test("retries are idempotent and concurrent edits/claims cannot overwrite", async () => {
  await join("member");
  await join("leader");
  await project();
  await task("task", "");
  const request = {
    action: "comment",
    roomId: "room",
    id: "task",
    version: 1,
    requestId: "same_request",
    payload: { body: "One comment" },
  };
  await Promise.all([
    service(auth("member"), request),
    service(auth("member"), request),
  ]);
  assert.equal((await db.collection("teamRooms/room/comments").get()).size, 1);
  await assert.rejects(
    service(auth("member"), { ...request, payload: { body: "Different" } }),
    /different change/,
  );
  const results = await Promise.allSettled(
    ["member", "leader"].map((uid) =>
      send(uid, "claimTask", { id: "task", version: 2 }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const saved = (await db.doc("teamRooms/room/tasks/task").get()).data();
  assert.equal(saved.version, 3);
  assert.ok(["leader", "member"].includes(saved.assigneeUid));
  await assert.rejects(
    send("owner", "taskStatus", {
      id: "task",
      version: 2,
      payload: { status: "done" },
    }),
    /changed/,
  );
});
test("concurrent accept counts memberships once; revocation and removal block old links and reads", async () => {
  const invitation = await send("owner", "invite", {
    payload: { email: "member@example.test", role: "member" },
  });
  const results = await Promise.allSettled([
    send("member", "acceptInvite", { id: invitation.id }),
    send("member", "acceptInvite", { id: invitation.id }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await db.doc("teamRooms/room").get()).data().memberCount, 2);
  await project();
  await task();
  await send("owner", "removeMember", { id: "member", version: 1 });
  await assertFails(getDoc(doc(web("member"), "teamRooms/room/tasks/task")));
  await assert.rejects(
    send("member", "taskStatus", {
      id: "task",
      version: 1,
      payload: { status: "done" },
    }),
    /belong/,
  );
  await assert.rejects(
    send("member", "acceptInvite", { id: invitation.id }),
    /no longer pending/,
  );
  assert.equal(
    (await db.doc("teamRooms/room/tasks/task").get()).data().assigneeUid,
    "member",
  );
  assert.equal((await db.doc("teamUsers/member").get()).data().roomCount, 0);
  assert.equal(
    (await db.doc("teamUsers/member/rooms/room").get()).exists,
    false,
  );
  const newInvite = await send("owner", "invite", {
    payload: { email: "member@example.test", role: "member" },
  });
  await send("owner", "revokeInvite", { id: newInvite.id });
  await assert.rejects(
    send("member", "acceptInvite", { id: newInvite.id }),
    /no longer pending/,
  );
});
test("archiving preserves history and blocks work; restoring enables it again", async () => {
  await join("member");
  await project();
  await task();
  await send("owner", "archiveProject", {
    id: "project",
    version: 1,
    payload: { archived: true },
  });
  assert.equal(
    (await db.doc("teamRooms/room/tasks/task").get()).data().projectArchived,
    true,
  );
  await assert.rejects(
    send("member", "taskStatus", {
      id: "task",
      version: 2,
      payload: { status: "done" },
    }),
    /archived/,
  );
  await send("owner", "archiveProject", {
    id: "project",
    version: 2,
    payload: { archived: false },
  });
  await send("owner", "archiveRoom", {
    version: 1,
    payload: { archived: true },
  });
  assert.equal(
    (await db.doc("teamUsers/member/rooms/room").get()).data().archived,
    true,
  );
  await assertSucceeds(getDoc(doc(web("member"), "teamRooms/room/tasks/task")));
  await assert.rejects(
    send("member", "taskStatus", {
      id: "task",
      version: 3,
      payload: { status: "done" },
    }),
    /archived/,
  );
  await send("owner", "archiveRoom", {
    version: 2,
    payload: { archived: false },
  });
  await send("member", "taskStatus", {
    id: "task",
    version: 3,
    payload: { status: "done" },
  });
});
test("revoking Desk approval ends shared reads and server commands immediately", async () => {
  await join("member");
  await project();
  await task();
  await db.doc("loginApprovals/member").update({ status: "revoked" });
  await assertFails(getDoc(doc(web("member"), "teamRooms/room")));
  await assertFails(
    getDocs(collection(web("member"), "teamUsers/member/rooms")),
  );
  await assert.rejects(
    send("member", "taskStatus", {
      id: "task",
      version: 1,
      payload: { status: "done" },
    }),
    /Desk access/,
  );
});
test("invalid links, oversized content, foreign assignments and limits reject without partial writes", async () => {
  await join("member");
  await project();
  await assert.rejects(task("bad", "outsider"), /current room member/);
  await assert.rejects(
    task("bad", "member", { dueDate: "2026-02-30" }),
    /valid date/,
  );
  await assert.rejects(
    task("bad", "member", { title: "x".repeat(201) }),
    /valid text/,
  );
  await assert.rejects(
    task("bad", "member", { projectId: "missing" }),
    /unavailable/,
  );
  assert.equal((await db.collection("teamRooms/room/tasks").get()).size, 0);
  assert.equal((await db.doc("teamRooms/room").get()).data().taskCount, 0);
  await db.doc("teamRooms/room").update({ taskCount: 300 });
  await assert.rejects(task(), /Pilot limit/);
  await assert.rejects(
    send("owner", "saveTask", { id: "../../bad" }),
    /identifier/,
  );
});

test("request IDs from different actors cannot overwrite comments or activity", async () => {
  await join("member");
  await join("leader", "leader");
  await project();
  await task();
  const command = {
    action: "comment",
    roomId: "room",
    id: "task",
    requestId: "shared_request_id",
    version: 1,
    payload: { body: "Member comment" },
  };
  await service(auth("member"), command);
  await service(auth("leader"), {
    ...command,
    version: 2,
    payload: { body: "Leader comment" },
  });
  const comments = await db.collection("teamRooms/room/comments").get();
  assert.equal(comments.size, 2);
  assert.deepEqual(
    new Set(comments.docs.map((d) => d.data().authorUid)),
    new Set(["member", "leader"]),
  );
  const events = await db
    .collection("teamRooms/room/activity")
    .where("action", "==", "comment")
    .get();
  assert.equal(events.size, 2);
});
