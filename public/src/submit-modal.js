const overlay = document.getElementById("submitOverlay");
const closeBtn = document.getElementById("submitCloseBtn");
const submitJobBtn = document.getElementById("submitJobBtn");
const errEl = document.getElementById("submitError");

const legacyFileNameEl = document.getElementById("submitFileName");
const legacyAtomCountEl = document.getElementById("submitAtomCount");
const fileNameEls = Array.from(document.querySelectorAll('[data-submit-bind="fileName"]'));
const atomCountEls = Array.from(document.querySelectorAll('[data-submit-bind="atomCount"]'));

const submitModeTabs = Array.from(document.querySelectorAll("[data-submit-mode]"));
const submitPanels = Array.from(document.querySelectorAll("[data-submit-panel]"));

const JOB_MODES = {
  point_solve: {
    tabId: "submitPointSolveTab",
    panelId: "submitPointSolvePanel",
    label: "Point Solve",
    submitLabel: "Submit Point Solve",
    submittingLabel: "Submitting Point Solve...",
  },
  geometry_optimization: {
    tabId: "submitGeometryOptimizationTab",
    panelId: "submitGeometryOptimizationPanel",
    label: "Geometry Optimization",
    submitLabel: "Submit Geometry Optimization",
    submittingLabel: "Submitting Geometry Optimization...",
  },
};

const HARDWARE_TIERS = {
  budget: {
    label: "Budget",
    gpu: "RTX 5090 / RTX 4090",
    price: "$0.002-$0.007 / s",
    minRate: 0.002,
    maxRate: 0.007,
  },
  performance: {
    label: "Performance",
    gpu: "H200 / H100",
    price: "$0.01-$0.015 / s",
    minRate: 0.010,
    maxRate: 0.015,
  },
};

let _state = {
  fileName: "",
  nAtoms: 0,
  moleculeXml: "",
  onSubmit: null,
  selectedMode: "point_solve",
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
  const base = (fileName || "").split("/").pop();
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(0, idx) : base;
}

function getModeMeta(mode) {
  return JOB_MODES[mode] || JOB_MODES.point_solve;
}

function getPanel(mode) {
  return submitPanels.find((panel) => panel.dataset.submitPanel === mode) || null;
}

function getActivePanel() {
  return getPanel(_state.selectedMode);
}

function getActiveInput(name) {
  const activePanel = getActivePanel();
  if (!activePanel) return null;

  if (name === "hardwareTier") {
    return (
      activePanel.querySelector(`[data-submit-input="${name}"]:checked`) ||
      activePanel.querySelector(`[data-submit-input="${name}"]`) ||
      null
    );
  }

  return activePanel.querySelector(`[data-submit-input="${name}"]`) || null;
}

function getHardwareMeta(tier) {
  return HARDWARE_TIERS[tier] || HARDWARE_TIERS.budget;
}

function formatUsd(value) {
  return `$${value.toFixed(2)}`;
}

function getValidatedMaxRuntimeMinutes(input) {
  if (!input) return 30;

  const minRuntime = Number(input.min || 1);
  const maxRuntime = Number(input.max || 60);
  const fallbackRuntime = Number(input.dataset.defaultValue || 30);
  return clampInt(input.value, minRuntime, maxRuntime, fallbackRuntime);
}

function scrollActivePanelToTop() {
  const panel = getActivePanel();
  if (panel) panel.scrollTop = 0;
}

function setBoundText(name, value) {
  const selectors = [];
  if (name === "fileName" && legacyFileNameEl) selectors.push(legacyFileNameEl);
  if (name === "atomCount" && legacyAtomCountEl) selectors.push(legacyAtomCountEl);

  const boundEls = name === "fileName" ? fileNameEls : atomCountEls;
  boundEls.forEach((el) => selectors.push(el));

  selectors.forEach((el) => {
    if (el) el.textContent = value;
  });
}

function resetInputs() {
  const nickname = defaultNickname(_state.fileName);

  document.querySelectorAll('[data-submit-input="nickname"]').forEach((input) => {
    input.value = nickname;
  });

  document.querySelectorAll('[data-submit-input="maxRuntime"]').forEach((input) => {
    input.value = input.dataset.defaultValue || "30";
  });

  submitPanels.forEach((panel) => {
    const hardwareInputs = Array.from(panel.querySelectorAll('[data-submit-input="hardwareTier"]'));
    if (!hardwareInputs.length) return;

    const defaultInput =
      hardwareInputs.find((input) => Object.keys(HARDWARE_TIERS).includes(input.dataset.defaultValue)) ||
      hardwareInputs.find((input) => input.value === "budget") ||
      hardwareInputs[0];

    hardwareInputs.forEach((input) => {
      input.checked = input === defaultInput;
    });
  });

  renderRuntimeEstimates();
}

function renderHardwareCards() {
  submitPanels.forEach((panel) => {
    const hardwareInputs = Array.from(panel.querySelectorAll('[data-submit-input="hardwareTier"]'));

    if (!hardwareInputs.length) return;

    const selectedInput =
      hardwareInputs.find((input) => input.checked && Object.keys(HARDWARE_TIERS).includes(input.value)) ||
      hardwareInputs.find((input) => input.value === "budget") ||
      hardwareInputs[0];

    if (!selectedInput.checked) selectedInput.checked = true;

    panel.dataset.selectedHardwareTier = selectedInput.value;

    hardwareInputs.forEach((input) => {
      const option = input.closest("[data-submit-hardware-option]");
      if (!option) return;
      option.classList.toggle("is-selected", input === selectedInput);
    });
  });

  renderRuntimeEstimates();
}

function renderRuntimeEstimates() {
  submitPanels.forEach((panel) => {
    const selectedHardware =
      panel.querySelector('[data-submit-input="hardwareTier"]:checked') ||
      panel.querySelector('[data-submit-input="hardwareTier"]');
    const maxRuntimeInput = panel.querySelector('[data-submit-input="maxRuntime"]');
    const maxCostEl = panel.querySelector('[data-submit-bind="maxCost"]');

    if (!selectedHardware || !maxRuntimeInput || !maxCostEl) return;

    const hardwareMeta = getHardwareMeta(selectedHardware.value);
    const runtimeMinutes = getValidatedMaxRuntimeMinutes(maxRuntimeInput);
    const runtimeSeconds = runtimeMinutes * 60;
    const maxCost = runtimeSeconds * hardwareMeta.maxRate;

    maxCostEl.textContent = formatUsd(maxCost);
  });
}

function renderSelectedMode() {
  if (!Object.prototype.hasOwnProperty.call(JOB_MODES, _state.selectedMode)) {
    _state.selectedMode = "point_solve";
  }

  const meta = getModeMeta(_state.selectedMode);

  submitModeTabs.forEach((tab) => {
    const isActive = tab.dataset.submitMode === _state.selectedMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  submitPanels.forEach((panel) => {
    const isActive = panel.dataset.submitPanel === _state.selectedMode;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
    panel.setAttribute("aria-hidden", String(!isActive));
  });

  if (submitJobBtn) submitJobBtn.textContent = meta.submitLabel;
}

function setSelectedMode(mode) {
  if (!Object.prototype.hasOwnProperty.call(JOB_MODES, mode)) return;
  _state.selectedMode = mode;
  showError("");
  renderSelectedMode();
  scrollActivePanelToTop();
}

function focusActiveNickname() {
  setTimeout(() => {
    getActiveInput("nickname")?.focus();
  }, 0);
}

function bindTabKeyboardNavigation() {
  submitModeTabs.forEach((tab, index) => {
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;

      e.preventDefault();
      const nextIndex =
        e.key === "ArrowRight"
          ? (index + 1) % submitModeTabs.length
          : (index - 1 + submitModeTabs.length) % submitModeTabs.length;

      const nextTab = submitModeTabs[nextIndex];
      if (!nextTab) return;

      setSelectedMode(nextTab.dataset.submitMode);
      nextTab.focus();
    });
  });
}

async function handleSubmit() {
  const modeMeta = getModeMeta(_state.selectedMode);
  const nicknameEl = getActiveInput("nickname");
  const maxRuntimeEl = getActiveInput("maxRuntime");

  try {
    showError("");

    const nickname = (nicknameEl?.value || "").trim();
    if (!nickname) {
      showError("Nickname is required.");
      nicknameEl?.focus();
      return;
    }

    const hardwareTierEl = getActiveInput("hardwareTier");
    const hardwareTier = Object.keys(HARDWARE_TIERS).includes(hardwareTierEl?.value)
      ? hardwareTierEl.value
      : "budget";

    const maxMinutes = getValidatedMaxRuntimeMinutes(maxRuntimeEl);
    const maxRuntimeSec = maxMinutes * 60;

    if (maxRuntimeEl) maxRuntimeEl.value = String(maxMinutes);

    if (submitJobBtn) {
      submitJobBtn.disabled = true;
      submitJobBtn.textContent = modeMeta.submittingLabel;
    }

    if (typeof _state.onSubmit !== "function") {
      throw new Error("Missing submit handler.");
    }

    await _state.onSubmit({
      mode: _state.selectedMode,
      fileName: _state.fileName,
      nickname,
      hardware_tier: hardwareTier,
      max_runtime_sec: maxRuntimeSec,
      nAtoms: _state.nAtoms,
      moleculeXml: _state.moleculeXml,
    });

    close();
  } catch (e) {
    showError(e?.message || String(e));
  } finally {
    if (submitJobBtn) submitJobBtn.disabled = false;
    renderSelectedMode();
  }
}

closeBtn?.addEventListener("click", close);
overlay?.addEventListener("click", (e) => {
  if (e.target === overlay) close();
});

window.addEventListener("keydown", (e) => {
  if (overlay?.classList.contains("active") && e.key === "Escape") close();
});

submitModeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setSelectedMode(tab.dataset.submitMode);
    focusActiveNickname();
  });
});

document.querySelectorAll('[data-submit-input="hardwareTier"]').forEach((input) => {
  input.addEventListener("change", renderHardwareCards);
});

document.querySelectorAll('[data-submit-input="maxRuntime"]').forEach((input) => {
  input.addEventListener("input", renderRuntimeEstimates);
  input.addEventListener("change", renderRuntimeEstimates);
});

bindTabKeyboardNavigation();
submitJobBtn?.addEventListener("click", handleSubmit);

window.openSubmitModal = function openSubmitModal({ fileName, nAtoms, moleculeXml, onSubmit }) {
  _state = {
    fileName,
    nAtoms,
    moleculeXml,
    onSubmit,
    selectedMode: "point_solve",
  };

  setBoundText("fileName", fileName || "-");
  setBoundText("atomCount", Number.isFinite(nAtoms) ? String(nAtoms) : "-");

  resetInputs();
  renderHardwareCards();
  renderRuntimeEstimates();
  showError("");
  renderSelectedMode();
  scrollActivePanelToTop();
  open();
  focusActiveNickname();
};
