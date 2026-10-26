# SavemHQ Admin Workspace

Open `admin.html` with the existing administrator Google account. This is a focused administration page; The Desk, Project Billing, and Business Portal remain separate workspaces linked from its header.

## People & Access

The first load shows Pending requests when any exist; otherwise it shows All accounts. Search by email or competition player name, filter by status, and use Manage to open one account. Lists show 25 rows per page. My access opens the administrator's own account even when a filter hides it.

Choose sections before approving. **Approve & save** grants those sections and sets approval to approved. Approval with no sections requires explicit confirmation. **Save access** preserves approval status. **Deny request / Revoke access** requires confirmation and retains existing records. Both the administrator and the existing auto-approved family account are labeled and protected from denial that would be undone on their next sign-in. Their player identities remain automatically assigned. The administrator's section choices are editable; Project Billing is an inherited admin-only tool, not a checkbox that can be granted to others.

The editor preserves choices through failed saves and background updates. Changing approval status, player, or section grants in another session creates a conflict; reload the latest account before saving again. Ordinary sign-in timestamps do not conflict. Writes use Firestore transactions and update the existing reviewer/timestamp fields without overwriting account metadata. Native modal focus stays in the editor; Escape/close warns about unsaved changes and restores focus to the account row. Sign-out closes the editor, clears private state, and unsubscribes listeners.

## Competition Locks

The dedicated tab controls the existing 2026 competition. Each month shows current scores, lock state, and expandable metadata. Unlocking requires confirmation because it permits plate edits again. Lock operations write only lock/timestamp metadata and preserve both logged-state arrays and manual scores. The former January score-reset preset has been removed.

## Aftercare retirement

The old check-in HTML page and shared JavaScript are deleted. Its admin tools, access option, subscriptions, validation helpers, and dedicated CSS are removed. The old URL returns the site's normal missing-page response; no moved notice or redirect is installed.

Firestore rules explicitly deny every browser read/write under `aftercarePrograms`, recursively, including administrator and auto-approved family sessions. This blocks cached copies of the old app. Existing records remain in Firestore and can be recovered through authorized backend/console access; this change runs no migration or deletion. Historical approval records remain unchanged until an administrator saves an account; the retired Aftercare grant is then omitted from the saved sections.

## Validation

```bash
npm --prefix functions run test:admin
npm --prefix functions run test:admin:browser
npm --prefix functions run test:business
npm --prefix functions run test:business:rules
npm --prefix functions run test:rules
npm --prefix functions run test:business:browser
npm --prefix functions run test:billing:browser
```

Browser tests use the real admin modules and transaction orchestration with isolated auth/Firestore transport. They cover approvals, warnings, self-editing, family protections, failed saves, live conflicts, filtering, escaping, mobile/dialog focus, score preservation, and sign-out cleanup. The emulator suite independently executes the actual admin transaction module against Firestore, including concurrent editor saves, checks existing portal authorization, and verifies retired Aftercare data remains stored while all browser access is denied. Admin screenshots are generated in `/tmp/admin-*`.

## Rollout

Pull the reviewed branch and deploy Firestore rules first:

```powershell
npx --prefix functions firebase deploy --project savemhq --only "firestore:rules"
```

Then merge/publish the website through the existing GitHub Pages workflow. No new Cloud Function, index, or Storage rules deployment is required. Rules-first intentionally disables the old attendance app before its cached or older UI disappears. After Pages publishes, refresh the live admin page and verify an account save, one safe lock/unlock, and removal of the old check-in page. Live deployment and authenticated production validation are separate from local test results.
