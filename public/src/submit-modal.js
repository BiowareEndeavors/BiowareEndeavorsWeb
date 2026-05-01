import { getInsightFunctions } from "/src/firebase-init.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

const overlay = document.getElementById("submitOverlay");
const closeBtn = document.getElementById("submitCloseBtn");
const submitJobBtn = document.getElementById("submitJobBtn");
const errEl = document.getElementById("submitError");
const modalTitleEl = document.getElementById("submitModalTitle");
const modalContextEl = document.getElementById("submitModalContext");
const submitTabsScrollerEl = document.getElementById("submitTabsScroller");
const mdModeTitleEl = document.getElementById("submitMolecularDynamicsModeTitle");
const mdModeDescriptionEl = document.getElementById("submitMolecularDynamicsModeDescription");
const mdInputHintEl = document.getElementById("submitMolecularDynamicsInputHint");

const legacyFileNameEl = document.getElementById("submitFileName");
const legacyAtomCountEl = document.getElementById("submitAtomCount");
const fileNameEls = Array.from(document.querySelectorAll('[data-submit-bind="fileName"]'));
const atomCountEls = Array.from(document.querySelectorAll('[data-submit-bind="atomCount"]'));

const submitModeTabs = Array.from(document.querySelectorAll("[data-submit-mode]"));
const submitPanels = Array.from(document.querySelectorAll("[data-submit-panel]"));

const FUNCTIONS_REGION = "us-central1";
const RUNPOD_HEALTH_FUNCTION_NAME = "get_runpod_health";
const functions = getInsightFunctions(FUNCTIONS_REGION);
const getRunpodHealthCallable = httpsCallable(functions, RUNPOD_HEALTH_FUNCTION_NAME);
let hardwareHealthRequestSeq = 0;
let availabilityNoticeEl = document.getElementById("submitAvailabilityNotice");

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
  molecular_dynamics: {
    tabId: "submitMolecularDynamicsTab",
    panelId: "submitMolecularDynamicsPanel",
    label: "Molecular Dynamics",
    submitLabel: "Submit Molecular Dynamics",
    submittingLabel: "Submitting Molecular Dynamics...",
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

const DEFAULT_MODAL_TITLE = modalTitleEl?.textContent?.trim() || "Submit Job";
const DEFAULT_MD_MODE_TITLE = mdModeTitleEl?.textContent?.trim() || "Molecular Dynamics";
const DEFAULT_MD_MODE_DESCRIPTION =
  mdModeDescriptionEl?.textContent?.trim() ||
  "Run a short molecular dynamics trajectory and return frame-by-frame nuclear coordinates for playback.";
const DEFAULT_MD_INPUT_HINT =
  mdInputHintEl?.textContent?.trim() ||
  "MD submissions add an InsightMD block to the XML sent to the endpoint.";

let _state = {
  fileName: "",
  displayFileName: "",
  nAtoms: 0,
  mdInitialVelocityXml: "",
  moleculeXml: "",
  onSubmit: null,
  selectedMode: "point_solve",
  lockedMode: "",
  hideTabs: false,
  modalTitle: DEFAULT_MODAL_TITLE,
  modalContextMessage: "",
  submitLabelOverride: "",
  submittingLabelOverride: "",
  mdModeTitle: DEFAULT_MD_MODE_TITLE,
  mdModeDescription: DEFAULT_MD_MODE_DESCRIPTION,
  mdInputHint: DEFAULT_MD_INPUT_HINT,
  initialNickname: "",
  initialHardwareTier: "",
  initialMaxRuntimeMinutes: null,
  initialMdStepCount: null,
  initialMdTimeStepFs: null,
  initialFocusInput: "",
  disabledInputs: [],
  isSubmitting: false,
  healthLoading: false,
  healthError: "",
  hardwareHealth: {},
  activeHealthRequestId: 0,
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

function getAvailabilityNoticeEl() {
  if (availabilityNoticeEl) return availabilityNoticeEl;
  if (!errEl?.parentNode) return null;

  availabilityNoticeEl = document.createElement("div");
  availabilityNoticeEl.id = "submitAvailabilityNotice";
  availabilityNoticeEl.className = "submit-availability-notice";
  availabilityNoticeEl.setAttribute("role", "status");
  errEl.parentNode.insertBefore(availabilityNoticeEl, errEl);
  return availabilityNoticeEl;
}

function showAvailabilityNotice(msg, tone = "warning") {
  const noticeEl = getAvailabilityNoticeEl();
  if (!noticeEl) return;

  const message = String(msg || "").trim();
  noticeEl.textContent = message;
  noticeEl.dataset.tone = tone;
  noticeEl.classList.toggle("active", Boolean(message));
}

function toOptionalFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNonnegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function normalizeHardwareHealthSummary(summary) {
  if (!summary || typeof summary !== "object") return null;

  const workers = summary.workers && typeof summary.workers === "object" ? summary.workers : {};
  const jobs = summary.jobs && typeof summary.jobs === "object" ? summary.jobs : {};
  const ready = toNonnegativeInt(workers.ready);
  const running = toNonnegativeInt(workers.running);
  const inQueue = toNonnegativeInt(jobs.inQueue);
  const hasKnownAvailability =
    summary.ok === true && typeof summary.hasAvailableWorkers === "boolean";

  return {
    ok: summary.ok === true,
    error: String(summary.error || ""),
    ready,
    running,
    inQueue,
    availableWorkerCount: ready + running,
    hasAvailableWorkers: hasKnownAvailability ? summary.hasAvailableWorkers : null,
    queueWaitLikely: ready === 0 && running > 0,
  };
}

function getHardwareHealth(tier) {
  return _state.hardwareHealth?.[tier] || null;
}

function isHardwareTierUnavailable(tier) {
  const health = getHardwareHealth(tier);
  return health?.ok === true && health.availableWorkerCount === 0;
}

function areAllHardwareTiersUnavailable() {
  return Object.keys(HARDWARE_TIERS).every((tier) => isHardwareTierUnavailable(tier));
}

function getAllWorkersUnavailableMessage() {
  return "No Budget or Performance workers are available right now. Please try again later.";
}

function formatCount(value, singular, plural = `${singular}s`) {
  const count = toNonnegativeInt(value);
  return `${count} ${count === 1 ? singular : plural}`;
}

function getHardwareHealthText(tier) {
  const health = getHardwareHealth(tier);

  if (_state.healthLoading && !health) {
    return "Checking worker availability...";
  }

  if (!health) {
    return "Worker availability refreshes when this modal opens.";
  }

  if (!health.ok) {
    return "Worker availability unavailable. You can still submit.";
  }

  const workerText = `${formatCount(health.ready, "ready worker")}, ${formatCount(
    health.running,
    "running worker"
  )}`;

  if (health.availableWorkerCount === 0) {
    return `${workerText}. No workers available right now.`;
  }

  if (health.ready === 0 && health.running > 0) {
    return `${workerText}. Queue wait possible: ${formatCount(health.inQueue, "job")} ahead.`;
  }

  return workerText;
}

function renderSubmitAvailabilityNotice() {
  if (areAllHardwareTiersUnavailable()) {
    showAvailabilityNotice(getAllWorkersUnavailableMessage(), "danger");
    return;
  }

  if (_state.healthError) {
    showAvailabilityNotice(
      "Worker availability could not be refreshed. You can still submit, but capacity may have changed.",
      "warning"
    );
    return;
  }

  showAvailabilityNotice("");
}

function getPreferredMode() {
  if (Object.prototype.hasOwnProperty.call(JOB_MODES, _state.lockedMode)) {
    return _state.lockedMode;
  }
  return _state.selectedMode;
}

function applyModalChrome() {
  if (modalTitleEl) {
    modalTitleEl.textContent = _state.modalTitle || DEFAULT_MODAL_TITLE;
  }

  if (modalContextEl) {
    const message = String(_state.modalContextMessage || "").trim();
    modalContextEl.textContent = message;
    modalContextEl.hidden = !message;
  }

  if (submitTabsScrollerEl) {
    submitTabsScrollerEl.hidden = !!_state.hideTabs;
  }

  if (mdModeTitleEl) {
    mdModeTitleEl.textContent = _state.mdModeTitle || DEFAULT_MD_MODE_TITLE;
  }

  if (mdModeDescriptionEl) {
    mdModeDescriptionEl.textContent = _state.mdModeDescription || DEFAULT_MD_MODE_DESCRIPTION;
  }

  if (mdInputHintEl) {
    mdInputHintEl.textContent = _state.mdInputHint || DEFAULT_MD_INPUT_HINT;
  }
}

function isSubmitInputDisabled(name) {
  return _state.disabledInputs.includes(name);
}

function applyInputDisabledStates() {
  document.querySelectorAll("[data-submit-input]").forEach((input) => {
    const inputName = input.dataset.submitInput || "";
    const disabled =
      isSubmitInputDisabled(inputName) ||
      (inputName === "hardwareTier" && isHardwareTierUnavailable(input.value));
    input.disabled = disabled;
    input.setAttribute("aria-disabled", String(disabled));
  });
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

function clampFloat(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
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

function getValidatedMdStepCount(input) {
  if (!input) return 5;

  const minStepCount = Number(input.min || 1);
  const maxStepCount = Number(input.max || 100000);
  const fallbackStepCount = Number(input.dataset.defaultValue || 5);
  return clampInt(input.value, minStepCount, maxStepCount, fallbackStepCount);
}

function getValidatedMdTimeStepFs(input) {
  if (!input) return 0.25;

  const minTimeStep = Number(input.min || 0.001);
  const maxTimeStep = Number(input.max || 10);
  const fallbackTimeStep = Number(input.dataset.defaultValue || 0.25);
  return clampFloat(input.value, minTimeStep, maxTimeStep, fallbackTimeStep);
}

function formatFs(value) {
  const rounded = Number(value);
  if (!Number.isFinite(rounded)) return "0 fs";
  if (Math.abs(rounded) >= 1000) return `${rounded.toFixed(2)} fs`;
  if (Math.abs(rounded) >= 10) return `${rounded.toFixed(2)} fs`;
  return `${rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} fs`;
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
  const nickname = String(_state.initialNickname || "").trim() || defaultNickname(_state.fileName);
  const initialMaxRuntimeMinutes = toOptionalFiniteNumber(_state.initialMaxRuntimeMinutes);
  const initialMdStepCount = toOptionalFiniteNumber(_state.initialMdStepCount);
  const initialMdTimeStepFs = toOptionalFiniteNumber(_state.initialMdTimeStepFs);
  const preferredHardwareTier = Object.prototype.hasOwnProperty.call(HARDWARE_TIERS, _state.initialHardwareTier)
    ? _state.initialHardwareTier
    : "";

  document.querySelectorAll('[data-submit-input="nickname"]').forEach((input) => {
    input.value = nickname;
  });

  document.querySelectorAll('[data-submit-input="maxRuntime"]').forEach((input) => {
    input.value = String(initialMaxRuntimeMinutes ?? (input.dataset.defaultValue || "30"));
  });

  document.querySelectorAll('[data-submit-input="mdStepCount"]').forEach((input) => {
    input.value = String(initialMdStepCount ?? (input.dataset.defaultValue || "5"));
  });

  document.querySelectorAll('[data-submit-input="mdTimeStepFs"]').forEach((input) => {
    input.value = String(initialMdTimeStepFs ?? (input.dataset.defaultValue || "0.25"));
  });

  submitPanels.forEach((panel) => {
    const hardwareInputs = Array.from(panel.querySelectorAll('[data-submit-input="hardwareTier"]'));
    if (!hardwareInputs.length) return;

    const defaultInput =
      (preferredHardwareTier
        ? hardwareInputs.find((input) => input.value === preferredHardwareTier)
        : null) ||
      hardwareInputs.find((input) => Object.keys(HARDWARE_TIERS).includes(input.dataset.defaultValue)) ||
      hardwareInputs.find((input) => input.value === "budget") ||
      hardwareInputs[0];

    hardwareInputs.forEach((input) => {
      input.checked = input === defaultInput;
    });
  });

  renderRuntimeEstimates();
  renderMdEstimates();
}

function isHardwareInputSelectable(input) {
  return (
    input &&
    Object.prototype.hasOwnProperty.call(HARDWARE_TIERS, input.value) &&
    !isSubmitInputDisabled("hardwareTier") &&
    !isHardwareTierUnavailable(input.value)
  );
}

function ensureHardwareHealthEl(option) {
  let healthEl = option.querySelector("[data-submit-bind='hardwareHealth']");
  if (healthEl) return healthEl;

  const content = option.querySelector(".submit-hardware-option__content");
  if (!content) return null;

  healthEl = document.createElement("span");
  healthEl.className = "submit-hardware-option__health";
  healthEl.dataset.submitBind = "hardwareHealth";
  content.appendChild(healthEl);
  return healthEl;
}

function renderHardwareAvailability() {
  document.querySelectorAll("[data-submit-hardware-option]").forEach((option) => {
    const tier = option.dataset.hardwareTier || "";
    const health = getHardwareHealth(tier);
    const unavailable = isHardwareTierUnavailable(tier);
    const queueLikely = health?.ok === true && health.ready === 0 && health.running > 0;
    const unknown = Boolean(health && !health.ok) || Boolean(_state.healthError && !health);
    const loading = _state.healthLoading && !health;
    const input = option.querySelector('[data-submit-input="hardwareTier"]');
    const healthEl = ensureHardwareHealthEl(option);

    option.classList.toggle("is-unavailable", unavailable);
    option.classList.toggle("is-queue-likely", queueLikely);
    option.classList.toggle("is-availability-unknown", unknown);
    option.classList.toggle("is-availability-loading", loading);
    option.setAttribute("aria-disabled", String(Boolean(input?.disabled)));

    if (healthEl) {
      healthEl.textContent = getHardwareHealthText(tier);
    }
  });
}

function renderHardwareCards() {
  applyInputDisabledStates();

  submitPanels.forEach((panel) => {
    const hardwareInputs = Array.from(panel.querySelectorAll('[data-submit-input="hardwareTier"]'));

    if (!hardwareInputs.length) return;

    const selectedInput =
      hardwareInputs.find((input) => input.checked && isHardwareInputSelectable(input)) ||
      hardwareInputs.find((input) => input.value === "budget" && isHardwareInputSelectable(input)) ||
      hardwareInputs.find((input) => isHardwareInputSelectable(input)) ||
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

  renderHardwareAvailability();
  renderRuntimeEstimates();
  renderSubmitAvailabilityNotice();
  renderSubmitButton();
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

function renderMdEstimates() {
  submitPanels.forEach((panel) => {
    const stepCountInput = panel.querySelector('[data-submit-input="mdStepCount"]');
    const timeStepInput = panel.querySelector('[data-submit-input="mdTimeStepFs"]');
    const totalTimeEl = panel.querySelector('[data-submit-bind="mdTotalTimeFs"]');

    if (!stepCountInput || !timeStepInput || !totalTimeEl) return;

    const stepCount = getValidatedMdStepCount(stepCountInput);
    const timeStepFs = getValidatedMdTimeStepFs(timeStepInput);
    totalTimeEl.textContent = formatFs(stepCount * timeStepFs);
  });
}

function renderSubmitButton() {
  if (!submitJobBtn) return;

  const modeMeta = getModeMeta(_state.selectedMode);
  const blockedByAvailability = areAllHardwareTiersUnavailable();
  submitJobBtn.disabled = Boolean(_state.isSubmitting || blockedByAvailability);
  submitJobBtn.textContent = _state.isSubmitting
    ? (_state.submittingLabelOverride || modeMeta.submittingLabel)
    : (_state.submitLabelOverride || modeMeta.submitLabel);
}

function renderSelectedMode() {
  const preferredMode = getPreferredMode();
  if (!Object.prototype.hasOwnProperty.call(JOB_MODES, preferredMode)) {
    _state.selectedMode = "point_solve";
  }
  if (_state.lockedMode) {
    _state.selectedMode = preferredMode;
  }

  submitModeTabs.forEach((tab) => {
    const isActive = tab.dataset.submitMode === _state.selectedMode;
    const isLockedOut = Boolean(_state.lockedMode) && tab.dataset.submitMode !== _state.lockedMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    tab.disabled = isLockedOut;
    tab.setAttribute("aria-disabled", String(isLockedOut));
  });

  submitPanels.forEach((panel) => {
    const isActive = panel.dataset.submitPanel === _state.selectedMode;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
    panel.setAttribute("aria-hidden", String(!isActive));
  });

  renderSubmitButton();
  renderSubmitAvailabilityNotice();
}

function setSelectedMode(mode) {
  if (_state.lockedMode && mode !== _state.lockedMode) return;
  if (!Object.prototype.hasOwnProperty.call(JOB_MODES, mode)) return;
  _state.selectedMode = mode;
  showError("");
  renderSelectedMode();
  scrollActivePanelToTop();
}

function focusActiveInput(preferredInputName = "") {
  setTimeout(() => {
    const inputName = preferredInputName || _state.initialFocusInput || "nickname";
    const input = [getActiveInput(inputName), getActiveInput("nickname")]
      .find((candidate) => candidate && !candidate.disabled);
    input?.focus();
    input?.select?.();
  }, 0);
}

async function refreshHardwareHealth() {
  const requestId = ++hardwareHealthRequestSeq;
  _state.activeHealthRequestId = requestId;
  _state.healthLoading = true;
  _state.healthError = "";
  _state.hardwareHealth = {};
  renderHardwareCards();

  try {
    const response = await getRunpodHealthCallable({
      hardware_tiers: Object.keys(HARDWARE_TIERS),
    });

    if (_state.activeHealthRequestId !== requestId) return;

    const tiers = response?.data?.tiers || {};
    const hardwareHealth = {};
    Object.keys(HARDWARE_TIERS).forEach((tier) => {
      const summary = normalizeHardwareHealthSummary(tiers[tier]);
      if (summary) hardwareHealth[tier] = summary;
    });

    _state.hardwareHealth = hardwareHealth;
  } catch (e) {
    if (_state.activeHealthRequestId !== requestId) return;
    _state.healthError = e?.message || String(e);
    _state.hardwareHealth = {};
  } finally {
    if (_state.activeHealthRequestId !== requestId) return;
    _state.healthLoading = false;
    renderHardwareCards();
  }
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
  const nicknameEl = getActiveInput("nickname");
  const maxRuntimeEl = getActiveInput("maxRuntime");
  const mdStepCountEl = getActiveInput("mdStepCount");
  const mdTimeStepFsEl = getActiveInput("mdTimeStepFs");

  try {
    showError("");

    const nickname = (nicknameEl?.value || "").trim();
    if (!nickname) {
      showError("Nickname is required.");
      nicknameEl?.focus();
      return;
    }

    if (areAllHardwareTiersUnavailable()) {
      showError(getAllWorkersUnavailableMessage());
      return;
    }

    const hardwareTierEl = getActiveInput("hardwareTier");
    const hardwareTier = Object.keys(HARDWARE_TIERS).includes(hardwareTierEl?.value)
      ? hardwareTierEl.value
      : "budget";

    if (isHardwareTierUnavailable(hardwareTier)) {
      const label = getHardwareMeta(hardwareTier).label;
      showError(`${label} has no ready or running workers right now. Please choose another tier or try again later.`);
      return;
    }

    const maxMinutes = getValidatedMaxRuntimeMinutes(maxRuntimeEl);
    const maxRuntimeSec = maxMinutes * 60;

    if (maxRuntimeEl) maxRuntimeEl.value = String(maxMinutes);

    let mdConfig = null;
    if (_state.selectedMode === "molecular_dynamics") {
      const stepCount = getValidatedMdStepCount(mdStepCountEl);
      const timeStepFs = getValidatedMdTimeStepFs(mdTimeStepFsEl);

      if (mdStepCountEl) mdStepCountEl.value = String(stepCount);
      if (mdTimeStepFsEl) mdTimeStepFsEl.value = String(timeStepFs);

      mdConfig = {
        initial_velocity_xml: _state.mdInitialVelocityXml || "",
        step_count: stepCount,
        time_step_fs: timeStepFs,
        total_time_fs: stepCount * timeStepFs,
        trajectory_file: "md_trajectory.json",
      };
    }

    _state.isSubmitting = true;
    renderSubmitButton();

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
      mdConfig,
    });

    close();
  } catch (e) {
    showError(e?.message || String(e));
  } finally {
    _state.isSubmitting = false;
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
    focusActiveInput("nickname");
  });
});

document.querySelectorAll('[data-submit-input="hardwareTier"]').forEach((input) => {
  input.addEventListener("change", renderHardwareCards);
});

document.querySelectorAll('[data-submit-input="maxRuntime"]').forEach((input) => {
  input.addEventListener("input", renderRuntimeEstimates);
  input.addEventListener("change", renderRuntimeEstimates);
});

document.querySelectorAll('[data-submit-input="mdStepCount"], [data-submit-input="mdTimeStepFs"]').forEach((input) => {
  input.addEventListener("input", renderMdEstimates);
  input.addEventListener("change", renderMdEstimates);
});

bindTabKeyboardNavigation();
submitJobBtn?.addEventListener("click", handleSubmit);

window.openSubmitModal = function openSubmitModal({
  fileName,
  displayFileName,
  nAtoms,
  moleculeXml,
  mdInitialVelocityXml,
  onSubmit,
  selectedMode = "point_solve",
  lockedMode = "",
  hideTabs = false,
  title = DEFAULT_MODAL_TITLE,
  contextMessage = "",
  submitLabel = "",
  submittingLabel = "",
  mdModeTitle = DEFAULT_MD_MODE_TITLE,
  mdModeDescription = DEFAULT_MD_MODE_DESCRIPTION,
  mdInputHint = DEFAULT_MD_INPUT_HINT,
  initialNickname = "",
  initialHardwareTier = "",
  initialMaxRuntimeMinutes = null,
  initialMdStepCount = null,
  initialMdTimeStepFs = null,
  initialFocusInput = "",
  disabledInputs = [],
}) {
  const nextMode = Object.prototype.hasOwnProperty.call(JOB_MODES, lockedMode)
    ? lockedMode
    : Object.prototype.hasOwnProperty.call(JOB_MODES, selectedMode)
      ? selectedMode
      : "point_solve";

  _state = {
    fileName,
    displayFileName: displayFileName || fileName || "",
    nAtoms,
    mdInitialVelocityXml: mdInitialVelocityXml || "",
    moleculeXml,
    onSubmit,
    selectedMode: nextMode,
    lockedMode: Object.prototype.hasOwnProperty.call(JOB_MODES, lockedMode) ? lockedMode : "",
    hideTabs: Boolean(hideTabs),
    modalTitle: title || DEFAULT_MODAL_TITLE,
    modalContextMessage: contextMessage || "",
    submitLabelOverride: submitLabel || "",
    submittingLabelOverride: submittingLabel || "",
    mdModeTitle: mdModeTitle || DEFAULT_MD_MODE_TITLE,
    mdModeDescription: mdModeDescription || DEFAULT_MD_MODE_DESCRIPTION,
    mdInputHint: mdInputHint || DEFAULT_MD_INPUT_HINT,
    initialNickname: initialNickname || "",
    initialHardwareTier: initialHardwareTier || "",
    initialMaxRuntimeMinutes: toOptionalFiniteNumber(initialMaxRuntimeMinutes),
    initialMdStepCount: toOptionalFiniteNumber(initialMdStepCount),
    initialMdTimeStepFs: toOptionalFiniteNumber(initialMdTimeStepFs),
    initialFocusInput: initialFocusInput || "",
    disabledInputs: Array.isArray(disabledInputs) ? disabledInputs : [],
    isSubmitting: false,
    healthLoading: false,
    healthError: "",
    hardwareHealth: {},
    activeHealthRequestId: 0,
  };

  setBoundText("fileName", _state.displayFileName || "-");
  setBoundText("atomCount", Number.isFinite(nAtoms) ? String(nAtoms) : "-");

  applyModalChrome();
  resetInputs();
  applyInputDisabledStates();
  renderHardwareCards();
  renderRuntimeEstimates();
  renderMdEstimates();
  showError("");
  renderSelectedMode();
  scrollActivePanelToTop();
  open();
  focusActiveInput();
  refreshHardwareHealth();
};
