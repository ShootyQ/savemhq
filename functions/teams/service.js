"use strict";
const { createHash } = require("node:crypto");
const M = require("./model");
const ADMIN = "andrewpcarlson85@gmail.com";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const inviteId = (roomId, email) => hash(roomId + "\n" + email.toLowerCase());
const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
const fail = (message, code = "failed-precondition") => {
  const error = Error(message);
  error.code = code;
  throw error;
};
const id = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    fail("Invalid record identifier.", "invalid-argument");
  return value;
};
function createService(db, clock = () => new Date()) {
  return async function command(auth, input) {
    if (!auth?.uid) fail("Sign in to continue.", "unauthenticated");
    const uid = id(auth.uid),
      action = input?.action,
      requestId = id(input?.requestId),
      p = input.payload || {};
    const fingerprint = hash(stable(input));
    const now = clock().toISOString();
    const eventId = hash(uid + "\n" + requestId);
    return db.runTransaction(async (tx) => {
      const get = async (path) => (await tx.get(db.doc(path))).data();
      const list = async (query) =>
        (await tx.get(query)).docs.map((d) => ({ id: d.id, ...d.data() }));
      const writes = [];
      const set = (path, data, merge = false) =>
        writes.push(() => tx.set(db.doc(path), data, { merge }));
      const del = (path) => writes.push(() => tx.delete(db.doc(path)));
      const approval = await get("loginApprovals/" + uid);
      if (
        auth.token?.email !== ADMIN &&
        !(
          approval?.status === "approved" &&
          approval.accessSections?.includes("desk")
        )
      )
        fail("Approved Desk access is required.", "permission-denied");
      const receiptPath = `teamUsers/${uid}/requests/${requestId}`,
        receipt = await get(receiptPath);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail("This request was already used for a different change.");
        return receipt.result;
      }
      const display = M.text(
        auth.token?.name || auth.token?.email || "Member",
        254,
      );
      const email = M.email(auth.token?.email || "");
      const accountPath = `teamUsers/${uid}`,
        account = (await get(accountPath)) || { roomCount: 0 };
      let roomId = input.roomId ? id(input.roomId) : null,
        result = {};
      const addDirectory = (memberUid, room, role) =>
        set(`teamUsers/${memberUid}/rooms/${roomId}`, {
          name: room.name,
          role,
          archived: room.archived,
          roomId,
        });
      if (action === "createRoom") {
        roomId = id(input.id);
        if (account.roomCount >= 20) fail("You can join up to 20 team rooms.");
        if (await get("teamRooms/" + roomId)) fail("This room already exists.");
        const room = {
          name: M.text(p.name),
          description: M.text(p.description || "", 2000, false),
          ownerUid: uid,
          archived: false,
          memberCount: 1,
          projectCount: 0,
          taskCount: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        set("teamRooms/" + roomId, room);
        set(`teamRooms/${roomId}/members/${uid}`, {
          uid,
          email,
          name: display,
          role: "owner",
          joinedAt: now,
          version: 1,
        });
        addDirectory(uid, room, "owner");
        set(accountPath, { roomCount: account.roomCount + 1 });
        result = { roomId };
      } else if (action === "acceptInvite") {
        if (!auth.token?.email_verified)
          fail(
            "Use a verified Google email to accept this invitation.",
            "permission-denied",
          );
        const invitationPath = "teamInvites/" + id(input.id),
          invitation = await get(invitationPath);
        if (!invitation || invitation.email !== email)
          fail(
            "This invitation belongs to a different email address.",
            "permission-denied",
          );
        roomId = invitation.roomId;
        const room = await get("teamRooms/" + roomId),
          member = await get(`teamRooms/${roomId}/members/${uid}`);
        if (!room || room.archived)
          fail("This room is archived or unavailable.");
        if (invitation.status !== "pending" || invitation.expiresAt <= now)
          fail(
            "This invitation expired or is no longer pending. Ask the owner to invite you again.",
          );
        if (member) fail("You already belong to this room.");
        if (room.memberCount >= 50 || account.roomCount >= 20)
          fail("The room or account membership limit has been reached.");
        const role = M.choice(invitation.role, ["member", "leader"]);
        set(`teamRooms/${roomId}/members/${uid}`, {
          uid,
          email,
          name: display,
          role,
          joinedAt: now,
          version: 1,
        });
        addDirectory(uid, room, role);
        set(accountPath, { roomCount: account.roomCount + 1 });
        set(
          "teamRooms/" + roomId,
          { memberCount: room.memberCount + 1, updatedAt: now },
          true,
        );
        set(
          invitationPath,
          { status: "accepted", acceptedBy: uid, acceptedAt: now },
          true,
        );
        result = { roomId };
      } else {
        id(roomId);
        const base = `teamRooms/${roomId}`,
          room = await get(base),
          member = await get(`${base}/members/${uid}`);
        if (!room || !member)
          fail("You no longer belong to this team room.", "permission-denied");
        const manager = M.manages(member.role),
          owner = member.role === "owner";
        const mustManage = () => {
          if (!manager)
            fail(
              "An owner or leader must make this change.",
              "permission-denied",
            );
        };
        const mustOwn = () => {
          if (!owner)
            fail(
              "Only the room owner can manage membership.",
              "permission-denied",
            );
        };
        const version = (record) => {
          if (!record) fail("This record is unavailable.");
          if (input.version !== record.version)
            fail(
              "This record changed. Reopen it to load the latest version.",
              "aborted",
            );
        };
        if (
          room.archived &&
          !["archiveRoom", "removeMember", "revokeInvite"].includes(action)
        )
          fail("This room is archived. Restore it before making changes.");
        if (action === "invite") {
          mustOwn();
          const targetEmail = M.email(p.email),
            role = M.choice(p.role, ["member", "leader"]);
          if (targetEmail === email) fail("You already own this room.");
          const existingMembers = await list(
            db.collection(base + "/members").where("email", "==", targetEmail),
          );
          if (existingMembers.length) fail("This person is already a member.");
          const key = inviteId(roomId, targetEmail),
            path = "teamInvites/" + key,
            previous = await get(path);
          // Each email has one invitation per room; revoked/accepted invitations can be reissued.
          const pending = await list(
            db
              .collection("teamInvites")
              .where("roomId", "==", roomId)
              .where("status", "==", "pending"),
          );
          if (pending.length >= 50 && previous?.status !== "pending")
            fail(
              "Resolve existing invitations before sending more (50 pending maximum).",
            );
          set(path, {
            roomId,
            roomName: room.name,
            email: targetEmail,
            role,
            status: "pending",
            invitedBy: uid,
            createdAt: now,
            expiresAt: new Date(Date.parse(now) + 14 * 86400000).toISOString(),
          });
          result = { id: key, roomId };
        } else if (action === "revokeInvite") {
          mustOwn();
          const path = "teamInvites/" + id(input.id),
            invitation = await get(path);
          if (invitation?.roomId !== roomId) fail("Invitation unavailable.");
          set(path, { status: "revoked", revokedAt: now }, true);
        } else if (action === "setRole" || action === "removeMember") {
          mustOwn();
          const target = id(input.id),
            path = `${base}/members/${target}`,
            other = await get(path);
          version(other);
          if (target === room.ownerUid)
            fail("The room owner cannot be removed or demoted.");
          if (action === "setRole") {
            const role = M.choice(p.role, ["member", "leader"]);
            set(path, { role, version: other.version + 1 }, true);
            addDirectory(target, room, role);
          } else {
            const otherAccount = (await get("teamUsers/" + target)) || {
              roomCount: 1,
            };
            const pendingPath = "teamInvites/" + inviteId(roomId, other.email),
              invitation = await get(pendingPath);
            del(path);
            del(`teamUsers/${target}/rooms/${roomId}`);
            set("teamUsers/" + target, {
              roomCount: Math.max(0, otherAccount.roomCount - 1),
            });
            set(
              base,
              { memberCount: room.memberCount - 1, updatedAt: now },
              true,
            );
            if (invitation)
              set(pendingPath, { status: "revoked", revokedAt: now }, true);
          }
        } else if (action === "archiveRoom") {
          mustOwn();
          version(room);
          if (typeof p.archived !== "boolean")
            fail("Choose archive or restore.");
          const members = await list(db.collection(base + "/members"));
          set(
            base,
            { archived: p.archived, version: room.version + 1, updatedAt: now },
            true,
          );
          for (const person of members)
            addDirectory(
              person.id,
              { ...room, archived: p.archived },
              person.role,
            );
        } else if (action === "saveProject") {
          mustManage();
          const projectId = id(input.id),
            path = base + "/projects/" + projectId,
            old = await get(path);
          if (old) version(old);
          else if (room.projectCount >= 100)
            fail("This room has reached its 100-project pilot limit.");
          const project = {
            title: M.text(p.title),
            description: M.text(p.description || "", 4000, false),
            targetDate: M.date(p.targetDate || ""),
            archived: old?.archived || false,
            taskCount: old?.taskCount || 0,
            version: (old?.version || 0) + 1,
            createdAt: old?.createdAt || now,
            updatedAt: now,
          };
          if (old?.archived) fail("Restore this project before editing.");
          set(path, project);
          if (!old) set(base, { projectCount: room.projectCount + 1 }, true);
          result = { id: projectId };
        } else if (action === "archiveProject") {
          mustManage();
          const projectId = id(input.id),
            path = base + "/projects/" + projectId,
            project = await get(path);
          version(project);
          if (typeof p.archived !== "boolean")
            fail("Choose archive or restore.");
          const tasks = await list(
            db.collection(base + "/tasks").where("projectId", "==", projectId),
          );
          set(
            path,
            {
              archived: p.archived,
              version: project.version + 1,
              updatedAt: now,
            },
            true,
          );
          for (const task of tasks)
            set(
              base + "/tasks/" + task.id,
              {
                projectArchived: p.archived,
                version: task.version + 1,
                updatedAt: now,
              },
              true,
            );
        } else if (
          ["saveTask", "taskStatus", "claimTask", "comment"].includes(action)
        ) {
          const taskId = id(input.id),
            path = base + "/tasks/" + taskId,
            old = await get(path);
          if (old) version(old);
          else if (action !== "saveTask") fail("This task is unavailable.");
          const projectId = old?.projectId || id(p.projectId),
            project = await get(base + "/projects/" + projectId);
          if (!project || project.archived)
            fail("This project is archived or unavailable.");
          if (action === "saveTask") {
            mustManage();
            if (old && p.projectId !== old.projectId)
              fail("A task cannot be moved between projects.");
            if (!old && (room.taskCount >= 300 || project.taskCount >= 150))
              fail("Pilot limit reached (300 tasks/room, 150/project).");
            const assigneeUid = p.assigneeUid ? id(p.assigneeUid) : "";
            if (assigneeUid && !(await get(base + "/members/" + assigneeUid)))
              fail("Choose a current room member.");
            const status = M.choice(p.status, M.STATUSES),
              task = {
                projectId,
                projectArchived: false,
                title: M.text(p.title, 200),
                description: M.text(p.description || "", 4000, false),
                assigneeUid,
                status,
                priority: M.choice(p.priority, ["low", "medium", "high"]),
                dueDate: M.date(p.dueDate || ""),
                commentCount: old?.commentCount || 0,
                version: (old?.version || 0) + 1,
                createdAt: old?.createdAt || now,
                updatedAt: now,
                completedAt: status === "done" ? old?.completedAt || now : null,
              };
            set(path, task);
            if (!old) {
              set(base, { taskCount: room.taskCount + 1 }, true);
              set(
                base + "/projects/" + projectId,
                { taskCount: project.taskCount + 1 },
                true,
              );
            }
            result = { id: taskId };
          } else if (action === "taskStatus") {
            if (!manager && old.assigneeUid !== uid)
              fail(
                "You may update only your assigned tasks.",
                "permission-denied",
              );
            const status = M.choice(p.status, M.STATUSES);
            set(
              path,
              {
                status,
                version: old.version + 1,
                updatedAt: now,
                completedAt: status === "done" ? now : null,
              },
              true,
            );
          } else if (action === "claimTask") {
            if (old.assigneeUid) fail("This task has already been assigned.");
            if (["cancelled", "done"].includes(old.status))
              fail("This task is already closed.");
            set(
              path,
              { assigneeUid: uid, version: old.version + 1, updatedAt: now },
              true,
            );
          } else {
            if (old.commentCount >= 200)
              fail("This task has reached its comment limit.");
            set(base + "/comments/" + eventId, {
              taskId,
              authorUid: uid,
              authorName: member.name,
              body: M.text(p.body, 2000),
              createdAt: now,
            });
            set(
              path,
              {
                commentCount: old.commentCount + 1,
                version: old.version + 1,
                updatedAt: now,
              },
              true,
            );
          }
        } else fail("Unknown team action.", "invalid-argument");
        set(base + "/activity/" + eventId, {
          actorUid: uid,
          actorName: member.name,
          action,
          recordId: input.id || "",
          createdAt: now,
        });
      }
      set(receiptPath, { fingerprint, result, createdAt: now });
      for (const write of writes) write();
      return result;
    });
  };
}
module.exports = { createService, inviteId, stable };
