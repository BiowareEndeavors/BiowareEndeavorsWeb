// /src/jobs-badge.js

import {db, auth } from "/src/firebase-init.js";
import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

const badge = document.getElementById("jobsBadge");

function renderBadge(n) {
  if (!badge) return;

  if (!n) {
    badge.style.display = "none";
    return;
  }

  badge.textContent = n > 9 ? "9+" : String(n);
  badge.style.display = "inline-flex";
}

auth.onAuthStateChanged((user) => {
  if (!user) return;

  const q = query(
    collection(db, "jobs"),
    where("uid", "==", user.uid),
    where("needsAttention", "==", 1)
  );

  const jobsBtn = document.getElementById("jobsToggleBtn");

    function setJobsAttention(on) {
    if (!jobsBtn) return;
    jobsBtn.classList.toggle("jobs-attention", !!on);
    }

    // in your snapshot callback:
    onSnapshot(q, (snap) => {
    const n = snap.size;
    renderBadge(n);
    setJobsAttention(n > 0);
    });
});
