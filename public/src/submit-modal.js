const overlay = document.getElementById("submitOverlay");
const closeBtn = document.getElementById("submitCloseBtn");

const fileNameEl = document.getElementById("submitFileName");
const atomCountEl = document.getElementById("submitAtomCount");
const nicknameEl = document.getElementById("submitNickname");
const maxRuntimeEl = document.getElementById("submitMaxRuntime");
const errEl = document.getElementById("submitError");

const pointSolveBtn = document.getElementById("submitPointSolveBtn");

let _state = {
  fileName: "",
  nAtoms: 0,
  moleculeXml: "",
  onSubmit: null,
};

function showError(msg) {
  if (!errEl) return;
  if (!msg) {
    errEl.textContent = "";
    errEl.classList.remove("active");
    return;
  }
  errEl.textContent = msg;
  errEl.classList.add("active");
}

const dropOverlay = document.getElementById("dropOverlay");
function open() {
  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");

  if (dropOverlay) dropOverlay.classList.remove("active");
}

function close() {
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");

  showError("");
}


function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  return Math.max(lo, Math.min(hi, i));
}

function defaultNickname(fileName) {
  // strip extension
  const base = (fileName || "").split("/").pop();
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(0, idx) : base;
}

async function handlePointSolve() {
  try {
    showError("");

    const nickname = (nicknameEl?.value || "").trim();
    if (!nickname) {
      showError("Nickname is required.");
      return;
    }

    const maxMinutes = clampInt(maxRuntimeEl?.value, 1, 60, 5);
    const maxRuntimeSec = maxMinutes * 60;

    pointSolveBtn.disabled = true;
    pointSolveBtn.textContent = "Submitting...";

    if (typeof _state.onSubmit !== "function") {
      throw new Error("Missing submit handler.");
    }

    await _state.onSubmit({
      mode: "point_solve",
      fileName: _state.fileName,
      nickname,
      max_runtime_sec: maxRuntimeSec,
      nAtoms: _state.nAtoms,
      moleculeXml: _state.moleculeXml,
    });

    close();
  } catch (e) {
    showError(e?.message || String(e));
  } finally {
    pointSolveBtn.disabled = false;
    pointSolveBtn.textContent = "Point Solve";
  }
}

// Close handlers
closeBtn?.addEventListener("click", close);
overlay?.addEventListener("click", (e) => {
  // click outside modal closes
  if (e.target === overlay) close();
});
window.addEventListener("keydown", (e) => {
  if (overlay?.classList.contains("active") && e.key === "Escape") close();
});

pointSolveBtn?.addEventListener("click", handlePointSolve);

// Public API
window.openSubmitModal = function openSubmitModal({ fileName, nAtoms, moleculeXml, onSubmit }) {
  _state = { fileName, nAtoms, moleculeXml, onSubmit };

  if (fileNameEl) fileNameEl.textContent = fileName || "—";
  if (atomCountEl) atomCountEl.textContent = Number.isFinite(nAtoms) ? String(nAtoms) : "—";

  if (nicknameEl) nicknameEl.value = defaultNickname(fileName);
  if (maxRuntimeEl) maxRuntimeEl.value = "30";

  showError("");
  open();

  // focus nickname for fast submit
  setTimeout(() => nicknameEl?.focus(), 0);
};
