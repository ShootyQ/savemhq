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

`states-competition.html` now uses Firebase Auth + Firestore so users can request login and add plate sightings in real time after admin approval.

1. In Firebase Console, enable `Authentication > Sign-in method > Email/Password`.
2. In Firebase Console, create a Firestore database (Production or Test mode).
3. Open `admin.html` and sign in as `andrewpcarlson85@gmail.com`.
4. In `states-competition.html`, users create/sign in with email/password. New users are marked `pending` until approved.
5. Approve or deny users in `admin.html`.
6. Approved users can add plate sightings, and both browsers update automatically through Firestore snapshots.

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