// /src/molecule-drop.js
//
// Drag-and-drop XML -> extract PC sections -> call Firebase callable submit_molecule.
// Drag-and-drop MD frames JSON -> open local trajectory playback.
//
// Expects these elements in DOM:
//   #dropOverlay
//   #loadingText
//   #loadingProgressBar
//
// Uses existing Firebase app/auth from /src/firebase-init.js

import { auth, getInsightFunctions } from "/src/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

// -----------------------------
// Config
// -----------------------------
const FUNCTIONS_REGION = "us-central1";
const FUNCTION_NAME = "submit_molecule";

// Required structure (client-side preflight only; server is source of truth)
const REQUIRED = [
  { parent: "PC-Atoms_element", child: "PC-Element" },
  { parent: "PC-Conformer_x", child: "PC-Conformer_x_E" },
  { parent: "PC-Conformer_y", child: "PC-Conformer_y_E" },
  { parent: "PC-Conformer_z", child: "PC-Conformer_z_E" },
];

// -----------------------------
// UI helpers
// -----------------------------
const overlay = document.getElementById("dropOverlay");

function setStatus(text) {
  const el = document.getElementById("loadingText");
  if (el) el.textContent = text;
}
function showOverlay() {
  if (overlay) overlay.classList.add("active");
}
function hideOverlay() {
  if (overlay) overlay.classList.remove("active");
}

// -----------------------------
// Drag/drop guard
// Keep preventDefault, but do NOT stopPropagation here.
// Stopping propagation can break your own handlers depending on ordering.
// -----------------------------
function preventDefault(e) {
  e.preventDefault();
}
["dragenter", "dragover", "dragleave", "drop"].forEach((evt) => {
  window.addEventListener(evt, preventDefault, true);
});

// Overlay behavior
window.addEventListener("dragenter", showOverlay, true);
window.addEventListener(
  "dragleave",
  (e) => {
    if (e.relatedTarget === null) hideOverlay();
  },
  true
);
window.addEventListener(
  "drop",
  async (e) => {
    try {
      // Always dismiss overlay on drop, regardless of file validity
      hideOverlay();

      if (document.getElementById("submitOverlay")?.classList.contains("active")) return;

      const file = e.dataTransfer?.files?.[0];
      if (!file) return;

      await handleFile(file);
    } finally {
      // Defensive: ensure it's hidden even if handleFile throws
      hideOverlay();
    }
  },
  true
);

// -----------------------------
// Auth gating
// -----------------------------
let authReady = false;
let authUser = null;

onAuthStateChanged(auth, (user) => {
  authUser = user;
  authReady = true;

  if (!user) {
    setStatus("Not signed in. Redirecting to /auth.html...");
    window.location.href = "/auth.html";
  } else {
    setStatus("Signed in. Drop an XML file or MD frames JSON.");
  }
});

function waitForAuthReady() {
  if (authReady) return Promise.resolve(authUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

// -----------------------------
// XML helpers (namespace-tolerant)
// -----------------------------
function localName(node) {
  return (node && (node.localName || node.nodeName || "")).split(":").pop();
}

function findFirstByLocalName(root, name) {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (localName(all[i]) === name) return all[i];
  }
  return null;
}

function childrenByLocalName(parent, name) {
  if (!parent) return [];
  const out = [];
  for (let i = 0; i < parent.children.length; i++) {
    if (localName(parent.children[i]) === name) out.push(parent.children[i]);
  }
  return out;
}

function minifyXml(xml) {
  return xml.replace(/>\s+</g, "><").replace(/\r?\n/g, "").trim();
}

function wrapMoleculeXml(atomsEl, xEl, yEl, zEl) {
  const ser = new XMLSerializer();
  const atoms = ser.serializeToString(atomsEl);
  const x = ser.serializeToString(xEl);
  const y = ser.serializeToString(yEl);
  const z = ser.serializeToString(zEl);
  return minifyXml(`<PC-Compounds>${atoms}${x}${y}${z}</PC-Compounds>`);
}

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

function extractMdInitialVelocityXml(root, atomCount) {
  const velocityUnitsEl = findFirstByLocalName(root, "VelocityUnits");
  const velocityXEl = findFirstByLocalName(root, "VelocityX");
  const velocityYEl = findFirstByLocalName(root, "VelocityY");
  const velocityZEl = findFirstByLocalName(root, "VelocityZ");
  const hasAnyVelocity = Boolean(velocityXEl || velocityYEl || velocityZEl);

  if (!hasAnyVelocity) return "";
  if (!velocityXEl || !velocityYEl || !velocityZEl) {
    throw new Error("InsightMD initial velocities must include VelocityX, VelocityY, and VelocityZ.");
  }

  const velocityComponents = [
    { tag: "VelocityX", element: velocityXEl, entry: "VelocityX_E" },
    { tag: "VelocityY", element: velocityYEl, entry: "VelocityY_E" },
    { tag: "VelocityZ", element: velocityZEl, entry: "VelocityZ_E" },
  ];

  for (const component of velocityComponents) {
    const count = childrenByLocalName(component.element, component.entry).length;
    if (count !== atomCount) {
      throw new Error(
        `${component.tag} must contain ${atomCount} <${component.entry}> values.`
      );
    }
  }

  const ser = new XMLSerializer();
  return [
    velocityUnitsEl ? ser.serializeToString(velocityUnitsEl) : "",
    ser.serializeToString(velocityXEl),
    ser.serializeToString(velocityYEl),
    ser.serializeToString(velocityZEl),
  ]
    .filter(Boolean)
    .join("");
}

function buildMolecularDynamicsXml(moleculeXml, mdConfig) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(moleculeXml, "application/xml");
  const pe = doc.getElementsByTagName("parsererror");
  if (pe && pe.length) throw new Error("Unable to build MD XML: molecule XML parse error.");

  const atomsEl = findFirstByLocalName(doc, "PC-Atoms_element");
  const xEl = findFirstByLocalName(doc, "PC-Conformer_x");
  const yEl = findFirstByLocalName(doc, "PC-Conformer_y");
  const zEl = findFirstByLocalName(doc, "PC-Conformer_z");

  if (!atomsEl || !xEl || !yEl || !zEl) {
    throw new Error("Unable to build MD XML: missing atom or coordinate tags.");
  }

  const ser = new XMLSerializer();
  const atoms = ser.serializeToString(atomsEl);
  const x = ser.serializeToString(xEl);
  const y = ser.serializeToString(yEl);
  const z = ser.serializeToString(zEl);
  const stepCount = Math.max(1, Math.trunc(Number(mdConfig?.step_count) || 5));
  const timeStepFs = Number(mdConfig?.time_step_fs) || 0.25;
  const trajectoryFile = mdConfig?.trajectory_file || "md_trajectory.json";
  const initialVelocityXml = String(mdConfig?.initial_velocity_xml || "").trim();

  return minifyXml(`<?xml version="1.0"?>
<PC-Compounds xmlns="http://www.ncbi.nlm.nih.gov">
  <PC-Compound>
    <PC-Compound_atoms>
      <PC-Atoms>
        ${atoms}
      </PC-Atoms>
    </PC-Compound_atoms>
    <PC-Compound_coords>
      <PC-Coordinates>
        <PC-Coordinates_conformers>
          <PC-Conformer>
            ${x}
            ${y}
            ${z}
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

// Client-side preflight validation + extraction.
// Server still validates; this is for UX and smaller payload.
function extractMoleculeXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  const pe = doc.getElementsByTagName("parsererror");
  if (pe && pe.length) throw new Error("XML parse error.");

  const found = {};
  for (const req of REQUIRED) {
    const parentEl = findFirstByLocalName(doc, req.parent);
    if (!parentEl) throw new Error(`Missing tag: ${req.parent}`);

    const kids = childrenByLocalName(parentEl, req.child);
    if (kids.length === 0) throw new Error(`Tag ${req.parent} has 0 children <${req.child}>`);

    found[req.parent] = { el: parentEl, count: kids.length };
  }

  const counts = REQUIRED.map((r) => found[r.parent].count);
  const n = counts[0];
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] !== n) {
      throw new Error(
        `Mismatched child counts: ` +
          REQUIRED.map((r) => `${r.parent}=${found[r.parent].count}`).join(", ")
      );
    }
  }

  const mdInitialVelocityXml = extractMdInitialVelocityXml(doc, n);

  return {
    nAtoms: n,
    mdInitialVelocityXml,
    moleculeXml: wrapMoleculeXml(
      found["PC-Atoms_element"].el,
      found["PC-Conformer_x"].el,
      found["PC-Conformer_y"].el,
      found["PC-Conformer_z"].el
    ),
  };
}

function isXmlFile(file) {
  const name = (file?.name || "").toLowerCase();
  return name.endsWith(".xml") || file.type === "text/xml" || file.type === "application/xml";
}

function isJsonFile(file) {
  const name = (file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".json") || type === "application/json" || type === "text/json";
}

function stripKnownExtension(name) {
  return String(name || "")
    .trim()
    .replace(/\.(json|xml)$/i, "");
}

function toFlatNumberArray(values) {
  if (ArrayBuffer.isView(values)) return Array.from(values, (value) => Number(value) || 0);
  if (Array.isArray(values)) return values.map((value) => Number(value) || 0);
  return [];
}

function findNestedObjectByKey(root, targetKey) {
  if (!root || typeof root !== "object") return null;

  const seen = new Set();
  const stack = [root];
  let visitedCount = 0;

  while (stack.length && visitedCount < 1000) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;

    seen.add(current);
    visitedCount += 1;

    const directValue = current?.[targetKey];
    if (directValue && typeof directValue === "object") return directValue;

    if (Array.isArray(current)) {
      for (let i = Math.min(current.length - 1, 20); i >= 0; i -= 1) {
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

function getDroppedMdObject(root) {
  if (!root || typeof root !== "object") return null;

  const directCandidates = [
    root.MolecularDynamics,
    root.result?.MolecularDynamics,
    root.output?.MolecularDynamics,
    root.partialResult?.MolecularDynamics,
    root.data?.MolecularDynamics,
    root.response?.MolecularDynamics,
  ];

  for (const candidate of directCandidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (Array.isArray(root.frames)) return root;

  const nested = findNestedObjectByKey(root, "MolecularDynamics");
  if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;

  return null;
}

function getDroppedMdAtomicNumbers(md) {
  const values = md?.atomicNumbers || md?.atomic_numbers || md?.elements || md?.z;
  if (Array.isArray(values) || ArrayBuffer.isView(values)) {
    return toFlatNumberArray(values)
      .map((value) => Math.max(1, Math.trunc(value)))
      .filter((value) => value > 0);
  }

  if (Array.isArray(md?.atoms)) {
    return md.atoms
      .map((atom) => atom?.atomicNumber ?? atom?.atomic_number ?? atom?.Z ?? atom?.element ?? atom?.number)
      .map((value) => Math.max(1, Math.trunc(Number(value) || 0)))
      .filter((value) => value > 0);
  }

  return [];
}

function getDroppedMdFrameAtomCount(frame) {
  if (!frame) return 0;
  if (Array.isArray(frame?.atoms)) return frame.atoms.length;

  const positions = toFlatNumberArray(frame?.positions || frame?.coordinates || frame?.xyz || frame);
  if (positions.length >= 3 && positions.length % 3 === 0) return positions.length / 3;

  const xs = toFlatNumberArray(frame?.x);
  const ys = toFlatNumberArray(frame?.y);
  const zs = toFlatNumberArray(frame?.z);
  if (xs.length && xs.length === ys.length && ys.length === zs.length) return xs.length;

  return 0;
}

function buildDroppedMdScenePayload(root, fileName) {
  const md = getDroppedMdObject(root);
  if (!md || typeof md !== "object") {
    throw new Error("JSON does not contain a MolecularDynamics payload.");
  }

  const frames = Array.isArray(md.frames) ? md.frames : [];
  if (!frames.length) {
    throw new Error("MolecularDynamics payload does not contain any frames.");
  }

  const label = stripKnownExtension(fileName) || md.label || root?.label || "MD Trajectory";
  const normalizedMd = {
    ...md,
    label,
  };

  const atomicNumbers = getDroppedMdAtomicNumbers(normalizedMd);
  if (!atomicNumbers.length) {
    const atomCount =
      Math.max(0, Math.trunc(Number(normalizedMd.atomCount ?? normalizedMd.atom_count) || 0)) ||
      getDroppedMdFrameAtomCount(frames[0]);
    if (!atomCount) {
      throw new Error("MolecularDynamics payload is missing atomic numbers.");
    }
    normalizedMd.atomicNumbers = Array.from({ length: atomCount }, () => 6);
    normalizedMd.atomElementsAssumed = true;
  }

  return {
    label,
    MolecularDynamics: normalizedMd,
  };
}

async function handleMdFramesFile(file) {
  setStatus(`Reading ${file.name}...`);

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (_) {
    setStatus("Invalid JSON.");
    return;
  }

  let scenePayload;
  try {
    scenePayload = buildDroppedMdScenePayload(data, file.name);
  } catch (err) {
    setStatus(`Invalid MD frames JSON: ${err?.message || String(err)}`);
    return;
  }

  if (typeof window.loadMoleculeScene !== "function") {
    setStatus("Renderer not initialized yet.");
    return;
  }

  const loaded = window.loadMoleculeScene(scenePayload, {
    autoEnterMode: true,
    label: scenePayload.label,
    sourceKey: `local_md_frames:${file.name}:${file.size}:${file.lastModified || 0}`,
    visualizationMode: "ballstick",
  });

  if (!loaded) {
    setStatus("Unable to open MD visualization.");
    return;
  }

  window.lastDroppedMdFramesPayload = scenePayload;
  const frameCount = scenePayload.MolecularDynamics.frames.length;
  const atomCount =
    getDroppedMdAtomicNumbers(scenePayload.MolecularDynamics).length ||
    getDroppedMdFrameAtomCount(scenePayload.MolecularDynamics.frames[0]);
  setStatus(`Loaded ${file.name} (${frameCount} frames, ${atomCount} atoms).`);
}

// -----------------------------
// Firebase callable
// -----------------------------
const functions = getInsightFunctions(FUNCTIONS_REGION);

if (auth.currentUser) console.log("uid:", auth.currentUser.uid);
const submitCallable = httpsCallable(functions, FUNCTION_NAME);

async function submitMolecule(moleculeXml, fileName, extra = {}) {
  const user = await waitForAuthReady();
  if (!user) throw new Error("Your session expired. Please sign in again.");

  const payload = {
    molecule_xml: moleculeXml,
    fileName: fileName,
    ...extra, // e.g. nickname, max_runtime_sec, mode
  };

  try {
    await user.getIdToken(true);
  } catch (_) {
    throw new Error("Your session expired. Please sign in again.");
  }

  try {
    const res = await submitCallable(payload);
    return res?.data ?? res;
  } catch (err) {
    if (String(err?.code || "") === "functions/unauthenticated") {
      try {
        await user.getIdToken(true);
      } catch (_) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const retryRes = await submitCallable(payload);
      return retryRes?.data ?? retryRes;
    }

    throw err;
  }
}


// -----------------------------
// Main drop flow
// -----------------------------
async function handleFile(file) {
  if (!file) return;

  if (isJsonFile(file)) {
    await handleMdFramesFile(file);
    return;
  }

  if (!isXmlFile(file)) {
    setStatus("Drop an .xml file or MD frames .json file.");
    return;
  }

  setStatus(`Reading ${file.name}...`);
  const xmlText = await file.text();

  let extracted;
  try {
    setStatus("Validating XML...");
    extracted = extractMoleculeXml(xmlText);
  } catch (e) {
    setStatus(`Invalid XML: ${e?.message || String(e)}`);
    return;
  }

  setStatus(
    `Validated (${extracted.nAtoms} atoms${extracted.mdInitialVelocityXml ? ", with initial MD velocities" : ""}). Configure job...`
  );

  if (typeof window.openSubmitModal !== "function") {
    setStatus("UI error: submit modal not loaded.");
    return;
  }

  window.openSubmitModal({
    fileName: file.name,
    nAtoms: extracted.nAtoms,
    mdInitialVelocityXml: extracted.mdInitialVelocityXml,
    moleculeXml: extracted.moleculeXml,
    onSubmit: async ({ mode, nickname, hardware_tier, max_runtime_sec, moleculeXml, fileName, mdConfig }) => {
      setStatus("Submitting...");
      const submissionXml = mode === "molecular_dynamics"
        ? buildMolecularDynamicsXml(moleculeXml, mdConfig)
        : moleculeXml;
      const data = await submitMolecule(submissionXml, fileName, {
        mode,
        nickname,
        hardware_tier,
        max_runtime_sec,
        ...(mdConfig
          ? {
              md_step_count: mdConfig.step_count,
              md_time_step_fs: mdConfig.time_step_fs,
              md_total_time_fs: mdConfig.total_time_fs,
              md_trajectory_file: mdConfig.trajectory_file,
            }
          : {}),
      });
      console.log("submit_molecule response:", data);
      console.log("submit_molecule selected endpoint:", data?.runpod_endpoint);
      window.lastMoleculeSubmitResponse = data;
      setStatus("Submitted successfully.");
    },
  });
}


function _molHelpSetOpen(isOpen){
  const ov = document.getElementById("molHelpOverlay");
  if (!ov) return;
  ov.classList.toggle("molhelp-overlay--open", isOpen);
  ov.setAttribute("aria-hidden", isOpen ? "false" : "true");

  if (isOpen){
    // focus close for keyboard users
    const closeBtn = document.getElementById("molHelpCloseBtn");
    if (closeBtn) closeBtn.focus();
  }
}

function _molHelpInit(){
  const openBtn  = document.getElementById("molHelpBtn");
  const closeBtn = document.getElementById("molHelpCloseBtn");
  const okBtn    = document.getElementById("molHelpOkBtn");
  const overlay  = document.getElementById("molHelpOverlay");

  if (!openBtn || !overlay) return;

  openBtn.addEventListener("click", () => _molHelpSetOpen(true));
  if (closeBtn) closeBtn.addEventListener("click", () => _molHelpSetOpen(false));
  if (okBtn) okBtn.addEventListener("click", () => _molHelpSetOpen(false));

  // click outside modal closes
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) _molHelpSetOpen(false);
  });

  // escape closes
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("molhelp-overlay--open")){
      _molHelpSetOpen(false);
    }
  });
}

window.addEventListener("load", _molHelpInit);
