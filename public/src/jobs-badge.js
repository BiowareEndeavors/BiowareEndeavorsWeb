// /src/jobs-badge.js

import { db, auth } from "/src/firebase-init.js";
import {
  collection,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

function getBadgeEl() {
  return document.getElementById("jobsBadge");
}

function renderBadge(n) {
  const badge = getBadgeEl();
  if (!badge) return;

  if (!n) {
    badge.style.display = "none";
    badge.textContent = "";
    return;
  }

  badge.textContent = n > 9 ? "9+" : String(n);
  badge.style.display = "inline-flex";
}

// --- Single-binding state ---
let _topbarReady = false;
let _currentUser = null;
let _unsub = null;        // Firestore unsubscribe
let _bound = false;

function setJobsAttention(on) {
  const jobsBtn = document.getElementById("jobsToggleBtn");
  if (!jobsBtn) return;
  jobsBtn.classList.toggle("jobs-attention", !!on);
}

function tryBindListener() {
  // Need both: signed-in user + topbar injected (or at least the button exists)
  if (_bound) return;
  if (!_currentUser) return;

  // If you truly want to wait for topbar:ready, keep this gate.
  // If the badge exists outside topbar, you could remove _topbarReady check.
  if (!_topbarReady) return;

  const q = query(
    collection(db, "jobs"),
    where("uid", "==", _currentUser.uid),
    where("needsAttention", "==", 1)
  );

  _unsub = onSnapshot(q, (snap) => {
    const n = snap.size;
    renderBadge(n);
    setJobsAttention(n > 0);
  });

  _bound = true;
}

function cleanupListener() {
  if (_unsub) {
    _unsub();
    _unsub = null;
  }
  _bound = false;
  renderBadge(0);
  setJobsAttention(false);
}

// Auth: track user, bind/unbind appropriately
auth.onAuthStateChanged((user) => {
  _currentUser = user || null;

  if (!_currentUser) {
    cleanupListener();
    return;
  }

  tryBindListener();
});

// Topbar ready signal
window.addEventListener("topbar:ready", () => {
  _topbarReady = true;
  tryBindListener();
});

// Also attempt immediately in case topbar injected already
// (If your topbar script dispatches topbar:ready later, this won't bind until then.)
_topbarReady = !!document.getElementById("jobsToggleBtn");
tryBindListener();
