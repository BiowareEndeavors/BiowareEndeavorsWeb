import { app, db, storage, auth } from "/src/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc, 
  doc
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

import {
  ref as storageRef,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";

const FUNCTIONS_REGION = "us-central1";
const functions = getFunctions(app, FUNCTIONS_REGION);
const cancelJobCallable = httpsCallable(functions, "cancel_job");

const elToggleBtn = document.getElementById("jobsToggleBtn");

const elOverlay = document.getElementById("jobsOverlay");
const elCloseBtn = document.getElementById("jobsCloseBtn");

const elList = document.getElementById("jobsList");
const elFilter = document.getElementById("jobsStatusFilter");
const elRefreshBtn = document.getElementById("jobsRefreshBtn");

const elResultWrap = document.getElementById("jobResultWrap");
const elResultJson = document.getElementById("jobResultJson");
const elResultCloseBtn = document.getElementById("jobResultCloseBtn");

// NEW action UI elements
const elActionsTitle = document.getElementById("jobActionsTitle");
const elActionsHint = document.getElementById("jobActionsHint");
const elViewJsonBtn = document.getElementById("jobViewJsonBtn");
const elDownloadJsonBtn = document.getElementById("jobDownloadJsonBtn");
const elVisualizeBtn = document.getElementById("jobVisualizeBtn");
const el = document.getElementById("viewContext");

let _authUser = null;
let _open = false;

let _unsubscribeJobs = null;
let _hasLoadedOnce = false;

// currently selected job
let _selectedJob = null;

window.setViewContext = function setViewContext(text) {
  if (!el) return;
  el.textContent = text || "No molecule loaded";
};

window.loadDensityFromFirebaseUrl = function (url) {
  if (!gl || !shader) {
    alert("Renderer not initialized yet.");
    return;
  }

  loadVolumeBinFromUrl(url, function (vol) {

    var volDims = vol.dims;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    var tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, tex);

    gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R16F,
      volDims[0], volDims[1], volDims[2]);

    var halfFloatLinearOK =
      !!gl.getExtension("OES_texture_half_float_linear");

    gl.texParameteri(gl.TEXTURE_3D,
      gl.TEXTURE_MIN_FILTER,
      halfFloatLinearOK ? gl.LINEAR : gl.NEAREST);

    gl.texParameteri(gl.TEXTURE_3D,
      gl.TEXTURE_MAG_FILTER,
      halfFloatLinearOK ? gl.LINEAR : gl.NEAREST);

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.texSubImage3D(
      gl.TEXTURE_3D, 0,
      0, 0, 0,
      volDims[0], volDims[1], volDims[2],
      gl.RED, gl.HALF_FLOAT,
      vol.dataU16
    );

    var longest = Math.max(volDims[0],
                    Math.max(volDims[1], volDims[2]));

    var volScale = [
      volDims[0] / longest,
      volDims[1] / longest,
      volDims[2] / longest
    ];

    lastVolumeDims = volDims;
    lastVolumeScale = volScale;

    if (shader.uniforms["volume_dims"])
      gl.uniform3iv(shader.uniforms["volume_dims"], volDims);

    if (shader.uniforms["volume_scale"])
      gl.uniform3fv(shader.uniforms["volume_scale"], volScale);

    newVolumeUpload = true;

    if (volumeTexture) gl.deleteTexture(volumeTexture);
    volumeTexture = tex;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture);

    if (!renderLoopStarted) {
      renderLoopStarted = true;
      setInterval(renderFrame, targetFrameTime);
    }
  });
};

function fmtDate(v) {
  if (!v) return "";
  try {
    if (typeof v?.toDate === "function") {
      return v.toDate().toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  } catch (_) {}

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showActions(job) {
  _selectedJob = job ?? null;

  elResultWrap.classList.add("is-open");
  elResultJson.style.display = "none";
  elResultJson.textContent = "";

  const name = job?.nickname ?? job?.filename ?? job?.id ?? "Job";
  const status = String(job?.status ?? "").toUpperCase();
  const createdAt = fmtDate(job?.createdAt);

  if (elActionsTitle) {
    elActionsTitle.textContent = `${name} (${status || "UNKNOWN"})`;
  }

  const hintParts = [];
  if (createdAt) hintParts.push(`Created: ${createdAt}`);

  const densityPath = job?.densityRef?.path;
  if (!densityPath) hintParts.push("No density grid attached to this job yet.");

  if (elActionsHint) elActionsHint.textContent = hintParts.join(" • ");

  // Enable/disable visualize button based on densityRef
  if (elVisualizeBtn) {
    elVisualizeBtn.disabled = !densityPath;
    elVisualizeBtn.title = densityPath ? "" : "No density file available for this job.";
  }
}

function hideActions() {
  _selectedJob = null;
  elResultWrap.classList.remove("is-open");
  elResultJson.textContent = "";
  elResultJson.style.display = "none";
  if (elActionsTitle) elActionsTitle.textContent = "Job";
  if (elActionsHint) elActionsHint.textContent = "";
}

function showJson(obj) {
  elResultJson.style.display = "block";
  elResultJson.textContent = JSON.stringify(obj ?? {}, null, 2);
}

function stopJobsListener() {
  if (_unsubscribeJobs) {
    _unsubscribeJobs();
    _unsubscribeJobs = null;
  }
}

function setOpen(open) {
  _open = open;
  if (!elOverlay) return;

  if (open) {
    elOverlay.classList.add("is-open");
    elOverlay.setAttribute("aria-hidden", "false");
    startJobsListener();
  } else {
    elOverlay.classList.remove("is-open");
    elOverlay.setAttribute("aria-hidden", "true");
    hideActions();
    stopJobsListener();
  }
}

function rowHtml(job) {
  const name = job?.nickname ?? job?.filename ?? "";
  const id = job?.id ?? job?.jobId ?? "";
  const createdAt = fmtDate(job?.createdAt);
  const status = String(job?.status ?? "").toUpperCase();

  const cancellable = status === "IN_QUEUE" || status === "IN_PROGRESS";
  const needsAttention = Number(job?.needsAttention) === 1;

  const meta = [status ? `${status}` : null, createdAt ? `${createdAt}` : null]
    .filter(Boolean)
    .join(" | ");

  return `
    <div class="jobs-item jobs-item--clickable
                ${needsAttention ? "jobs-item--unseen" : ""}"
         role="button" tabindex="0"
         data-action="view" data-id="${id}">

      <div class="jobs-item__top">
        <div style="min-width:0;">
          <div class="jobs-item__id">${name}</div>
          <div class="jobs-item__meta">${meta}</div>
        </div>

        <div style="flex-shrink:0; display:flex; gap:8px;">
          ${
            cancellable
              ? `<button class="btn btn-sm btn-danger"
                         data-action="cancel"
                         data-id="${id}">Cancel</button>`
              : ``
          }
        </div>
      </div>
    </div>
  `;
}

async function cancelJob(jobId) {
  const res = await cancelJobCallable({ jobId });
  return res?.data ?? res;
}

function renderJobs(jobs) {
  if (!elList) return;

  if (!jobs || jobs.length === 0) {
    elList.innerHTML = `<div class="jobs-item">No jobs found.</div>`;
    return;
  }

  elList.innerHTML = jobs.map(rowHtml).join("");

  // Click anywhere on the item to open actions
  elList.querySelectorAll('.jobs-item[data-action="view"]').forEach((item) => {
    const openActions = () => {
      const id = item.getAttribute("data-id");
      const job = jobs.find((j) => (j.id ?? j.jobId) === id) ?? null;
      const ref = doc(db, "jobs", id);
      updateDoc(ref, {
        needsAttention: 0
      });
      showActions(job ?? { id });
    };

    item.addEventListener("click", (e) => {
      if (e.target && e.target.closest && e.target.closest("button")) return;
      openActions();
    });

    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openActions();
      }
    });
  });

  // Cancel button
  elList.querySelectorAll('button[data-action="cancel"]').forEach((b) => {
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = b.getAttribute("data-id");
      if (!id) return;

      b.disabled = true;
      try {
        await cancelJob(id);
      } catch (err) {
        b.disabled = false;
        alert(`Cancel failed: ${err?.message || String(err)}`);
      }
    });
  });
}

function startJobsListener() {
  if (!_authUser) return;
  if (!_open) return;

  stopJobsListener();
  hideActions();

  if (!_hasLoadedOnce) {
    elList.innerHTML = `<div class="jobs-item">Loading...</div>`;
  }

  const q = query(
    collection(db, "jobs"),
    where("uid", "==", _authUser.uid),
    orderBy("statusPriority", "asc"),
    orderBy("createdAt", "desc"),
    limit(500)
  );

  _unsubscribeJobs = onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const queued = [];
      const inprog = [];
      const rest = [];

      for (const j of all) {
        const s = String(j?.status || "").toUpperCase();
        if (s === "IN_QUEUE") queued.push(j);
        else if (s === "IN_PROGRESS" || s === "IN-PROGRESS") inprog.push(j);
        else rest.push(j);
      }

      const merged = [...queued, ...inprog, ...rest];

      renderJobs(merged);
      _hasLoadedOnce = true;

      // If a selected job is open, keep it updated live
      if (_selectedJob?.id) {
        const updated = merged.find((j) => j.id === _selectedJob.id);
        if (updated) showActions(updated);
      }
    },
    (err) => {
      if (!_hasLoadedOnce) {
        elList.innerHTML = `<div class="jobs-item">Failed to load jobs: ${
          err?.message || String(err)
        }</div>`;
      }
    }
  );
}

// ---- Actions: View/Download JSON, Visualize ----

function buildOutputJsonPayload(job) {
  // Keep your existing priority, but treat it explicitly as "output.json payload"
  return (
    job?.result ??
    job?.partialResult ??
    job?.upstream ??
    job ??
    { id: job?.id }
  );
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Hook up buttons once
if (elViewJsonBtn) {
  elViewJsonBtn.addEventListener("click", () => {
    if (!_selectedJob) return;
    const payload = buildOutputJsonPayload(_selectedJob);
    showJson(payload);
  });
}

if (elDownloadJsonBtn) {
  elDownloadJsonBtn.addEventListener("click", () => {
    if (!_selectedJob) return;
    const payload = buildOutputJsonPayload(_selectedJob);
    const id = _selectedJob?.id ?? "job";
    const name = (_selectedJob?.nickname ?? _selectedJob?.filename ?? id).replace(/[^\w.-]+/g, "_");
    downloadTextFile(`${name}_output.json`, JSON.stringify(payload ?? {}, null, 2));
  });
}

/**
 * You implement this in your renderer code.
 * Must accept a download URL to the density.bin and then kick off rendering.
 *
 * Example signature:
 *   window.InsightRenderer.loadDensityFromUrl(url, { jobId })
 */
async function visualizeSelectedJob() {
  if (!_selectedJob) return;

  const densityPath = _selectedJob?.densityRef?.path;
  if (!densityPath) return;

  elVisualizeBtn.disabled = true;

  try {
    const url = await getDownloadURL(storageRef(storage, densityPath));

    // close modal
    window.setViewContext?.(`${_selectedJob?.nickname || _selectedJob?.filename}`);
    setOpen(false);

    // inject volume
    window.loadDensityFromFirebaseUrl(url);
  } catch (err) {
    alert(`Visualize failed: ${err?.message || String(err)}`);
  } finally {
    elVisualizeBtn.disabled = false;
  }
}

if (elVisualizeBtn) elVisualizeBtn.addEventListener("click", visualizeSelectedJob);

// ---- Open/close controls ----

if (elToggleBtn) {
  elToggleBtn.addEventListener("click", () => {
    setOpen(!_open);
  });
}

if (elCloseBtn) {
  elCloseBtn.addEventListener("click", () => setOpen(false));
}

if (elOverlay) {
  elOverlay.addEventListener("click", (e) => {
    if (e.target === elOverlay) setOpen(false);
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _open) setOpen(false);
});

if (elRefreshBtn) elRefreshBtn.addEventListener("click", startJobsListener);
if (elFilter) elFilter.addEventListener("change", startJobsListener);

if (elResultCloseBtn) elResultCloseBtn.addEventListener("click", hideActions);

onAuthStateChanged(auth, (user) => {
  _authUser = user;
  if (_open) startJobsListener();
});
