import { db, storage, auth, getInsightFunctions } from "/src/firebase-init.js";
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
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

import {
  ref as storageRef,
  getBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";

const FUNCTIONS_REGION = "us-central1";
const functions = getInsightFunctions(FUNCTIONS_REGION);
const cancelJobCallable = httpsCallable(functions, "cancel_job");
const submitMoleculeCallable = httpsCallable(functions, "submit_molecule");

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
const DEFAULT_MD_TIME_STEP_FS = 0.25;
const DEFAULT_MD_TRAJECTORY_FILE = "md_trajectory.json";
const MD_CONTINUATION_SUFFIX_RE = /\s+\(cont\.\s*\d+\)$/i;

// Elements that live inside topbar.html (NOT safe to grab until topbar injected)
let elToggleBtn = null;

// state
let _authUser = null;
let _open = false;

let _unsubscribeJobs = null;
let _hasLoadedOnce = false;
let _jobsById = new Map();

// currently selected job
let _selectedJob = null;
let _visualizedJob = null;

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
  if (mode === "molecular_dynamics") return "Molecular Dynamics";

  const jobType = String(job?.jobType ?? job?.job_type ?? "").trim().toLowerCase();
  if (jobType === "single_point") return "Point Solve";
  if (jobType === "geometry_optimization") return "Geometry Optimization";
  if (jobType === "molecular_dynamics") return "Molecular Dynamics";

  return toTitleLabel(mode || jobType);
}

function isGeometryOptimizationJob(job) {
  const mode = String(job?.mode ?? "").trim().toLowerCase();
  if (mode === "geometry_optimization") return true;

  const jobType = String(job?.jobType ?? job?.job_type ?? "").trim().toLowerCase();
  return jobType === "geometry_optimization";
}

function isMolecularDynamicsJob(job) {
  const mode = String(job?.mode ?? "").trim().toLowerCase();
  if (mode === "molecular_dynamics") return true;

  const jobType = String(job?.jobType ?? job?.job_type ?? "").trim().toLowerCase();
  return jobType === "molecular_dynamics";
}

function getJobStatus(job) {
  return String(job?.status ?? "").trim().toUpperCase();
}

function getMdContinuation(job) {
  const payload = buildOutputJsonPayload(job);
  const candidates = [
    job?.mdContinuation,
    job?.md_continuation,
    payload?.mdContinuation,
    payload?.md_continuation,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const parentJobId = String(candidate.parentJobId ?? candidate.parent_job_id ?? "").trim();
      const rootJobId = String(candidate.rootJobId ?? candidate.root_job_id ?? "").trim();
      const segmentIndex = Number(candidate.segmentIndex ?? candidate.segment_index);
      const rootJobName = String(candidate.rootJobName ?? candidate.root_job_name ?? "").trim();
      const parentJobName = String(candidate.parentJobName ?? candidate.parent_job_name ?? "").trim();

      return {
        parentJobId,
        rootJobId: rootJobId || parentJobId,
        segmentIndex: Number.isFinite(segmentIndex) && segmentIndex > 0 ? Math.trunc(segmentIndex) : 0,
        rootJobName,
        parentJobName,
      };
    }
  }

  return null;
}

function getMdContinuationBaseName(job) {
  const continuation = getMdContinuation(job);
  const rootJobName = String(continuation?.rootJobName || "").trim();
  if (rootJobName) return rootJobName;
  return getJobDisplayName(job).replace(MD_CONTINUATION_SUFFIX_RE, "").trim() || getJobDisplayName(job);
}

function showActions(job) {
  _selectedJob = job ?? null;

  if (elResultWrap) elResultWrap.classList.add("is-open");

  const payload = buildOutputJsonPayload(job);
  const name = getJobDisplayName(job);
  const status = getJobStatus(job);
  const createdAt = fmtDate(job?.createdAt);
  const jobType = getJobTypeLabel(job);
  const isGeometryOptimization = isGeometryOptimizationJob(job);
  const isMolecularDynamics = isMolecularDynamicsJob(job);
  const mdContinuation = getMdContinuation(job);
  const inputXmlPath = getInputXmlPath(job);
  const inputXmlInline = getInputXmlText(job);
  const inputXmlUploadError = String(job?.inputXmlUploadError ?? "").trim();

  if (elActionsTitle) {
    elActionsTitle.textContent = `${name} (${status || "UNKNOWN"})`;
  }

  const hintParts = [];
  if (jobType) hintParts.push(`Type: ${jobType}`);
  if (createdAt) hintParts.push(`Created: ${createdAt}`);

  const densityPath = job?.densityRef?.path;
  const moleculeSceneSource = getMoleculeSceneSource(job);
  const optimizedGeometryXml = getOptimizedGeometryXml(job);
  if (!densityPath) {
    hintParts.push(
      moleculeSceneSource
        ? isMolecularDynamics
          ? "MD trajectory output is available for Ball & Stick playback."
          : "No density grid attached. Ball-stick preview is available."
        : isMolecularDynamics
          ? "No MD trajectory output is attached to this job yet."
          : "No density grid attached to this job yet."
    );
  } else if (moleculeSceneSource) {
    hintParts.push(isMolecularDynamics ? "MD trajectory playback is available." : "Ball-stick preview is available.");
  }
  if (inputXmlUploadError) {
    hintParts.push(`Input XML upload issue: ${inputXmlUploadError}`);
  }
  if (isMolecularDynamics && mdContinuation?.parentJobId) {
    const rootLabel = mdContinuation.rootJobName || getMdContinuationBaseName(job);
    hintParts.push(
      `Continuation ${mdContinuation.segmentIndex || 1} of ${rootLabel || "this MD chain"}.`
    );
  }

  if (elActionsHint) elActionsHint.textContent = hintParts.join(" | ");

  if (elVisualizeBtn) {
    const hasVisualization = Boolean(densityPath || moleculeSceneSource);
    elVisualizeBtn.disabled = !hasVisualization;
    elVisualizeBtn.title = densityPath
      ? moleculeSceneSource
        ? isMolecularDynamics
          ? "Loads the MD trajectory with Ball & Stick playback."
          : "Loads the density view and preloads ball-stick geometry."
        : ""
      : moleculeSceneSource
        ? isMolecularDynamics
          ? "Loads the MD trajectory with Ball & Stick playback."
          : "Loads the ball-stick view for this job."
        : isMolecularDynamics
          ? "No MD trajectory output is available for this job."
          : "No density or molecule geometry is available for this job.";
  }

  if (elDownloadInputXmlBtn) {
    const hasInputXml = Boolean(inputXmlPath || inputXmlInline);
    elDownloadInputXmlBtn.disabled = !hasInputXml;
    elDownloadInputXmlBtn.title = hasInputXml
      ? ""
      : inputXmlUploadError || "Input XML isn't stored for this job.";
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

function cacheJobs(jobs) {
  _jobsById = new Map();
  for (const job of jobs || []) {
    const id = String(job?.id ?? job?.jobId ?? "").trim();
    if (!id) continue;
    _jobsById.set(id, job);
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

      cacheJobs(merged);
      renderJobs(merged);
      _hasLoadedOnce = true;

      if (_visualizedJob?.id) {
        const updatedVisualized = merged.find((j) => j.id === _visualizedJob.id);
        if (updatedVisualized) {
          _visualizedJob = updatedVisualized;
        }
      }

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

function getStorageObjectRef(path, bucket = "") {
  const normalizedPath = String(path || "").trim();
  const normalizedBucket = String(bucket || "").trim();
  if (!normalizedPath) return null;

  return normalizedBucket
    ? storageRef(storage, `gs://${normalizedBucket}/${normalizedPath}`)
    : storageRef(storage, normalizedPath);
}

function getStoragePathFromRefLike(refLike) {
  if (typeof refLike === "string" && refLike.trim()) {
    const trimmed = refLike.trim();
    return /^https?:\/\//i.test(trimmed) ? "" : trimmed;
  }

  if (!refLike || typeof refLike !== "object") return "";

  const directCandidates = [
    refLike.path,
    refLike.fullPath,
    refLike.name,
    refLike.object,
    refLike.objectPath,
    refLike.storagePath,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const trimmed = candidate.trim();
      if (/^https?:\/\//i.test(trimmed)) continue;
      return trimmed;
    }
  }

  return "";
}

function getStorageBucketFromRefLike(refLike) {
  if (!refLike || typeof refLike !== "object") return "";

  const directCandidates = [
    refLike.bucket,
    refLike.bucketName,
    refLike.storageBucket,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
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

function getOutputJsonRef(job) {
  const payload = buildOutputJsonPayload(job);
  const refCandidates = [
    job?.outputJsonRef,
    job?.output_json_ref,
    job?.outputRef,
    job?.output_ref,
    job?.resultJsonRef,
    job?.result_json_ref,
    job?.resultRef,
    job?.result_ref,
    job?.artifacts?.outputJson,
    job?.artifacts?.output_json,
    job?.artifacts?.resultJson,
    job?.artifacts?.result_json,
    payload?.outputJsonRef,
    payload?.output_json_ref,
    payload?.outputRef,
    payload?.output_ref,
    payload?.resultJsonRef,
    payload?.result_json_ref,
    payload?.resultRef,
    payload?.result_ref,
    payload?.artifacts?.outputJson,
    payload?.artifacts?.output_json,
  ];

  for (const candidate of refCandidates) {
    const path = getStoragePathFromRefLike(candidate);
    if (path) {
      return {
        path,
        bucket: getStorageBucketFromRefLike(candidate),
      };
    }
  }

  const pathCandidates = [
    job?.outputJsonPath,
    job?.output_json_path,
    job?.outputPath,
    job?.output_path,
    job?.resultJsonPath,
    job?.result_json_path,
    job?.resultPath,
    job?.result_path,
    payload?.outputJsonPath,
    payload?.output_json_path,
    payload?.outputPath,
    payload?.output_path,
    payload?.resultJsonPath,
    payload?.result_json_path,
    payload?.resultPath,
    payload?.result_path,
  ];

  for (const candidate of pathCandidates) {
    if (typeof candidate === "string" && candidate.trim() && !/^https?:\/\//i.test(candidate.trim())) {
      return {
        path: candidate.trim(),
        bucket: "",
      };
    }
  }

  return null;
}

function getOutputJsonUrl(job) {
  const payload = buildOutputJsonPayload(job);
  const directCandidates = [
    job?.outputJsonUrl,
    job?.output_json_url,
    job?.outputUrl,
    job?.output_url,
    job?.resultJsonUrl,
    job?.result_json_url,
    job?.resultUrl,
    job?.result_url,
    job?.outputRef,
    job?.output_ref,
    job?.resultRef,
    job?.result_ref,
    job?.output,
    payload?.outputJsonUrl,
    payload?.output_json_url,
    payload?.outputUrl,
    payload?.output_url,
    payload?.resultJsonUrl,
    payload?.result_json_url,
    payload?.resultUrl,
    payload?.result_url,
    payload?.outputRef,
    payload?.output_ref,
    payload?.resultRef,
    payload?.result_ref,
    payload?.output,
    payload?.output?.outputJsonUrl,
    payload?.output?.output_json_url,
    payload?.output?.url,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) {
      return candidate.trim();
    }
  }

  return "";
}

function getMolecularDynamicsObject(root) {
  const parsedRoot = parseJsonObjectCandidate(root);
  if (!parsedRoot) return null;

  const directCandidates = [
    parsedRoot.MolecularDynamics,
    parsedRoot.result?.MolecularDynamics,
    parsedRoot.output?.MolecularDynamics,
    parsedRoot.partialResult?.MolecularDynamics,
    parsedRoot.data?.MolecularDynamics,
    parsedRoot.response?.MolecularDynamics,
    parsedRoot.runpod?.output?.MolecularDynamics,
    parsedRoot.runpod?.result?.MolecularDynamics,
    parsedRoot.upstream?.output?.MolecularDynamics,
    parsedRoot.upstream?.result?.MolecularDynamics,
  ];

  for (const candidate of directCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  const nested = findNestedObjectValueByKey(parsedRoot, "MolecularDynamics");
  return nested && typeof nested === "object" && !Array.isArray(nested) ? nested : null;
}

function getMdFramesRef(job) {
  const payload = buildOutputJsonPayload(job);
  const refCandidates = [
    job?.framesRef,
    job?.frames_ref,
    job?.MolecularDynamics?.framesRef,
    job?.MolecularDynamics?.frames_ref,
    job?.result?.MolecularDynamics?.framesRef,
    job?.result?.MolecularDynamics?.frames_ref,
    job?.partialResult?.MolecularDynamics?.framesRef,
    job?.partialResult?.MolecularDynamics?.frames_ref,
    payload?.framesRef,
    payload?.frames_ref,
    payload?.MolecularDynamics?.framesRef,
    payload?.MolecularDynamics?.frames_ref,
    payload?.result?.MolecularDynamics?.framesRef,
    payload?.result?.MolecularDynamics?.frames_ref,
    findNestedObjectValueByKey(payload, "framesRef"),
    findNestedObjectValueByKey(payload, "frames_ref"),
    findNestedObjectValueByKey(job, "framesRef"),
    findNestedObjectValueByKey(job, "frames_ref"),
  ];

  for (const candidate of refCandidates) {
    const path = getStoragePathFromRefLike(candidate);
    if (path) {
      return {
        path,
        bucket: getStorageBucketFromRefLike(candidate),
        bytes: Number(candidate?.bytes) || 0,
        contentType: String(candidate?.contentType || candidate?.content_type || "").trim(),
      };
    }
  }

  return null;
}

function getInputXmlBucket(job) {
  const directCandidates = [
    job?.inputXmlRef?.bucket,
    job?.input_xml_ref?.bucket,
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

function findNestedObjectValueByKey(root, targetKey) {
  if (!root || typeof root !== "object") return null;

  const seen = new Set();
  const stack = [root];
  let visitedCount = 0;

  while (stack.length > 0 && visitedCount < 1000) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;

    seen.add(current);
    visitedCount += 1;

    const directValue = current?.[targetKey];
    if (directValue && typeof directValue === "object") {
      return directValue;
    }

    if (Array.isArray(current)) {
      for (let i = Math.min(current.length - 1, 50); i >= 0; i -= 1) {
        stack.push(current[i]);
      }
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (
        key === "frames" ||
        key === "positions" ||
        key === "velocities" ||
        key === "forces" ||
        key === "gradients"
      ) {
        continue;
      }
      stack.push(value);
    }
  }

  return null;
}

function parseJsonObjectCandidate(candidate) {
  if (candidate && typeof candidate === "object") return candidate;
  if (typeof candidate !== "string" || !candidate.trim()) return null;

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function isMolecularDynamicsSceneObject(value) {
  const atomicNumbers = value?.atomicNumbers || value?.atomic_numbers || value?.elements || value?.z;
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray(value.frames) &&
      value.frames.length > 0 &&
      Array.isArray(atomicNumbers) &&
      atomicNumbers.length > 0
  );
}

function withMdSceneLabel(payload, label) {
  const normalizedLabel = String(label || "").trim();
  if (!payload || typeof payload !== "object") return null;

  if (payload.MolecularDynamics && typeof payload.MolecularDynamics === "object") {
    return {
      ...payload,
      label: payload.label || normalizedLabel,
      MolecularDynamics: {
        ...payload.MolecularDynamics,
        label: payload.MolecularDynamics.label || payload.label || normalizedLabel,
      },
    };
  }

  if (isMolecularDynamicsSceneObject(payload)) {
    return {
      label: payload.label || normalizedLabel,
      MolecularDynamics: {
        ...payload,
        label: payload.label || normalizedLabel,
      },
    };
  }

  return null;
}

function getMolecularDynamicsScenePayloadFromRoot(root, label = "") {
  const parsedRoot = parseJsonObjectCandidate(root);
  if (!parsedRoot) return null;

  if (parsedRoot.MolecularDynamics && isMolecularDynamicsSceneObject(parsedRoot.MolecularDynamics)) {
    return withMdSceneLabel(parsedRoot, label);
  }

  if (isMolecularDynamicsSceneObject(parsedRoot)) {
    return withMdSceneLabel(parsedRoot, label);
  }

  const directCandidates = [
    parsedRoot.output,
    parsedRoot.result,
    parsedRoot.partialResult,
    parsedRoot.data,
    parsedRoot.response,
    parsedRoot.runpod?.output,
    parsedRoot.runpod?.result,
    parsedRoot.upstream?.output,
    parsedRoot.upstream?.result,
  ];

  for (const candidate of directCandidates) {
    const nested = getMolecularDynamicsScenePayloadFromRoot(candidate, label);
    if (nested) return nested;
  }

  const nestedMd = findNestedObjectValueByKey(parsedRoot, "MolecularDynamics");
  if (isMolecularDynamicsSceneObject(nestedMd)) {
    return withMdSceneLabel({ MolecularDynamics: nestedMd }, label);
  }

  return null;
}

function getMolecularDynamicsScenePayload(job) {
  const label = getJobDisplayName(job);
  const payload = buildOutputJsonPayload(job);
  const directCandidates = [
    payload,
    job,
    job?.output,
    job?.result,
    job?.partialResult,
    job?.upstream,
    job?.runpod,
  ];

  for (const candidate of directCandidates) {
    const scenePayload = getMolecularDynamicsScenePayloadFromRoot(candidate, label);
    if (scenePayload) return scenePayload;
  }

  return null;
}

async function loadJsonFromStorageRef(refLike, label = "storage JSON") {
  const path = getStoragePathFromRefLike(refLike);
  const bucket = getStorageBucketFromRefLike(refLike);
  const sourceRef = getStorageObjectRef(path, bucket);
  if (!sourceRef) {
    throw new Error(`${label} storage reference is missing.`);
  }

  const url = await getDownloadURL(sourceRef);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${label} (${response.status}).`);
  }

  return response.json();
}

function buildMolecularDynamicsRootWithFrames(compactRoot, framesRoot, label = "", framesRef = null) {
  const compactParsed = parseJsonObjectCandidate(compactRoot);
  const framesScenePayload = getMolecularDynamicsScenePayloadFromRoot(framesRoot, label);
  if (!framesScenePayload?.MolecularDynamics) return null;

  const compactMd = getMolecularDynamicsObject(compactParsed) || {};
  const framesMd = framesScenePayload.MolecularDynamics;
  const normalizedLabel = String(label || framesMd.label || compactMd.label || "MD Trajectory").trim();

  const mergedRoot =
    compactParsed && typeof compactParsed === "object" && !Array.isArray(compactParsed)
      ? { ...compactParsed }
      : {};
  const mergedMd = {
    ...compactMd,
    ...framesMd,
    label: framesMd.label || compactMd.label || normalizedLabel,
  };

  if (framesRef?.path && !mergedMd.framesRef) {
    mergedMd.framesRef = {
      path: framesRef.path,
      ...(framesRef.bucket ? { bucket: framesRef.bucket } : {}),
      ...(framesRef.bytes ? { bytes: framesRef.bytes } : {}),
      ...(framesRef.contentType ? { contentType: framesRef.contentType } : {}),
    };
  }

  mergedRoot.label = mergedRoot.label || normalizedLabel;
  mergedRoot.MolecularDynamics = mergedMd;

  const finalXml = getMdFinalXml(compactParsed);
  if (finalXml && !getMdFinalXml(mergedRoot)) {
    mergedRoot.md_final_xml = finalXml;
  }

  return mergedRoot;
}

async function resolveMolecularDynamicsOutputRoot(root, label = "") {
  const parsedRoot = parseJsonObjectCandidate(root) || root;
  const scenePayload = getMolecularDynamicsScenePayloadFromRoot(parsedRoot, label);
  if (scenePayload) {
    return {
      root: parsedRoot,
      scenePayload,
    };
  }

  const framesRef = getMdFramesRef(parsedRoot);
  if (!framesRef?.path) return null;

  const framesRoot = await loadJsonFromStorageRef(framesRef, "MD frames JSON");
  const mergedRoot = buildMolecularDynamicsRootWithFrames(parsedRoot, framesRoot, label, framesRef);
  const mergedScenePayload = getMolecularDynamicsScenePayloadFromRoot(mergedRoot, label);
  if (!mergedScenePayload) {
    throw new Error("MD frames JSON does not contain a MolecularDynamics trajectory.");
  }

  return {
    root: mergedRoot,
    scenePayload: mergedScenePayload,
  };
}

function getMdFinalXml(root) {
  const parsedRoot = parseJsonObjectCandidate(root);
  if (!parsedRoot) return "";

  return (
    findNestedStringValueByKey(parsedRoot, "md_final_xml") ||
    findNestedStringValueByKey(parsedRoot, "mdFinalXml")
  );
}

function toFlatNumberArray(values) {
  if (ArrayBuffer.isView(values)) {
    return Array.from(values, (value) => Number(value) || 0);
  }
  if (Array.isArray(values)) {
    return values.map((value) => Number(value) || 0);
  }
  return [];
}

function getMdAtomicNumbers(md) {
  return toFlatNumberArray(
    md?.atomicNumbers ||
      md?.atomic_numbers ||
      md?.elements ||
      md?.z
  )
    .map((value) => Math.max(1, Math.trunc(value)))
    .filter((value) => value > 0);
}

function flattenMdAtomVector(atoms, key) {
  if (!Array.isArray(atoms) || !atoms.length) return [];

  const out = new Array(atoms.length * 3);
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i] || {};
    const vector =
      atom?.[key] ||
      atom?.[key === "positions" ? "position" : key === "velocities" ? "velocity" : key];
    const values = toFlatNumberArray(vector);
    if (values.length < 3) return [];
    out[i * 3 + 0] = values[0];
    out[i * 3 + 1] = values[1];
    out[i * 3 + 2] = values[2];
  }

  return out;
}

function getMdFramePositions(frame) {
  if (ArrayBuffer.isView(frame) || Array.isArray(frame)) {
    return toFlatNumberArray(frame);
  }

  if (!frame || typeof frame !== "object") return [];

  if (frame.positions != null) return getMdFramePositions(frame.positions);
  if (frame.coordinates != null) return getMdFramePositions(frame.coordinates);
  if (frame.xyz != null) return getMdFramePositions(frame.xyz);

  const xs = toFlatNumberArray(frame.x);
  const ys = toFlatNumberArray(frame.y);
  const zs = toFlatNumberArray(frame.z);
  if (xs.length && xs.length === ys.length && ys.length === zs.length) {
    const out = new Array(xs.length * 3);
    for (let i = 0; i < xs.length; i += 1) {
      out[i * 3 + 0] = xs[i];
      out[i * 3 + 1] = ys[i];
      out[i * 3 + 2] = zs[i];
    }
    return out;
  }

  return flattenMdAtomVector(frame.atoms, "positions");
}

function getMdFrameVelocities(frame) {
  if (!frame || typeof frame !== "object") return [];

  const flat =
    frame.velocities != null
      ? toFlatNumberArray(frame.velocities)
      : frame.velocity != null
        ? toFlatNumberArray(frame.velocity)
        : [];
  if (flat.length) return flat;

  const xs = toFlatNumberArray(frame.velocityX ?? frame.vx);
  const ys = toFlatNumberArray(frame.velocityY ?? frame.vy);
  const zs = toFlatNumberArray(frame.velocityZ ?? frame.vz);
  if (xs.length && xs.length === ys.length && ys.length === zs.length) {
    const out = new Array(xs.length * 3);
    for (let i = 0; i < xs.length; i += 1) {
      out[i * 3 + 0] = xs[i];
      out[i * 3 + 1] = ys[i];
      out[i * 3 + 2] = zs[i];
    }
    return out;
  }

  return flattenMdAtomVector(frame.atoms, "velocities");
}

function cloneMdFrame(frame) {
  if (ArrayBuffer.isView(frame)) return Array.from(frame);
  if (Array.isArray(frame)) return frame.slice();
  if (!frame || typeof frame !== "object") return frame;

  const clone = { ...frame };
  const vectorKeys = [
    "positions",
    "coordinates",
    "xyz",
    "velocities",
    "velocity",
    "forces",
    "gradients",
    "x",
    "y",
    "z",
    "vx",
    "vy",
    "vz",
    "velocityX",
    "velocityY",
    "velocityZ",
  ];

  for (const key of vectorKeys) {
    if (clone[key] == null) continue;
    if (ArrayBuffer.isView(clone[key])) clone[key] = Array.from(clone[key]);
    else if (Array.isArray(clone[key])) clone[key] = clone[key].slice();
  }

  if (Array.isArray(clone.atoms)) {
    clone.atoms = clone.atoms.map((atom) => {
      if (!atom || typeof atom !== "object") return atom;
      const atomClone = { ...atom };
      for (const key of ["position", "velocity", "force", "gradient", "xyz"]) {
        if (atomClone[key] == null) continue;
        if (ArrayBuffer.isView(atomClone[key])) atomClone[key] = Array.from(atomClone[key]);
        else if (Array.isArray(atomClone[key])) atomClone[key] = atomClone[key].slice();
      }
      return atomClone;
    });
  }

  return clone;
}

function mdFramesMatch(leftFrame, rightFrame, tolerance = 1e-5) {
  const left = getMdFramePositions(leftFrame);
  const right = getMdFramePositions(rightFrame);
  if (!left.length || left.length !== right.length) return false;

  for (let i = 0; i < left.length; i += 1) {
    if (Math.abs(left[i] - right[i]) > tolerance) return false;
  }

  return true;
}

function mdAtomicNumbersMatch(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

async function getJobById(jobId) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) return null;

  if (_jobsById.has(normalizedJobId)) {
    return _jobsById.get(normalizedJobId) || null;
  }

  const jobRef = doc(db, "jobs", normalizedJobId);
  const snap = await getDoc(jobRef);
  if (!snap.exists()) return null;

  const job = { id: snap.id, ...snap.data() };
  _jobsById.set(normalizedJobId, job);
  return job;
}

async function resolveMolecularDynamicsOutput(job) {
  const label = getJobDisplayName(job);
  const payload = buildOutputJsonPayload(job);
  const directCandidates = [
    payload,
    job,
    job?.output,
    job?.result,
    job?.partialResult,
    job?.upstream,
    job?.runpod,
  ];

  for (const candidate of directCandidates) {
    const resolved = await resolveMolecularDynamicsOutputRoot(candidate, label);
    if (resolved) return resolved;
  }

  const outputJsonRef = getOutputJsonRef(job);
  if (outputJsonRef?.path) {
    const data = await loadJsonFromStorageRef(outputJsonRef, "MD output JSON");
    const resolved = await resolveMolecularDynamicsOutputRoot(data, label);
    if (!resolved) {
      throw new Error("Output JSON does not contain a MolecularDynamics trajectory.");
    }

    return resolved;
  }

  const outputJsonUrl = getOutputJsonUrl(job);
  if (outputJsonUrl) {
    const response = await fetch(outputJsonUrl);
    if (!response.ok) {
      throw new Error(`Failed to load MD output JSON (${response.status}).`);
    }

    const data = await response.json();
    const resolved = await resolveMolecularDynamicsOutputRoot(data, label);
    if (!resolved) {
      throw new Error("Output JSON does not contain a MolecularDynamics trajectory.");
    }

    return resolved;
  }

  throw new Error("No MD output JSON is available for this job yet.");
}

async function resolveMolecularDynamicsChain(job) {
  const chain = [];
  const visited = new Set();
  let current = job;

  while (current) {
    const currentId = String(current?.id ?? current?.jobId ?? "").trim();
    if (currentId) {
      if (visited.has(currentId)) {
        throw new Error("Detected a loop in the MD continuation chain.");
      }
      visited.add(currentId);
    }

    chain.unshift(current);

    const continuation = getMdContinuation(current);
    const parentJobId = String(continuation?.parentJobId || "").trim();
    if (!parentJobId) break;

    const parentJob = await getJobById(parentJobId);
    if (!parentJob) {
      throw new Error(`Unable to load the previous MD segment (${parentJobId}).`);
    }
    current = parentJob;
  }

  return chain;
}

function mergeMolecularDynamicsSegments(segments, label) {
  if (!Array.isArray(segments) || !segments.length) return null;

  const firstPayload = segments[0]?.scenePayload;
  const firstMd = firstPayload?.MolecularDynamics;
  const expectedAtomicNumbers = getMdAtomicNumbers(firstMd);
  if (!expectedAtomicNumbers.length) {
    throw new Error("MD continuation is missing atomic numbers.");
  }

  const mergedFrames = [];
  let previousLastFrame = null;
  let previousLastTimeFs = 0;
  let previousLastStep = 0;

  for (const segment of segments) {
    const md = segment?.scenePayload?.MolecularDynamics;
    if (!md || !Array.isArray(md.frames) || !md.frames.length) {
      throw new Error("A linked MD segment is missing frame data.");
    }

    const segmentAtomicNumbers = getMdAtomicNumbers(md);
    if (!mdAtomicNumbersMatch(expectedAtomicNumbers, segmentAtomicNumbers)) {
      throw new Error("Linked MD segments use different atom lists and cannot be stitched together.");
    }

    const shouldSkipFirstFrame =
      mergedFrames.length > 0 && mdFramesMatch(previousLastFrame, md.frames[0]);
    const startIndex = shouldSkipFirstFrame ? 1 : 0;

    for (let i = startIndex; i < md.frames.length; i += 1) {
      const originalFrame = md.frames[i];
      const clonedFrame = cloneMdFrame(originalFrame);

      if (clonedFrame && typeof clonedFrame === "object" && !Array.isArray(clonedFrame)) {
        const originalTimeFs = Number(originalFrame?.timeFs);
        const originalStep = Number(originalFrame?.step);
        if (Number.isFinite(originalTimeFs)) {
          clonedFrame.timeFs = originalTimeFs + previousLastTimeFs;
        }
        if (Number.isFinite(originalStep)) {
          clonedFrame.step = originalStep + previousLastStep;
        } else {
          clonedFrame.step = mergedFrames.length;
        }
        clonedFrame.frame = mergedFrames.length;
      }

      mergedFrames.push(clonedFrame);
    }

    previousLastFrame = md.frames[md.frames.length - 1];
    const lastMergedFrame = mergedFrames[mergedFrames.length - 1];
    const lastMergedTimeFs = Number(lastMergedFrame?.timeFs);
    const lastMergedStep = Number(lastMergedFrame?.step);
    if (Number.isFinite(lastMergedTimeFs)) previousLastTimeFs = lastMergedTimeFs;
    if (Number.isFinite(lastMergedStep)) previousLastStep = lastMergedStep;
  }

  const latestSegment = segments[segments.length - 1];
  const latestRoot = latestSegment?.root && typeof latestSegment.root === "object" ? latestSegment.root : {};
  const latestMd = latestSegment?.scenePayload?.MolecularDynamics || {};
  const normalizedLabel = String(label || latestMd.label || latestRoot.label || "MD Trajectory").trim();
  const totalStepCount = Math.max(0, mergedFrames.length - 1);

  return {
    ...latestRoot,
    label: normalizedLabel,
    MolecularDynamics: {
      ...latestMd,
      label: normalizedLabel,
      atomicNumbers: expectedAtomicNumbers,
      frames: mergedFrames,
      frameCount: mergedFrames.length,
      completedStepCount: totalStepCount,
      stepCount: totalStepCount,
    },
  };
}

async function resolveStitchedMolecularDynamicsScenePayload(job) {
  const chainJobs = await resolveMolecularDynamicsChain(job);
  const segments = [];

  for (const chainJob of chainJobs) {
    const resolvedOutput = await resolveMolecularDynamicsOutput(chainJob);
    segments.push({
      job: chainJob,
      root: resolvedOutput.root,
      scenePayload: resolvedOutput.scenePayload,
    });
  }

  const continuation = getMdContinuation(job);
  const label =
    String(continuation?.rootJobName || "").trim() ||
    getMdContinuationBaseName(chainJobs[0] || job) ||
    getJobDisplayName(job);

  return mergeMolecularDynamicsSegments(segments, label);
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

function getMoleculeSceneSource(job) {
  const mdPayload = getMolecularDynamicsScenePayload(job);
  if (mdPayload) {
    const md = mdPayload.MolecularDynamics || {};
    return {
      kind: "inline_scene",
      scene: mdPayload,
      label: getJobDisplayName(job),
      sourceKey: [
        "md:inline",
        job?.id || job?.jobId || getJobDisplayName(job),
        md.frameCount || md.frames?.length || 0,
        md.completedStepCount || md.stepCount || "",
      ].join(":"),
    };
  }

  const mdFramesRef = getMdFramesRef(job);
  if (isMolecularDynamicsJob(job) && mdFramesRef?.path) {
    return {
      kind: "md_frames_json",
      path: mdFramesRef.path,
      bucket: mdFramesRef.bucket,
      label: getJobDisplayName(job),
      sourceKey: [
        "md:frames_json",
        mdFramesRef.bucket || "",
        mdFramesRef.path,
        mdFramesRef.bytes || "",
      ].join(":"),
    };
  }

  const outputJsonRef = getOutputJsonRef(job);
  if (isMolecularDynamicsJob(job) && outputJsonRef?.path) {
    return {
      kind: "storage_json",
      path: outputJsonRef.path,
      bucket: outputJsonRef.bucket,
      label: getJobDisplayName(job),
      sourceKey: `md:storage_json:${outputJsonRef.path}`,
    };
  }

  const outputJsonUrl = getOutputJsonUrl(job);
  if (isMolecularDynamicsJob(job) && outputJsonUrl) {
    return {
      kind: "remote_json_url",
      url: outputJsonUrl,
      label: getJobDisplayName(job),
      sourceKey: `md:remote_json_url:${outputJsonUrl}`,
    };
  }

  if (isMolecularDynamicsJob(job)) {
    return null;
  }

  const optimizedGeometryXml = getOptimizedGeometryXml(job);
  if (optimizedGeometryXml) {
    return {
      kind: "inline_xml",
      xml: optimizedGeometryXml,
      label: getJobDisplayName(job),
    };
  }

  const inputXmlInline = getInputXmlText(job);
  if (inputXmlInline) {
    return {
      kind: "inline_xml",
      xml: inputXmlInline,
      label: getJobDisplayName(job),
    };
  }

  const inputXmlPath = getInputXmlPath(job);
  if (inputXmlPath) {
    return {
      kind: "storage_path",
      path: inputXmlPath,
      bucket: getInputXmlBucket(job),
      label: getJobDisplayName(job),
    };
  }

  return null;
}

function getMoleculeSceneSourceKey(job) {
  const source = getMoleculeSceneSource(job);
  if (!source) return "";

  if (source.kind === "storage_path") {
    return `storage_path:${source.path}`;
  }

  if (source.kind === "storage_json") {
    return source.sourceKey || `storage_json:${source.path}`;
  }

  if (source.kind === "md_frames_json") {
    return source.sourceKey || `md_frames_json:${source.path}`;
  }

  if (source.kind === "remote_json_url") {
    return source.sourceKey || `remote_json_url:${source.url}`;
  }

  if (source.kind === "inline_scene") {
    return source.sourceKey || `inline_scene:${source.label || ""}`;
  }

  if (source.kind === "inline_xml") {
    return `inline_xml:${source.xml}`;
  }

  return "";
}

function getCurrentMoleculeJob() {
  return _visualizedJob || _selectedJob || null;
}

window.getCurrentMoleculeSceneSource = function getCurrentMoleculeSceneSource() {
  return getMoleculeSceneSource(getCurrentMoleculeJob());
};

window.getCurrentMoleculeSceneSourceKey = function getCurrentMoleculeSceneSourceKey() {
  return getMoleculeSceneSourceKey(getCurrentMoleculeJob());
};

async function loadMolecularDynamicsSceneFromJsonUrl(url, sceneOptions = {}) {
  if (!url) return false;
  if (typeof window.loadMoleculeScene !== "function") return false;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load MD output JSON (${response.status}).`);
  }

  const data = await response.json();
  const scenePayload = getMolecularDynamicsScenePayloadFromRoot(data, sceneOptions.label || "MD Trajectory");
  if (!scenePayload) {
    throw new Error("Output JSON does not contain a MolecularDynamics trajectory.");
  }

  return Boolean(
    window.loadMoleculeScene(scenePayload, {
      ...sceneOptions,
      visualizationMode: "ballstick",
    })
  );
}

async function loadMoleculeSceneForJob(job, options = {}) {
  const source = getMoleculeSceneSource(job);
  if (!source) return false;

  const sceneOptions = {
    autoEnterMode: options.autoEnterMode,
    label: options.label || source.label || getJobDisplayName(job),
    preserveCamera: options.preserveCamera,
    sourceKey: options.sourceKey || getMoleculeSceneSourceKey(job),
    visualizationMode: options.visualizationMode,
  };

  if (isMolecularDynamicsJob(job)) {
    if (typeof window.loadMoleculeScene !== "function") return false;
    const scenePayload = await resolveStitchedMolecularDynamicsScenePayload(job);
    if (!scenePayload) return false;
    return Boolean(
      window.loadMoleculeScene(scenePayload, {
        ...sceneOptions,
        visualizationMode: "ballstick",
      })
    );
  }

  if (source.kind === "inline_xml") {
    if (typeof window.loadMoleculeSceneFromXml !== "function") return false;
    return Boolean(window.loadMoleculeSceneFromXml(source.xml, sceneOptions));
  }

  if (source.kind === "inline_scene") {
    if (typeof window.loadMoleculeScene !== "function") return false;
    return Boolean(window.loadMoleculeScene(source.scene, sceneOptions));
  }

  if (source.kind === "storage_json") {
    const sourceRef = getStorageObjectRef(source.path, source.bucket);
    if (!sourceRef) return false;
    const url = await getDownloadURL(sourceRef);
    return loadMolecularDynamicsSceneFromJsonUrl(url, sceneOptions);
  }

  if (source.kind === "remote_json_url") {
    return loadMolecularDynamicsSceneFromJsonUrl(source.url, sceneOptions);
  }

  if (source.kind === "storage_path") {
    if (typeof window.loadMoleculeSceneFromUrl !== "function") return false;
    const sourceRef = getStorageObjectRef(source.path, source.bucket);
    if (!sourceRef) return false;
    const url = await getDownloadURL(sourceRef);
    return Boolean(
      await window.loadMoleculeSceneFromUrl(url, {
        ...sceneOptions,
        silentErrors: true,
      })
    );
  }

  return false;
}

window.loadCurrentJobMoleculeScene = async function loadCurrentJobMoleculeScene(options = {}) {
  const job = getCurrentMoleculeJob();
  if (!job) return false;
  return loadMoleculeSceneForJob(job, options);
};

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatXmlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "0";
}

function minifyXmlText(xmlText) {
  return String(xmlText || "")
    .replace(/>\s+</g, "><")
    .replace(/\r?\n/g, "")
    .trim();
}

function xmlLocalName(node) {
  return (node && (node.localName || node.nodeName || "")).split(":").pop();
}

function findXmlFirstByLocalName(root, localName) {
  if (!root || typeof root.getElementsByTagName !== "function") return null;
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i += 1) {
    if (xmlLocalName(all[i]) === localName) return all[i];
  }
  return null;
}

function buildMdVectorXml(tagName, entryTagName, values) {
  const entries = toFlatNumberArray(values)
    .map((value) => `<${entryTagName}>${formatXmlNumber(value)}</${entryTagName}>`)
    .join("");
  return `<${tagName}>${entries}</${tagName}>`;
}

function buildMolecularDynamicsContinuationXmlFromParts(parts, mdConfig) {
  const stepCount = Math.max(1, Math.trunc(Number(mdConfig?.stepCount) || 1));
  const timeStepFs = Number(mdConfig?.timeStepFs) || DEFAULT_MD_TIME_STEP_FS;
  const trajectoryFile = String(mdConfig?.trajectoryFile || DEFAULT_MD_TRAJECTORY_FILE).trim() || DEFAULT_MD_TRAJECTORY_FILE;
  const initialVelocityXml = String(parts?.initialVelocityXml || "").trim();

  return minifyXmlText(`<?xml version="1.0"?>
<PC-Compounds xmlns="http://www.ncbi.nlm.nih.gov">
  <PC-Compound>
    <PC-Compound_atoms>
      <PC-Atoms>
        ${parts?.atomsXml || ""}
      </PC-Atoms>
    </PC-Compound_atoms>
    <PC-Compound_coords>
      <PC-Coordinates>
        <PC-Coordinates_conformers>
          <PC-Conformer>
            ${parts?.xXml || ""}
            ${parts?.yXml || ""}
            ${parts?.zXml || ""}
          </PC-Conformer>
        </PC-Coordinates_conformers>
      </PC-Coordinates>
    </PC-Compound_coords>
    <InsightMD>
      <SchemaVersion>1</SchemaVersion>
      <StepCount>${stepCount}</StepCount>
      <TimeStepFs>${formatXmlNumber(timeStepFs)}</TimeStepFs>
      <TrajectoryFile>${escapeXmlText(trajectoryFile)}</TrajectoryFile>
      ${initialVelocityXml}
    </InsightMD>
  </PC-Compound>
</PC-Compounds>`);
}

function rebuildMdContinuationXmlFromExistingXml(xmlText, mdConfig) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserErrors = doc.getElementsByTagName("parsererror");
  if (parserErrors && parserErrors.length) {
    throw new Error("md_final_xml parse error.");
  }

  const atomsEl = findXmlFirstByLocalName(doc, "PC-Atoms_element");
  const xEl = findXmlFirstByLocalName(doc, "PC-Conformer_x");
  const yEl = findXmlFirstByLocalName(doc, "PC-Conformer_y");
  const zEl = findXmlFirstByLocalName(doc, "PC-Conformer_z");
  const velocityUnitsEl = findXmlFirstByLocalName(doc, "VelocityUnits");
  const velocityXEl = findXmlFirstByLocalName(doc, "VelocityX");
  const velocityYEl = findXmlFirstByLocalName(doc, "VelocityY");
  const velocityZEl = findXmlFirstByLocalName(doc, "VelocityZ");

  if (!atomsEl || !xEl || !yEl || !zEl) {
    throw new Error("md_final_xml is missing atom or coordinate tags.");
  }
  if (!velocityXEl || !velocityYEl || !velocityZEl) {
    throw new Error("md_final_xml is missing the final velocity vectors.");
  }

  const serializer = new XMLSerializer();
  return buildMolecularDynamicsContinuationXmlFromParts(
    {
      atomsXml: serializer.serializeToString(atomsEl),
      xXml: serializer.serializeToString(xEl),
      yXml: serializer.serializeToString(yEl),
      zXml: serializer.serializeToString(zEl),
      initialVelocityXml: [
        velocityUnitsEl ? serializer.serializeToString(velocityUnitsEl) : "",
        serializer.serializeToString(velocityXEl),
        serializer.serializeToString(velocityYEl),
        serializer.serializeToString(velocityZEl),
      ]
        .filter(Boolean)
        .join(""),
    },
    mdConfig
  );
}

function buildMdContinuationXmlFromTrajectory(md, mdConfig) {
  const atomicNumbers = getMdAtomicNumbers(md);
  if (!atomicNumbers.length) {
    throw new Error("MD continuation is missing atomic numbers.");
  }

  const lastFrame = Array.isArray(md?.frames) && md.frames.length ? md.frames[md.frames.length - 1] : null;
  if (!lastFrame) {
    throw new Error("MD continuation is missing a final frame.");
  }

  const positions = getMdFramePositions(lastFrame);
  const velocities = getMdFrameVelocities(lastFrame);
  const expectedValueCount = atomicNumbers.length * 3;
  if (positions.length !== expectedValueCount) {
    throw new Error("MD continuation is missing final coordinates for every atom.");
  }
  if (velocities.length !== expectedValueCount) {
    throw new Error("MD continuation is missing final velocities for every atom.");
  }

  const xs = [];
  const ys = [];
  const zs = [];
  const velocityXs = [];
  const velocityYs = [];
  const velocityZs = [];

  for (let i = 0; i < atomicNumbers.length; i += 1) {
    xs.push(positions[i * 3 + 0]);
    ys.push(positions[i * 3 + 1]);
    zs.push(positions[i * 3 + 2]);
    velocityXs.push(velocities[i * 3 + 0]);
    velocityYs.push(velocities[i * 3 + 1]);
    velocityZs.push(velocities[i * 3 + 2]);
  }

  return buildMolecularDynamicsContinuationXmlFromParts(
    {
      atomsXml: `<PC-Atoms_element>${atomicNumbers
        .map((atomicNumber) => `<PC-Element>${Math.trunc(atomicNumber)}</PC-Element>`)
        .join("")}</PC-Atoms_element>`,
      xXml: buildMdVectorXml("PC-Conformer_x", "PC-Conformer_x_E", xs),
      yXml: buildMdVectorXml("PC-Conformer_y", "PC-Conformer_y_E", ys),
      zXml: buildMdVectorXml("PC-Conformer_z", "PC-Conformer_z_E", zs),
      initialVelocityXml: [
        `<VelocityUnits>${escapeXmlText(md?.velocityUnits || "angstrom_per_fs")}</VelocityUnits>`,
        buildMdVectorXml("VelocityX", "VelocityX_E", velocityXs),
        buildMdVectorXml("VelocityY", "VelocityY_E", velocityYs),
        buildMdVectorXml("VelocityZ", "VelocityZ_E", velocityZs),
      ].join(""),
    },
    mdConfig
  );
}

function getMdTimeStepFs(job, md) {
  const candidates = [
    md?.timeStepFs,
    md?.time_step_fs,
    job?.mdConfig?.timeStepFs,
    job?.mdConfig?.time_step_fs,
    job?.md_config?.timeStepFs,
    job?.md_config?.time_step_fs,
  ];

  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return DEFAULT_MD_TIME_STEP_FS;
}

function getMdTrajectoryFile(job, md) {
  const candidates = [
    md?.trajectoryFile,
    md?.trajectory_file,
    job?.mdConfig?.trajectoryFile,
    job?.mdConfig?.trajectory_file,
    job?.md_config?.trajectoryFile,
    job?.md_config?.trajectory_file,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }

  return DEFAULT_MD_TRAJECTORY_FILE;
}

function buildMdContinuationSubmissionXml(resolvedOutput, job, mdContinuationConfig = {}) {
  const md = resolvedOutput?.scenePayload?.MolecularDynamics;
  if (!md) {
    throw new Error("MD continuation output is missing trajectory data.");
  }

  const mdConfig = {
    stepCount: Math.max(1, Math.trunc(Number(mdContinuationConfig?.stepCount) || 1)),
    timeStepFs:
      Number(mdContinuationConfig?.timeStepFs) > 0
        ? Number(mdContinuationConfig.timeStepFs)
        : getMdTimeStepFs(job, md),
    trajectoryFile:
      String(mdContinuationConfig?.trajectoryFile || "").trim() ||
      getMdTrajectoryFile(job, md),
  };

  const finalXml = getMdFinalXml(resolvedOutput?.root);
  if (finalXml) {
    try {
      return rebuildMdContinuationXmlFromExistingXml(finalXml, mdConfig);
    } catch (err) {
      console.warn("Falling back to MD trajectory data for continuation XML:", err);
    }
  }

  return buildMdContinuationXmlFromTrajectory(md, mdConfig);
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
  elDownloadJsonBtn.addEventListener("click", async () => {
    if (!_selectedJob) return;
    const id = _selectedJob?.id ?? "job";
    const name = getJobDisplayName(_selectedJob).replace(/[^\w.-]+/g, "_");
    const shouldResolveMdPayload = Boolean(
      isMolecularDynamicsJob(_selectedJob) &&
        (
          getMdFramesRef(_selectedJob)?.path ||
          getOutputJsonRef(_selectedJob)?.path ||
          getOutputJsonUrl(_selectedJob)
        )
    );

    elDownloadJsonBtn.disabled = true;

    try {
      const payload = shouldResolveMdPayload
        ? (await resolveMolecularDynamicsOutput(_selectedJob)).root
        : buildOutputJsonPayload(_selectedJob);
      downloadTextFile(`${name || id}_output.json`, JSON.stringify(payload ?? {}, null, 2));
    } catch (err) {
      alert(`Download JSON failed: ${err?.message || String(err)}`);
    } finally {
      elDownloadJsonBtn.disabled = false;
    }
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
        const inputXmlRef = getStorageObjectRef(inputXmlPath, getInputXmlBucket(_selectedJob));
        if (!inputXmlRef) {
          throw new Error("Input XML storage reference is missing.");
        }
        const bytes = await getBytes(
          inputXmlRef,
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

function getSuggestedContinuationFrameCount(job, md) {
  return Math.max(
    1,
    Math.trunc(
      Number(
        md?.frameCount ??
          md?.frames?.length ??
          md?.completedStepCount ??
          md?.stepCount ??
          Math.max(1, (md?.frames?.length || 1) - 1)
      ) || 1
    )
  );
}

async function submitMoreMdFrames(job, continuationConfig = {}) {
  const jobId = String(job?.id ?? job?.jobId ?? "").trim();
  if (!jobId) {
    throw new Error("MD continuation requires a saved job id.");
  }

  const resolvedOutput = await resolveMolecularDynamicsOutput(job);
  const md = resolvedOutput?.scenePayload?.MolecularDynamics;
  if (!md || !Array.isArray(md.frames) || !md.frames.length) {
    throw new Error("This MD job does not have any trajectory frames to continue from yet.");
  }

  const extraFrameCount = Math.trunc(Number(continuationConfig?.mdConfig?.step_count) || 0);
  if (!Number.isFinite(extraFrameCount) || extraFrameCount < 1) {
    throw new Error("Please enter a whole number greater than 0.");
  }

  const continuation = getMdContinuation(job);
  const rootJobId = String(continuation?.rootJobId || jobId).trim() || jobId;
  const rootJob = rootJobId !== jobId ? await getJobById(rootJobId) : job;
  const rootJobName = getMdContinuationBaseName(rootJob || job) || getJobDisplayName(rootJob || job);
  const parentJobName = getJobDisplayName(job);
  const segmentIndex = Math.max(1, Number(continuation?.segmentIndex || 0) + 1);
  const nickname =
    String(continuationConfig?.nickname || "").trim() ||
    `${rootJobName} (cont. ${segmentIndex})`;
  const fileName =
      String(job?.filename || "").trim() ||
      `${(rootJobName || "md").replace(/[^\w.-]+/g, "_") || "md"}_continued.xml`;
  const hardwareTier =
    String(continuationConfig?.hardware_tier || job?.hardwareTier || job?.hardware_tier || "budget").trim() ||
    "budget";
  const maxRuntimeSec = Math.max(
    60,
    Math.trunc(
      Number(continuationConfig?.max_runtime_sec ?? job?.maxRuntimeSec ?? job?.max_runtime_sec) || 30 * 60
    )
  );
  const timeStepFs =
    Number(continuationConfig?.mdConfig?.time_step_fs) > 0
      ? Number(continuationConfig.mdConfig.time_step_fs)
      : getMdTimeStepFs(job, md);
  const trajectoryFile =
    String(continuationConfig?.mdConfig?.trajectory_file || "").trim() ||
    getMdTrajectoryFile(job, md);
  const continuationXml = buildMdContinuationSubmissionXml(resolvedOutput, job, {
    stepCount: extraFrameCount,
    timeStepFs,
    trajectoryFile,
  });

  const response = await submitMoleculeCallable({
    molecule_xml: continuationXml,
    fileName,
    nickname,
    mode: "molecular_dynamics",
    hardware_tier: hardwareTier,
    max_runtime_sec: maxRuntimeSec,
    md_step_count: extraFrameCount,
    md_time_step_fs: timeStepFs,
    md_total_time_fs: extraFrameCount * timeStepFs,
    md_trajectory_file: trajectoryFile,
    md_parent_job_id: jobId,
    md_root_job_id: rootJobId,
    md_segment_index: segmentIndex,
    md_root_job_name: rootJobName,
    md_parent_job_name: parentJobName,
  });

  return response?.data ?? response;
}

async function openSimMoreFramesModal(job) {
  if (typeof window.openSubmitModal !== "function") {
    throw new Error("Submit modal is not available yet.");
  }

  const inlineMdPayload = getMolecularDynamicsScenePayload(job)?.MolecularDynamics || null;
  const continuation = getMdContinuation(job);
  const jobId = String(job?.id ?? job?.jobId ?? "").trim();
  const rootJobId = String(continuation?.rootJobId || jobId).trim() || jobId;
  const rootJob = rootJobId !== jobId ? await getJobById(rootJobId) : job;
  const rootJobName = getMdContinuationBaseName(rootJob || job) || getJobDisplayName(rootJob || job);
  const parentJobName = getJobDisplayName(job);
  const segmentIndex = Math.max(1, Number(continuation?.segmentIndex || 0) + 1);
  const suggestedNickname = `${rootJobName} (cont. ${segmentIndex})`;
  const displayFileName =
    String(job?.filename || rootJob?.filename || rootJobName || "").trim() ||
    suggestedNickname;
  const atomCount =
    Math.max(
      0,
      Math.trunc(Number(job?.nAtoms ?? job?.n_atoms) || 0)
    ) ||
    Math.max(0, Math.trunc(Number(inlineMdPayload?.atomCount || inlineMdPayload?.atomicNumbers?.length) || 0));
  const timeStepFs = getMdTimeStepFs(job, inlineMdPayload || {});
  const suggestedFrameCount = getSuggestedContinuationFrameCount(job, inlineMdPayload || {});
  const maxRuntimeMinutes = Math.max(
    1,
    Math.ceil(Math.max(60, Number(job?.maxRuntimeSec ?? job?.max_runtime_sec) || 30 * 60) / 60)
  );

  setOpen(false);
  window.openSubmitModal({
    fileName: String(job?.filename || "").trim() || displayFileName,
    displayFileName,
    nAtoms: atomCount,
    moleculeXml: "",
    mdInitialVelocityXml: "",
    selectedMode: "molecular_dynamics",
    lockedMode: "molecular_dynamics",
    hideTabs: true,
    title: "Sim More Frames",
    contextMessage: `Continue ${parentJobName} from its last MD frame. The next segment will reuse the final coordinates and velocities, then stitch into the same playback chain.`,
    submitLabel: "Submit More Frames",
    submittingLabel: "Submitting More Frames...",
    mdModeTitle: "Continue Molecular Dynamics",
    mdModeDescription: `Append another MD segment to ${rootJobName} without restarting from the original structure.`,
    mdInputHint: "This continuation starts from the selected job's final frame and carries forward its final velocities.",
    initialNickname: suggestedNickname,
    initialHardwareTier: String(job?.hardwareTier ?? job?.hardware_tier ?? "budget").trim() || "budget",
    initialMaxRuntimeMinutes: maxRuntimeMinutes,
    initialMdStepCount: suggestedFrameCount,
    initialMdTimeStepFs: timeStepFs,
    initialFocusInput: "mdStepCount",
    disabledInputs: ["mdTimeStepFs"],
    onSubmit: async ({ nickname, hardware_tier, max_runtime_sec, mdConfig }) => {
      return submitMoreMdFrames(job, {
        nickname,
        hardware_tier,
        max_runtime_sec,
        mdConfig,
      });
    },
  });
}

window.canSimMoreFramesForCurrentJob = function canSimMoreFramesForCurrentJob() {
  const job = getCurrentMoleculeJob();
  return Boolean(job && isMolecularDynamicsJob(job) && getMoleculeSceneSource(job));
};

window.openCurrentMdContinuationModal = async function openCurrentMdContinuationModal() {
  const job = getCurrentMoleculeJob();
  if (!job || !isMolecularDynamicsJob(job)) {
    throw new Error("No molecular dynamics job is currently loaded.");
  }
  return openSimMoreFramesModal(job);
};

async function visualizeSelectedJob() {
  if (!_selectedJob) return;

  const job = _selectedJob;
  const densityPath = job?.densityRef?.path;
  const moleculeSceneSource = getMoleculeSceneSource(job);
  if (!densityPath && !moleculeSceneSource) return;
  if (!elVisualizeBtn) return;

  elVisualizeBtn.disabled = true;

  try {
    const viewLabel = `${job?.nickname || job?.filename || job?.id || "Molecule"}`;
    const densityRef = getStorageObjectRef(densityPath, job?.densityRef?.bucket);
    const densityUrlPromise = densityPath
      ? densityRef
        ? getDownloadURL(densityRef)
        : Promise.reject(new Error("Density storage reference is missing."))
      : Promise.resolve("");

    _visualizedJob = job;
    window.setViewContext?.(viewLabel);
    setOpen(false);

    let moleculeLoaded = false;
    if (moleculeSceneSource) {
      try {
        moleculeLoaded = await loadMoleculeSceneForJob(job, {
          autoEnterMode: !densityPath,
          label: viewLabel,
        });
      } catch (moleculeErr) {
        if (!densityPath) {
          throw moleculeErr;
        }
        console.warn("Unable to preload molecule scene:", moleculeErr);
      }
    }

    const densityUrl = await densityUrlPromise;
    if (densityUrl) {
      if (typeof window.loadDensityFromFirebaseUrl !== "function") {
        if (!moleculeLoaded) {
          alert("Renderer not initialized yet.");
        }
        return;
      }

      window.loadDensityFromFirebaseUrl(densityUrl);
      return;
    }

    if (!moleculeLoaded) {
      alert("Renderer not initialized yet.");
    }
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
