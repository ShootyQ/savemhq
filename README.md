# savemhq

Personal website landing page for SavemHQ.

## Run locally

This is a static site.

- Open `index.html` directly in your browser, or
- Use VS Code Live Server if you want auto-refresh while editing.

## Edit guide

- Main content and sections: `index.html`
- Visual style and layout: `styles.css`

## Firebase Realtime Plate Tracker Setup

`states-competition.html` now uses a compact Google login in the header, and plate entry happens on a separate private page.

1. In Firebase Console, create a Firestore database (Production or Test mode).
2. In Firebase Console, enable Google provider under `Authentication > Sign-in method`.
3. Open `admin.html` and sign in as `andrewpcarlson85@gmail.com` to review approvals.
4. Users can click `Google Login` in the top-right header on any page (`index.html`, `states-competition.html`, `plate-entry.html`, or `admin.html`).
5. Approved users can open `plate-entry.html` and add sightings.
6. Live scoreboard updates continue to sync through Firestore snapshots.

### Suggested Firestore Rules

Use rules like this so only approved users can update competition data and only the admin account can approve logins:

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