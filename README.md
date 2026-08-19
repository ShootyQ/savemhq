# savemhq

Personal website landing page for SavemHQ.

## Run locally

This is a static site.

- Open `index.html` directly in your browser, or
- Use VS Code Live Server if you want auto-refresh while editing.

## Edit guide

- Main content and sections: `index.html`
- Visual style and layout: `styles.css`
- Shared header/auth runtime: `js/auth-shared.js`, `js/header-shell.js`
- Road trip hub and live map: `carlsons-road-trip.html`, `js/road-trip-shared.js`
- Road trip games hub and bingo state: `carlsons-road-trip-games.html`, `carlsons-kids-said-it-bingo.html`, `js/road-trip-games-shared.js`
- Triathlon tracker: `triathlon-tracker.html`, `js/triathlon-tracker.js`, Firebase Functions in `functions/`

## Triathlon Tracker Setup

`triathlon-tracker.html` is a private-by-approval dashboard for the August 22 triathlon build. It supports:

- Manual weigh-ins with timestamped history and a lightweight trend chart.
- Daily check-ins for notes, measurements, nutrition, sleep, and recovery.
- Progress and training photo uploads to Firebase Storage.
- Strava OAuth and manual activity sync through Firebase Functions.

Access uses the existing approval system. Add the `triathlon` section to an approved user's `loginApprovals/{uid}.accessSections`, or sign in as the admin account.

### Strava OAuth

Create a Strava API app, then configure the callback URL to the deployed `handleStravaCallback` Function URL.

Use these values consistently:

- Strava app `Authorization Callback Domain`: the Functions host domain only, for example `us-central1-your-project.cloudfunctions.net`
- Function param `STRAVA_REDIRECT_URI`: the full deployed `handleStravaCallback` URL
- Function param `TRIATHLON_DASHBOARD_URL`: your tracker page URL, for example `https://savemhq.com/triathlon-tracker.html`
- Function param `STRAVA_CLIENT_ID`: the numeric client id from the Strava app settings

Set the Strava client secret with Firebase Secret Manager:

```bash
firebase functions:secrets:set STRAVA_CLIENT_SECRET
```

The Functions code also expects these string params. The Firebase CLI will prompt for them during deploy if they are not already configured:

- `STRAVA_CLIENT_ID`
- `STRAVA_REDIRECT_URI`
- `TRIATHLON_DASHBOARD_URL`
- Secret: `STRAVA_CLIENT_SECRET`

The Strava client secret and refresh tokens must stay server-side. Do not put them in browser JavaScript or client-readable Firestore docs.

Deploy the full tracker backend rules with:

```bash
firebase deploy --only firestore:rules,storage,functions
```

After deploy, sign in as the triathlon manager on the tracker page, click `Connect Strava`, approve the app, then click `Sync Now` to pull activities into `triathlonSeasons/2026-andrew-august-22/stravaActivities`.

## The Desk Setup

The Desk is a private, multi-user workspace with two primary pages:

- `workroom.html` - the TV display.
- `workroom-control.html` - onboarding, tasks, projects, ideas, settings, and connected tools.

Internal `workroom*` filenames, Functions, CSS hooks, and Firestore paths remain unchanged for compatibility. Each user's data stays below `workrooms/{uid}` and Firestore rules deny cross-user access.

### Access and onboarding

1. A user opens the control room and signs in with Google. Their existing `loginApprovals/{uid}` record is created with pending status.
2. The admin opens `admin.html`, checks **The Desk**, and chooses **Approve + Save**.
3. The user returns to the control room, names their workspace, and chooses a preset.
4. Optional modules can be changed later in **Settings**. Disabling a module hides it without deleting its data.

Available presets:

- **Full Desk** - all general modules; this is the automatic legacy fallback for `andrewpcarlson85@gmail.com`.
- **Pastor** - tasks, projects, Ideas & Notes, follow-ups, Google, and Guest Display.
- **Simple Desk** - tasks and Ideas & Notes.

GPT briefings, Slack, Source Copilot, the automation inbox, and external ChatGPT Actions remain restricted to the legacy admin account. Other approved users can connect their own Google Calendar and Gmail when the Google module is enabled.

### Google Calendar and Gmail OAuth

1. In Google Cloud Console, enable the **Google Calendar API** and **Gmail API** for the Firebase project.
2. Configure the OAuth consent screen and add each pilot user as a test user while the app is in testing.
3. Create a **Web application** OAuth client. Add the deployed `handleWorkroomGoogleCallback` Function URL as an authorized redirect URI.
4. Set these Firebase Functions string parameters during deployment:
	- `GOOGLE_CLIENT_ID`
	- `GOOGLE_REDIRECT_URI` — the full deployed callback URL
	- `WORKROOM_CONTROL_URL` — normally the deployed `workroom-control.html` URL
5. Store the OAuth client secret only in Firebase Secret Manager:

```bash
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
```

The integration requests Calendar read-only and Gmail read-only access. It intentionally stores only selected calendar events and Gmail sender/subject metadata in the browser-readable summary; email bodies, snippets, access tokens, and refresh tokens stay out of client-readable data.

Deploy rules and the backend before hosting the updated Desk pages:

```bash
firebase deploy --only firestore:rules,functions
```

After deployment, each approved user can open `workroom-control.html`, connect their own Google account, choose calendars, and use **Sync now**. Tokens remain server-only and are partitioned by Firebase UID. The scheduled Function refreshes connected accounts every ten minutes and skips users whose Desk or Google access has been revoked.

### Verification and rollout

Install Function dependencies, check Function syntax, and run the Firestore Emulator suite:

```bash
npm --prefix functions install
npm --prefix functions run lint
npm --prefix functions run test:rules
```

Deploy in this order:

```bash
firebase deploy --only firestore:rules,functions
firebase deploy --only hosting
```

Before approving additional users, verify the existing admin still sees all legacy data and owner-only tools. Then onboard one Pastor preset account, create a `sermon`-tagged idea, connect a separate Google account, and verify both accounts are denied access to the other UID's documents.

To revoke access without deleting data, remove **The Desk** from the user's approval or change the approval status. To roll back the client, redeploy the previous Hosting release; the retained `workroom*` paths and untouched module data remain compatible.

### Source Copilot (Gmail and Slack to Task Review)

Source Copilot runs at 7:10 AM Central on weekdays and can also be run from **Automations > Source Copilot > Scan now**. It reads eligible unread Inbox messages and selected Slack sources, then proposes only clearly attributable owner obligations. The first release is deliberately **review-only**: it never creates tasks until the owner presses **Approve** on a suggestion.

Privacy and retention:

- Raw Gmail bodies and complete Slack messages are processed only in the Function and are never written to browser-readable summaries or task records.
- Candidate records retain a short sanitized excerpt, task proposal, confidence, and rationale for up to 30 days in a server-only collection. The control room reaches them through authenticated callable Functions.
- Gmail filters out common automated messages such as newsletters, receipts, shipping updates, password resets, list mail, and no-reply senders before AI analysis.

Required configuration:

1. Add the Functions parameters to `functions/.env` before deploying (or provide them when the Firebase CLI prompts during deployment):

```dotenv
WORKROOM_OWNER_UID=your-firebase-owner-uid
SLACK_OWNER_USER_ID=your-slack-member-id
SLACK_CHANNELS=C0123456789:Operations,C0987654321:Family
```

Set `WORKROOM_OWNER_UID` to the Firebase UID for `andrewpcarlson85@gmail.com`. Set `SLACK_OWNER_USER_ID` to that user's Slack member ID. Set `SLACK_CHANNELS` as a comma-separated list of selected channels in `CHANNEL_ID:Label` format, for example `C0123456789:Operations,C0987654321:Family`.

2. Store the Slack bot token in Secret Manager:

```bash
firebase functions:secrets:set SLACK_BOT_TOKEN
```

3. Give the Slack app the scopes appropriate to the selected sources, then reinstall it. Public channels need `channels:history`; private selected channels need `groups:history`; Workbot direct messages need `im:history` and conversation discovery permissions. Add Workbot to every selected channel. Workbot direct messages mean messages with the bot, never personal human-to-human DMs.

4. Reconnect every existing Google account from `workroom-control.html`. The Gmail permission changed from metadata-only to `gmail.readonly`, so existing grants cannot read source content until consent is renewed.

5. Deploy rules and Functions:

```bash
firebase deploy --only firestore:rules,functions
```

Use several manual scans to review suggestions before changing the review-only server setting. Repeated scans reuse deterministic candidate IDs and do not create duplicate suggestions or tasks.

### ChatGPT Actions (Direct Auto-Execution)

The Desk includes an owner-only server-side action endpoint so a ChatGPT custom GPT can execute create operations immediately without calling the OpenAI API from your backend.

Function endpoint:

- `executeWorkroomAction` (HTTP POST)

Authentication:

- Header `x-workroom-key` must match the `WORKROOM_AUTOMATION_KEY` secret.

Required request shape:

```json
{
	"uid": "<workroom-owner-uid>",
	"requestId": "unique-id-per-command",
	"source": "chatgpt-action",
	"operation": "createTask",
	"payload": {
		"title": "Call vendor about invoice",
		"priority": "high",
		"dueDate": "2026-07-18",
		"notes": "Mention ACH confirmation"
	}
}
```

Supported operations:

- `createTask`
- `createProject`
- `createFinanceReminder`
- `createContactFollowUp`
- `createAchEntry`

Guardrails included:

- Daily execution caps (global + per operation)
- Idempotency via `requestId`
- Immutable audit log entries for accepted/rejected requests
- Delete/update actions are not exposed to GPT

Owner status panel:

- `workroom-control.html` shows daily remaining usage and recent action history.
- Data is served by callable Function `getWorkroomAutomationStatus` because audit/usage docs are server-only in Firestore rules.

OpenAPI schema for ChatGPT Actions import:

- `workroom-gpt-actions-openapi.json`

Custom GPT instruction template:

- `workroom-gpt-custom-instructions.md`

Deployment notes:

1. Set or rotate the secret before deploy:

```bash
firebase functions:secrets:set WORKROOM_AUTOMATION_KEY
```

2. Deploy backend changes:

```bash
firebase deploy --only firestore:rules,functions
```

3. In your custom GPT Actions settings, import `workroom-gpt-actions-openapi.json`, set the server URL to your deployed Functions domain, and configure the `x-workroom-key` header value.
4. Paste `workroom-gpt-custom-instructions.md` into your Custom GPT Instructions field to improve operation selection and payload quality.

## 2026 Competition UX Notes

- Mobile header now uses a compact `Menu` toggle so auth buttons do not consume most of the screen.
- `plate-entry.html` now uses tap-to-toggle state entry: tap a state to add it, tap again to remove it.
- Player identity is automatic from login email:
	- `andrewpcarlson85@gmail.com` -> Andy
	- `savannahbcarlson@gmail.com` -> Savannah
	- Other accounts are read-only on plate entry.
- Andrew and Savannah are auto-approved on first sign-in; other accounts still require approval from the admin page.
- Monthly plate cards on `states-competition.html` are collapsed by default on mobile and can be expanded per month.
- Month locks are managed from `admin.html`. Locked months cannot be edited in plate entry.

## Firebase Realtime Plate Tracker Setup

`states-competition.html` now uses a compact Google login in the header, and plate entry happens on a separate private page.

1. In Firebase Console, create a Firestore database (Production or Test mode).
2. In Firebase Console, enable Google provider under `Authentication > Sign-in method`.
3. Open `admin.html` and sign in as `andrewpcarlson85@gmail.com` to review approvals.
4. Users can click `Google Login` in the top-right header on any page (`index.html`, `states-competition.html`, `plate-entry.html`, or `admin.html`).
5. Approved users can open `plate-entry.html` and add sightings.
6. Live scoreboard updates continue to sync through Firestore snapshots.

### Suggested Firestore Rules

Use the checked-in `firestore.rules` file so only approved users can update competition data and only the admin account can approve logins.

If you use Firebase CLI, deploy with:

```bash
firebase deploy --only firestore:rules
```

Photo uploads for the road trip gallery also require Storage rules:

```bash
firebase deploy --only firestore:rules,storage
```

Photo uploads from the live site also require a bucket-level CORS configuration for the browser origin. This is separate from Firebase Storage rules and is not changed by `firebase deploy`.

Use the checked-in `storage.cors.json` file and apply it to your storage bucket with Google Cloud CLI:

```bash
gcloud storage buckets update gs://savemhq.firebasestorage.app --cors-file=storage.cors.json
```

Then verify it:

```bash
gcloud storage buckets describe gs://savemhq.firebasestorage.app --format="default(cors_config)"
```

If your Firebase project still uses an older default bucket name, run the same commands with `gs://savemhq.appspot.com` instead.

Rule reference:

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		function isAuthed() {
			return request.auth != null;
		}

		function isAdmin() {
			return isAuthed() && request.auth.token.email == "andrewpcarlson85@gmail.com";
		}

		function isApprovedUser() {
			return isAuthed()
				&& exists(/databases/$(database)/documents/loginApprovals/$(request.auth.uid))
				&& get(/databases/$(database)/documents/loginApprovals/$(request.auth.uid)).data.status == "approved";
		}

		match /competitions/{year}/months/{month} {
			allow read: if isApprovedUser() || isAdmin();
			allow write: if isApprovedUser() || isAdmin();
		}

		match /loginApprovals/{uid} {
			allow create: if isAuthed()
				&& request.auth.uid == uid
				&& request.resource.data.status == "pending";
			allow read: if isAdmin() || (isAuthed() && request.auth.uid == uid);
			allow update: if isAdmin() || (
				isAuthed()
				&& request.auth.uid == uid
				&& request.resource.data.status == resource.data.status
			);
			allow delete: if isAdmin();
		}
	}
}
```