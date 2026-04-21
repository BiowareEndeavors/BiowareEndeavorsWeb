import { db, storage, auth, app } from "/src/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  doc,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

import {
  ref as storageRef,
  getBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";

const FUNCTIONS_REGION = "us-central1";
const LOCAL_FUNCTIONS_HOST = "127.0.0.1";
const LOCAL_FUNCTIONS_PORT = 5001;
let didConnectFunctionsEmulator = false;

function getLocalAwareFunctions(region = FUNCTIONS_REGION) {
  const functions = getFunctions(app, region);
  const host = typeof window === "undefined" ? "" : window.location.hostname || "";
  const isLocalHost = host === "127.0.0.1" || host === "localhost";

  if (isLocalHost && !didConnectFunctionsEmulator) {
    connectFunctionsEmulator(functions, LOCAL_FUNCTIONS_HOST, LOCAL_FUNCTIONS_PORT);
    didConnectFunctionsEmulator = true;
    console.info(
      `[firebase] Using local Functions emulator at ${LOCAL_FUNCTIONS_HOST}:${LOCAL_FUNCTIONS_PORT} (${region})`
    );
  }

  return functions;
}

const functions = getLocalAwareFunctions(FUNCTIONS_REGION);
const cancelJobCallable = httpsCallable(functions, "cancel_job");

// Elements that are always in the base HTML (safe to grab now)
const elOverlay = document.getElementById("jobsOverlay");
const elCloseBtn = document.getElementById("jobsCloseBtn");

const elList = document.getElementById("jobsList");
const elFilter = document.getElementById("jobsStatusFilter");
const elRefreshBtn = document.getElementById("jobsRefreshBtn");

const elResultWrap = document.getElementById("jobResultWrap");
const elResultJson = document.getElementById("jobResultJson");
const elResultCloseBtn = document.getElementById("jobResultCloseBtn");

const elActionsTitle = document.getElementById("jobActionsTitle");
const elActionsHint = document.getElementById("jobActionsHint");
const elDownloadInputXmlBtn = document.getElementById("jobDownloadInputXmlBtn");
const elDownloadJsonBtn = document.getElementById("jobDownloadJsonBtn");
const elDownloadOptimizedXmlBtn = document.getElementById("jobDownloadOptimizedXmlBtn");
const elVisualizeBtn = document.getElementById("jobVisualizeBtn");
const elViewContext = document.getElementById("viewContext");
const MAX_INPUT_XML_DOWNLOAD_BYTES = 5 * 1024 * 1024;

// Elements that live inside topbar.html (NOT safe to grab until topbar injected)
let elToggleBtn = null;

// state
let _authUser = null;
let _open = false;

let _unsubscribeJobs = null;
let _hasLoadedOnce = false;

// currently selected job
let _selectedJob = null;

// prevent double-binding if topbar:ready fires more than once
let _topbarBound = false;

// ------------------------------
// Public helpers
// ------------------------------
window.setViewContext = function setViewContext(text) {
  if (!elViewContext) return;
  elViewContext.textContent = text || "No molecule loaded";
};

// IMPORTANT:
// Do NOT define window.loadDensityFromFirebaseUrl here.
// The renderer (volume-raycaster.js) owns that function now.

// ------------------------------
// Topbar readiness wiring (Option A)
// ------------------------------
function bindTopbarControls() {
  if (_topbarBound) return;

  elToggleBtn = document.getElementById("jobsToggleBtn");
  if (!elToggleBtn) return; // topbar not injected yet (or missing button)

  elToggleBtn.addEventListener("click", () => {
    setOpen(!_open);
  });

  _topbarBound = true;
}

// Listen for the signal fired after topbar.html is injected
window.addEventListener("topbar:ready", bindTopbarControls);

// Also attempt immediately in case topbar injected very quickly / already present
bindTopbarControls();

// ------------------------------
// UI helpers
// ------------------------------
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

function getJobDisplayName(job) {
  return job?.nickname ?? job?.filename ?? job?.id ?? "Job";
}

function toTitleLabel(value) {
  return String(value ?? "")
    .trim()
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getJobTypeLabel(job) {
  const mode = String(job?.mode ?? "").trim().toLowerCase();
  if (mode === "point_solve") return "Point Solve";
  if (mode === "geometry_optimization") return "Geometry Optimization";

  const jobType = String(job?.jobType ?? job?.job_type ?? "").trim().toLowerCase();
  if (jobType === "single_point") return "Point Solve";
  if (jobType === "geometry_optimization") return "Geometry Optimization";

  return toTitleLabel(mode || jobType);
}

function isGeometryOptimizationJob(job) {
  const mode = String(job?.mode ?? "").trim().toLowerCase();
  if (mode === "geometry_optimization") return true;

  const jobType = String(job?.jobType ?? job?.job_type ?? "").trim().toLowerCase();
  return jobType === "geometry_optimization";
}

function showActions(job) {
  _selectedJob = job ?? null;

  if (elResultWrap) elResultWrap.classList.add("is-open");

  const payload = buildOutputJsonPayload(job);
  const name = getJobDisplayName(job);
  const status = String(job?.status ?? "").toUpperCase();
  const createdAt = fmtDate(job?.createdAt);
  const jobType = getJobTypeLabel(job);
  const isGeometryOptimization = isGeometryOptimizationJob(job);
  const inputXmlPath = getInputXmlPath(job);
  const inputXmlInline = getInputXmlText(job);

  if (elActionsTitle) {
    elActionsTitle.textContent = `${name} (${status || "UNKNOWN"})`;
  }

  const hintParts = [];
  if (jobType) hintParts.push(`Type: ${jobType}`);
  if (createdAt) hintParts.push(`Created: ${createdAt}`);

  const densityPath = job?.densityRef?.path;
  const optimizedGeometryXml = getOptimizedGeometryXml(job);
  if (!densityPath) hintParts.push("No density grid attached to this job yet.");

  if (elActionsHint) elActionsHint.textContent = hintParts.join(" | ");

  if (elVisualizeBtn) {
    elVisualizeBtn.disabled = !densityPath;
    elVisualizeBtn.title = densityPath ? "" : "No density file available for this job.";
  }

  if (elDownloadInputXmlBtn) {
    const hasInputXml = Boolean(inputXmlPath || inputXmlInline);
    elDownloadInputXmlBtn.disabled = !hasInputXml;
    elDownloadInputXmlBtn.title = hasInputXml
      ? ""
      : "Input XML isn't stored for this job.";
  }

  if (elDownloadOptimizedXmlBtn) {
    elDownloadOptimizedXmlBtn.hidden = !isGeometryOptimization;
    elDownloadOptimizedXmlBtn.disabled = !isGeometryOptimization || !optimizedGeometryXml;
    elDownloadOptimizedXmlBtn.title = !isGeometryOptimization
      ? "Only available for geometry optimization jobs."
      : optimizedGeometryXml
        ? ""
        : "No optimized geometry XML available for this job yet.";
  }

  showJson(payload);
}

function hideActions() {
  _selectedJob = null;
  if (elResultWrap) elResultWrap.classList.remove("is-open");
  if (elResultJson) {
    elResultJson.textContent = "";
    elResultJson.style.display = "none";
  }
  if (elActionsTitle) elActionsTitle.textContent = "Job";
  if (elActionsHint) elActionsHint.textContent = "";
  if (elDownloadInputXmlBtn) {
    elDownloadInputXmlBtn.disabled = true;
    elDownloadInputXmlBtn.title = "Input XML isn't stored for this job.";
  }
  if (elDownloadOptimizedXmlBtn) {
    elDownloadOptimizedXmlBtn.hidden = true;
    elDownloadOptimizedXmlBtn.disabled = true;
    elDownloadOptimizedXmlBtn.title = "No optimized geometry XML available for this job yet.";
  }
}

function showJson(obj) {
  if (!elResultJson) return;

  const nextText = JSON.stringify(obj ?? {}, null, 2);
  const previousScrollTop = elResultJson.scrollTop;
  const previousDistanceFromBottom =
    elResultJson.scrollHeight - elResultJson.clientHeight - elResultJson.scrollTop;

  elResultJson.style.display = "block";
  if (elResultJson.textContent === nextText) return;

  elResultJson.textContent = nextText;

  if (previousDistanceFromBottom <= 24) {
    elResultJson.scrollTop = elResultJson.scrollHeight;
    return;
  }

  elResultJson.scrollTop = previousScrollTop;
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
  const name = getJobDisplayName(job);
  const id = job?.id ?? job?.jobId ?? "";
  const createdAt = fmtDate(job?.createdAt);
  const status = String(job?.status ?? "").toUpperCase();
  const jobType = getJobTypeLabel(job);

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
          ${jobType ? `<div class="jobs-item__type">${jobType}</div>` : ""}
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

  elList.querySelectorAll('.jobs-item[data-action="view"]').forEach((item) => {
    const openActions = () => {
      const id = item.getAttribute("data-id");
      const job = jobs.find((j) => (j.id ?? j.jobId) === id) ?? null;

      // mark "seen" (fire-and-forget)
      try {
        const ref = doc(db, "jobs", id);
        updateDoc(ref, { needsAttention: 0 });
      } catch (_) {}

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

  if (!_hasLoadedOnce && elList) {
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

      if (_selectedJob?.id) {
        const updated = merged.find((j) => j.id === _selectedJob.id);
        if (updated) showActions(updated);
      }
    },
    (err) => {
      if (!_hasLoadedOnce && elList) {
        elList.innerHTML = `<div class="jobs-item">Failed to load jobs: ${
          err?.message || String(err)
        }</div>`;
      }
    }
  );
}

// ---- Actions: Download JSON, Visualize ----

function buildOutputJsonPayload(job) {
  return job?.result ?? job?.partialResult ?? job?.upstream ?? job ?? { id: job?.id };
}

function getInputXmlPath(job) {
  const directCandidates = [
    job?.inputXmlRef?.path,
    job?.input_xml_ref?.path,
    job?.inputXmlPath,
    job?.input_xml_path,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return "";
}

function findNestedStringValueByKey(root, targetKey) {
  if (!root || typeof root !== "object") return "";

  const seen = new Set();
  const stack = [root];
  let visitedCount = 0;

  while (stack.length > 0 && visitedCount < 500) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;

    seen.add(current);
    visitedCount += 1;

    const directValue = current?.[targetKey];
    if (typeof directValue === "string" && directValue.trim()) {
      return directValue;
    }

    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i -= 1) {
        stack.push(current[i]);
      }
      continue;
    }

    for (const value of Object.values(current)) {
      stack.push(value);
    }
  }

  return "";
}

function getInputXmlText(job) {
  const payload = buildOutputJsonPayload(job);
  const directCandidates = [
    job?.molecule_xml,
    job?.moleculeXml,
    job?.input_xml,
    job?.inputXml,
    payload?.molecule_xml,
    payload?.moleculeXml,
    payload?.input_xml,
    payload?.inputXml,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return (
    findNestedStringValueByKey(payload, "molecule_xml") ||
    findNestedStringValueByKey(payload, "moleculeXml") ||
    findNestedStringValueByKey(payload, "input_xml") ||
    findNestedStringValueByKey(payload, "inputXml") ||
    findNestedStringValueByKey(job, "molecule_xml") ||
    findNestedStringValueByKey(job, "moleculeXml") ||
    findNestedStringValueByKey(job, "input_xml") ||
    findNestedStringValueByKey(job, "inputXml")
  );
}

function getOptimizedGeometryXml(job) {
  const payload = buildOutputJsonPayload(job);
  const directCandidates = [
    job?.optimized_geometry_xml,
    job?.optimizedGeometryXml,
    payload?.optimized_geometry_xml,
    payload?.optimizedGeometryXml,
    payload?.output?.optimized_geometry_xml,
    payload?.output?.optimizedGeometryXml,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return (
    findNestedStringValueByKey(payload, "optimized_geometry_xml") ||
    findNestedStringValueByKey(payload, "optimizedGeometryXml") ||
    findNestedStringValueByKey(job, "optimized_geometry_xml") ||
    findNestedStringValueByKey(job, "optimizedGeometryXml")
  );
}

function downloadTextFile(filename, text, mimeType = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

if (elDownloadJsonBtn) {
  elDownloadJsonBtn.addEventListener("click", () => {
    if (!_selectedJob) return;
    const payload = buildOutputJsonPayload(_selectedJob);
    const id = _selectedJob?.id ?? "job";
    const name = getJobDisplayName(_selectedJob).replace(/[^\w.-]+/g, "_");
    downloadTextFile(`${name || id}_output.json`, JSON.stringify(payload ?? {}, null, 2));
  });
}

if (elDownloadInputXmlBtn) {
  elDownloadInputXmlBtn.disabled = true;
  elDownloadInputXmlBtn.title = "Input XML isn't stored for this job.";
  elDownloadInputXmlBtn.addEventListener("click", async () => {
    if (!_selectedJob) return;

    const inlineInputXml = getInputXmlText(_selectedJob);
    const inputXmlPath = getInputXmlPath(_selectedJob);
    if (!inlineInputXml && !inputXmlPath) return;

    const id = _selectedJob?.id ?? "job";
    const name = getJobDisplayName(_selectedJob).replace(/[^\w.-]+/g, "_");

    elDownloadInputXmlBtn.disabled = true;

    try {
      let inputXml = inlineInputXml;
      if (!inputXml) {
        const bytes = await getBytes(
          storageRef(storage, inputXmlPath),
          MAX_INPUT_XML_DOWNLOAD_BYTES
        );
        inputXml = new TextDecoder().decode(bytes);
      }

      downloadTextFile(
        `${name || id}_input.xml`,
        inputXml,
        "application/xml;charset=utf-8"
      );
    } catch (err) {
      alert(`Download input XML failed: ${err?.message || String(err)}`);
    } finally {
      const hasInputXml = Boolean(getInputXmlText(_selectedJob) || getInputXmlPath(_selectedJob));
      elDownloadInputXmlBtn.disabled = !hasInputXml;
    }
  });
}

if (elDownloadOptimizedXmlBtn) {
  elDownloadOptimizedXmlBtn.hidden = true;
  elDownloadOptimizedXmlBtn.disabled = true;
  elDownloadOptimizedXmlBtn.title = "No optimized geometry XML available for this job yet.";
  elDownloadOptimizedXmlBtn.addEventListener("click", () => {
    if (!_selectedJob) return;

    const optimizedGeometryXml = getOptimizedGeometryXml(_selectedJob);
    if (!optimizedGeometryXml) return;

    const id = _selectedJob?.id ?? "job";
    const name = getJobDisplayName(_selectedJob).replace(/[^\w.-]+/g, "_");
    downloadTextFile(
      `${name || id}_optimized_geometry.xml`,
      optimizedGeometryXml,
      "application/xml;charset=utf-8"
    );
  });
}

async function visualizeSelectedJob() {
  if (!_selectedJob) return;

  const densityPath = _selectedJob?.densityRef?.path;
  if (!densityPath) return;
  if (!elVisualizeBtn) return;

  elVisualizeBtn.disabled = true;

  try {
    const url = await getDownloadURL(storageRef(storage, densityPath));

    window.setViewContext?.(`${_selectedJob?.nickname || _selectedJob?.filename}`);
    setOpen(false);

    if (typeof window.loadDensityFromFirebaseUrl !== "function") {
      alert("Renderer not initialized yet.");
      return;
    }

    window.loadDensityFromFirebaseUrl(url);
  } catch (err) {
    alert(`Visualize failed: ${err?.message || String(err)}`);
  } finally {
    elVisualizeBtn.disabled = false;
  }
}

if (elVisualizeBtn) elVisualizeBtn.addEventListener("click", visualizeSelectedJob);

// ---- Open/close controls (base HTML elements) ----

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
