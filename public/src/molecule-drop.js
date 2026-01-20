// /src/molecule-drop.js
//
// Drag-and-drop XML -> extract PC sections -> call Firebase callable submit_molecule.
//
// Expects these elements in DOM:
//   #dropOverlay
//   #loadingText
//   #loadingProgressBar
//
// Uses existing Firebase app/auth from /src/firebase-init.js

import { app, auth } from "/src/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

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
    setStatus("Not signed in. Redirecting to /auth...");
    window.location.href = "/auth";
  } else {
    setStatus("Signed in. Drop an XML file.");
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

  return {
    nAtoms: n,
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

// -----------------------------
// Firebase callable
// -----------------------------
const functions = getFunctions(app, FUNCTIONS_REGION);

if (auth.currentUser) console.log("uid:", auth.currentUser.uid);
const submitCallable = httpsCallable(functions, FUNCTION_NAME);

async function submitMolecule(moleculeXml, fileName, extra = {}) {
  const user = await waitForAuthReady();
  if (!user) throw new Error("Unauthenticated (no user).");

  await user.getIdToken();

  const payload = {
    molecule_xml: moleculeXml,
    fileName: fileName,
    ...extra, // e.g. nickname, max_runtime_sec, mode
  };

  const res = await submitCallable(payload);
  return res?.data ?? res;
}


// -----------------------------
// Main drop flow
// -----------------------------
async function handleFile(file) {
  if (!file) return;

  if (!isXmlFile(file)) {
    setStatus("Drop an .xml file.");
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

  setStatus(`Validated (${extracted.nAtoms} atoms). Configure job...`);

  if (typeof window.openSubmitModal !== "function") {
    setStatus("UI error: submit modal not loaded.");
    return;
  }

  window.openSubmitModal({
    fileName: file.name,
    nAtoms: extracted.nAtoms,
    moleculeXml: extracted.moleculeXml,
    onSubmit: async ({ mode, nickname, max_runtime_sec, moleculeXml, fileName }) => {
      setStatus("Submitting...");
      const data = await submitMolecule(moleculeXml, fileName, {
        mode,
        nickname,
        max_runtime_sec,
      });
      console.log("submit_molecule response:", data);
      window.lastMoleculeSubmitResponse = data;
      setStatus("Submitted successfully.");
    },
  });
}
