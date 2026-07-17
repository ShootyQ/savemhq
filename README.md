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

## The Workroom Setup

The Workroom is a private, owner-only office system with two pages:

- `workroom.html` — the read-only TV display.
- `workroom-control.html` — projects, tasks, focus, treasurer reminders, and Google connection management.

Both pages require Firebase Authentication with `andrewpcarlson85@gmail.com`. They use real-time Firestore data under the signed-in owner's Workroom documents. Google Calendar and Gmail data are fetched only by Cloud Functions; browser clients cannot read OAuth state or token documents.

### Google Calendar and Gmail OAuth

1. In Google Cloud Console, enable the **Google Calendar API** and **Gmail API** for the Firebase project.
2. Configure the OAuth consent screen and add the owner as a test user while the app is in testing.
3. Create a **Web application** OAuth client. Add the deployed `handleWorkroomGoogleCallback` Function URL as an authorized redirect URI.
4. Set these Firebase Functions string parameters during deployment:
	- `GOOGLE_CLIENT_ID`
	- `GOOGLE_REDIRECT_URI` — the full deployed callback URL
	- `WORKROOM_CONTROL_URL` — normally the deployed `workroom-control.html` URL
5. Store the OAuth client secret only in Firebase Secret Manager:

```bash
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
```

The integration requests Calendar read-only and Gmail metadata-only access. It intentionally stores only selected calendar events and Gmail sender/subject metadata in the browser-readable summary; email bodies, snippets, access tokens, and refresh tokens stay out of client-readable data.

Deploy the Workroom backend before opening the pages:

```bash
firebase deploy --only firestore:rules,functions
```

After deployment, open `workroom-control.html`, sign in with the owner account, connect each Google account, choose the calendars to display, and use **Sync now** to verify the TV display. The scheduled Function refreshes connected accounts every ten minutes.

### ChatGPT Actions (Direct Auto-Execution)

The Workroom now includes a server-side action endpoint so a ChatGPT custom GPT can execute create operations immediately without calling the OpenAI API from your backend.

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