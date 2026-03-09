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
export const SAVANNAH_EMAIL = "savannahbcarlson@gmail.com";

const KNOWN_USER_PROFILES = {
  [ADMIN_EMAIL]: {
    displayName: "Andy",
    person: "andy",
    autoApprove: true,
    isAdmin: true,
  },
  [SAVANNAH_EMAIL]: {
    displayName: "Savannah",
    person: "savannah",
    autoApprove: true,
    isAdmin: false,
  },
};

export const getKnownUserProfile = (email) => KNOWN_USER_PROFILES[String(email || "").toLowerCase()] || null;

export const getPersonFromEmail = (email) => getKnownUserProfile(email)?.person || "";

const approvalFieldsForEmail = (email) => {
  const knownProfile = getKnownUserProfile(email);

  if (!knownProfile) {
    return {};
  }

  return {
    person: knownProfile.person,
    personLabel: knownProfile.displayName,
  };
};

const signedInLabelForUser = (user) => {
  const email = String(user?.email || "").trim();
  const knownProfile = getKnownUserProfile(email);

  if (knownProfile?.displayName) {
    return knownProfile.displayName;
  }

  return String(user?.displayName || email || "your account").trim();
};

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
  const knownProfile = getKnownUserProfile(normalizedEmail);
  const shouldAutoApprove = Boolean(knownProfile?.autoApprove);
  const knownApprovalFields = approvalFieldsForEmail(normalizedEmail);

  if (!snapshot.exists()) {
    await setDoc(
      approvalRef,
      {
        uid: user.uid,
        email: user.email || "",
        ...knownApprovalFields,
        status: shouldAutoApprove ? "approved" : "pending",
        requestedAt: serverTimestamp(),
        lastLoginAttemptAt: serverTimestamp(),
        reviewedAt: shouldAutoApprove ? serverTimestamp() : null,
        reviewedBy: shouldAutoApprove ? normalizedEmail : null,
      },
      { merge: true }
    );

    if (shouldAutoApprove) {
      return {
        status: "approved",
        person: knownApprovalFields.person || "",
      };
    }

    return {
      status: "pending",
      person: "",
    };
  }

  const data = snapshot.data();
  let status = data.status || "pending";
  let person = String(data.person || knownApprovalFields.person || "");

  await setDoc(
    approvalRef,
    {
      uid: user.uid,
      email: user.email || "",
      ...knownApprovalFields,
      lastLoginAttemptAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (shouldAutoApprove && status !== "approved") {
    await setDoc(
      approvalRef,
      {
        status: "approved",
        reviewedAt: serverTimestamp(),
        reviewedBy: normalizedEmail,
      },
      { merge: true }
    );
    status = "approved";
  }

  return {
    status,
    person,
  };
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
      const approval = await ensureApprovalRecord(user);
      const approvalStatus = approval.status;
      const approvalPerson = approval.person;
      const knownProfile = getKnownUserProfile(user.email);
      const isAdmin = Boolean(knownProfile?.isAdmin);
      const signedInLabel = signedInLabelForUser(user);

      adminLink?.classList.toggle("hidden", !isAdmin);
      addPlatesLink?.classList.toggle("hidden", !(approvalStatus === "approved" || isAdmin));

      if (headerAuthStatus) {
        if (approvalStatus === "approved" || isAdmin) {
          headerAuthStatus.textContent = `Signed in as ${signedInLabel}.`;
        } else if (approvalStatus === "denied") {
          headerAuthStatus.textContent = `Signed in as ${signedInLabel} (access denied).`;
        } else {
          headerAuthStatus.textContent = `Signed in as ${signedInLabel} (pending approval).`;
        }
      }

      onStateChange?.({ user, isAdmin, approvalStatus, approvalPerson });
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
        approvalPerson: "",
        error,
      });
    }
  });
};
