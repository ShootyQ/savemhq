# Workroom Teams: implementation and rollout guide

## Product and boundaries

Teams is a separate workspace reached from a Teams tab beside the personal Desk. Approved Desk users can create rooms. A room has an owner, leaders, members, shared projects, tasks, comments, and activity. Joining never exposes anyone's private Workroom, customers, billing, or business records.

Assignments appear in the assignee's personal Desk and in Teams, backed by the same canonical task. Task status is To do, In progress, Blocked, Done, or Cancelled. Progress is done / non-cancelled tasks; zero tasks means 0%. Every room member sees all projects and tasks. A person must accept an email invitation using a verified matching Google account, and must independently have Desk approval. Invitations do not grant site approval or send email automatically; the owner can copy a join link to send.

Owner: manages room, invitations, membership, and leaders; also all project work. Leader: manages projects and any task. Member: comments, updates their assigned tasks, and claims unassigned work. Members cannot assign tasks to others. Owner cannot be removed or demoted; no ownership transfer in this release. Removing a member preserves task and comment history but immediately ends server access. Archive rooms/projects rather than deleting history. Archived work is read-only and excluded from Desk assignments.

## Phase 1 — Access and invitations

- Add isolated `teams.html`, scoped styles, and focused API/model/UI modules.
- Store rooms at `teamRooms/{roomId}` with members, projects, tasks, comments, and activity subcollections; personal membership directory at `teamUsers/{uid}/rooms/{roomId}`; pending invitations at `teamInvites/{sha256(roomId,email)}`.
- Only an approved Desk user (or existing administrator exception) may read their memberships, create a room, or accept an invitation. Private team content requires current membership as well as Desk access.
- Perform all writes through authenticated `teamCommand`; verify identity, roles, linked records, values, and current versions in transactions. Store request receipts for safe retries; no browser write grants.
- Email invites expire after 14 days; owner can revoke/reissue. Verify email on acceptance. Removing a member also invalidates any invitation for that email. Existing history remains.
- Pilot bounds: 20 joined rooms/person, 50 members/room, 100 projects/room, 300 tasks/room, 150 tasks/project, 200 comments/task. Bounds keep transactions and initial real-time views finite; larger-scale pagination/retention is a later change.

## Phase 2 — Shared projects

- Room switcher, project overview, description, target date, archive/restore.
- All members can see project progress and who owns each task.
- Preserve open form drafts during live updates and failed saves; use version checks to reject overwrites.

## Phase 3 — Tasks and collaboration

- Create/edit tasks: title, description, project, one assignee, priority, due date, status.
- Owner/leaders assign work; members claim unassigned tasks and update status on their own tasks.
- My tasks / All tasks / By person views, status controls, comments and recent activity.
- Changes are transactional and add actor/timestamp activity. Cancelled tasks remain in history and do not count toward progress.

## Phase 4 — Desk integration

- Add Teams navigation to the personal Desk.
- Subscribe to the user's room directory, then their assignments in each active room. Merge assignments into the Desk's task list and Today counts/actions. A shared task's Complete/Reopen uses the same server command as Teams.
- Shared tasks link to their room/project and cannot be deleted from the personal task list.
- Stop subscriptions and clear shared content on sign-out, room removal, or access errors. Personal tasks are unchanged. Both authenticated Desk views show assignments, just as they show personal tasks. The existing guest welcome overlay remains available; Teams does not create a public display or share link.

## Phase 5 — Validation and rollout

- Unit tests: role policy, progress, validated dates/statuses, request fingerprints.
- Emulator tests using actual service transactions: room isolation, pending/revoked/signed-out access, invitation email and expiration, role escalation, removal, immutable owner, private Desk separation, retry/concurrency, project/task validation, archive behavior, canonical Desk completion.
- Browser checks: create/join, project/task assignment, comment, filters/progress, failure recovery, live-update draft preservation, mobile and keyboard/dialog behavior, sign-out cleanup.
- Run existing Desk, business, billing and admin regressions.
- Deploy Firestore rules/indexes and `functions:teamCommand` first. Then publish the static site through GitHub Pages. No production deployment in the implementation step.

PowerShell, after updating the checkout containing this change:

```powershell
npm --prefix functions ci
npx --prefix functions firebase deploy --project savemhq --only "firestore:rules,firestore:indexes,functions:teamCommand"
```

Merge/push the website change to main after backend deployment. Pilot with two approved accounts: invite → accept → create project → assign → complete from Desk → verify Teams progress → remove member → verify access denial. Invitations use the Teams URL and can be shared manually; no email delivery credentials required.

## Implementation status and verification

Phases 1–4 are implemented. Phase 5 local validation passes: 55 unit tests across Teams and existing admin/business/billing logic; 10 Teams Firestore emulator tests; 10 existing business/Storage/rules tests; 7 existing Desk rules tests; and Teams, business, billing, and admin browser workflows. Syntax and whitespace checks pass.

The Teams browser harness runs the actual UI, API, and command service with local auth/network transport. Real Firestore authorization, transaction concurrency, and retries are exercised separately against the emulator. It checks both Desk entry points, phone overflow, failed-save retention, live edit conflicts, uncertain-response retries (including comments), removal, and sign-out cleanup. Existing billing browser checks required one isolated rerun after a timing-sensitive render assertion; that rerun passed without product changes.

Production backend deployment, GitHub Pages publication, and the two-account real Google sign-in pilot remain rollout steps. No production data has been migrated, exposed, or deleted. Receipt images and billing/business permissions are unchanged.

Local commands:

```sh
npm --prefix functions run test:teams
npm --prefix functions run test:teams:rules
npm --prefix functions run test:teams:browser
```

Emulator tests require Java and the Firebase Firestore emulator download. The test project is `demo-teams`, never the production project. Browser checks use installed Chromium (`CHROMIUM_PATH` can override `/usr/bin/chromium`).
