import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  initializeFirestore,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyADdgBbyCyPXaRuRKGAuFIWQSqTIQ9kR8s",
  authDomain: "savemhq.firebaseapp.com",
  projectId: "savemhq",
  storageBucket: "savemhq.firebasestorage.app",
  messagingSenderId: "648978749286",
  appId: "1:648978749286:web:233b165c3902849dcc9aa7",
  measurementId: "G-ESG98RHGSQ",
};

export const ADMIN_EMAIL = "andrewpcarlson85@gmail.com";

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const approvalsCollection = collection(db, "loginApprovals");

const getHeaderElements = () => ({
  headerAuthStatus: document.getElementById("header-auth-status"),
  signInBtn: document.getElementById("header-sign-in"),
  signOutBtn: document.getElementById("header-sign-out"),
  addPlatesLink: document.getElementById("add-plates-link"),
  adminLink: document.getElementById("header-admin-link"),
});

export const ensureApprovalRecord = async (user) => {
  const approvalRef = doc(approvalsCollection, user.uid);
  const snapshot = await getDoc(approvalRef);
  const normalizedEmail = (user.email || "").toLowerCase();

  if (!snapshot.exists()) {
    await setDoc(
      approvalRef,
      {
        uid: user.uid,
        email: user.email || "",
        status: "pending",
        requestedAt: serverTimestamp(),
        lastLoginAttemptAt: serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
      },
      { merge: true }
    );

    if (normalizedEmail === ADMIN_EMAIL) {
      await setDoc(
        approvalRef,
        {
          status: "approved",
          reviewedAt: serverTimestamp(),
          reviewedBy: ADMIN_EMAIL,
        },
        { merge: true }
      );
      return "approved";
    }

    return "pending";
  }

  const data = snapshot.data();
  let status = data.status || "pending";

  await setDoc(
    approvalRef,
    {
      uid: user.uid,
      email: user.email || "",
      lastLoginAttemptAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (normalizedEmail === ADMIN_EMAIL && status !== "approved") {
    await setDoc(
      approvalRef,
      {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: ADMIN_EMAIL,
      },
      { merge: true }
    );
    status = "approved";
  }

  return status;
};

const setSignedOutState = (headerElements, signedOutText) => {
  const { headerAuthStatus, signInBtn, signOutBtn, addPlatesLink, adminLink } = headerElements;
  signInBtn?.classList.remove("hidden");
  signOutBtn?.classList.add("hidden");
  addPlatesLink?.classList.add("hidden");
  adminLink?.classList.add("hidden");
  if (headerAuthStatus) {
    headerAuthStatus.textContent = signedOutText;
  }
};

export const initHeaderAuth = ({ onStateChange, signedOutText = "Signed out." } = {}) => {
  const headerElements = getHeaderElements();
  const { headerAuthStatus, signInBtn, signOutBtn, addPlatesLink, adminLink } = headerElements;

  signInBtn?.addEventListener("click", async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      const details = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      if (headerAuthStatus) {
        headerAuthStatus.textContent = `Google sign-in failed (${details}).`;
      }
    }
  });

  signOutBtn?.addEventListener("click", async () => {
    await signOut(auth);
  });

  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      setSignedOutState(headerElements, signedOutText);
      onStateChange?.({
        user: null,
        isAdmin: false,
        approvalStatus: "signed-out",
      });
      return;
    }

    signInBtn?.classList.add("hidden");
    signOutBtn?.classList.remove("hidden");

    try {
      const approvalStatus = await ensureApprovalRecord(user);
      const isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL;

      adminLink?.classList.toggle("hidden", !isAdmin);
      addPlatesLink?.classList.toggle("hidden", !(approvalStatus === "approved" || isAdmin));

      if (headerAuthStatus) {
        if (approvalStatus === "approved" || isAdmin) {
          headerAuthStatus.textContent = `Signed in as ${user.email}.`;
        } else if (approvalStatus === "denied") {
          headerAuthStatus.textContent = `Signed in as ${user.email} (access denied).`;
        } else {
          headerAuthStatus.textContent = `Signed in as ${user.email} (pending approval).`;
        }
      }

      onStateChange?.({ user, isAdmin, approvalStatus });
    } catch (error) {
      const details = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
      addPlatesLink?.classList.add("hidden");
      adminLink?.classList.add("hidden");
      if (headerAuthStatus) {
        headerAuthStatus.textContent = `Approval check failed (${details}). Verify Firestore rules.`;
      }
      onStateChange?.({
        user,
        isAdmin: false,
        approvalStatus: "error",
        error,
      });
    }
  });
};
