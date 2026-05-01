// topbar.js

import { auth } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

function isHomePage() {
  return window.location.pathname === "/" || window.location.pathname === "/index.html";
}

function qs(id) {
  return document.getElementById(id);
}

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
    dashboardBtn?.classList.remove("hidden");
  } else {
    signOutBtn.classList.add("hidden");
    dashboardBtn?.classList.add("hidden");
  }
}

async function handleSignOut() {
  try {
    await signOut(auth);
    window.location.href = "/auth.html";
  } catch (err) {
    console.error("Sign out failed:", err);
  }
}

function initTopbarUi() {
  const signOutBtn = qs("signOutBtn");
  if (signOutBtn && !signOutBtn.dataset.bound) {
    signOutBtn.addEventListener("click", handleSignOut);
    signOutBtn.dataset.bound = "1";
  }

  updateRouteButtons();
}

// If topbar is already injected, init now; otherwise wait for event.
if (qs("signOutBtn") || qs("jobsToggleBtn") || qs("fullscreenBtn")) {
  initTopbarUi();
} else {
  window.addEventListener("topbar:ready", initTopbarUi, { once: true });
}

onAuthStateChanged(auth, (user) => {
  updateAuthButtons(user);
});
