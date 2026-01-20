import { auth } from "./firebase-init.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

/* ---------- helpers ---------- */

function isHomePage() {
  return (
    window.location.pathname === "/" ||
    window.location.pathname === "/index.html"
  );
}

function qs(id) {
  return document.getElementById(id);
}

/* ---------- UI control ---------- */

function updateRouteButtons() {
  const jobsBtn = qs("jobsToggleBtn");
  const fullscreenBtn = qs("fullscreenBtn");

  if (isHomePage()) {
    jobsBtn?.classList.remove("hidden");
    fullscreenBtn?.classList.remove("hidden");
  } else {
    jobsBtn?.classList.add("hidden");
    fullscreenBtn?.classList.add("hidden");
  }
}

function updateAuthButtons(user) {
  const signOutBtn = qs("signOutBtn");
  const dashboardBtn = qs("dashboardBtn");
  if (!signOutBtn) return;

  if (user) {
    signOutBtn.classList.remove("hidden");
    dashboardBtn.classList.remove("hidden");
  } else {
    signOutBtn.classList.add("hidden");
    dashboardBtn.classList.add("hidden");
  }
}

/* ---------- sign out ---------- */

async function handleSignOut() {
  try {
    await signOut(auth);
    window.location.href = "/auth";
  } catch (err) {
    console.error("Sign out failed:", err);
  }
}

/* ---------- init ---------- */

document.addEventListener("DOMContentLoaded", () => {

  // Wire click handler
  const signOutBtn = qs("signOutBtn");
  if (signOutBtn) {
    signOutBtn.addEventListener("click", handleSignOut);
  }

  updateRouteButtons();
});

/* ---------- auth listener ---------- */

onAuthStateChanged(auth, (user) => {
  updateAuthButtons(user);
});
