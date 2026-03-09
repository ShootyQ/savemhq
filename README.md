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