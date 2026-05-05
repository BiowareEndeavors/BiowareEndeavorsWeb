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
const inputBuilderCanvas = document.getElementById("inputBuilderCanvas");
const inputBuilderEmptyEl = document.getElementById("inputBuilderEmpty");
const inputBuilderAddAtomBtn = document.getElementById("inputBuilderAddAtomBtn");
const inputBuilderResetViewBtn = document.getElementById("inputBuilderResetViewBtn");
const inputAtomRowsEl = document.getElementById("inputAtomRows");
const inputAtomTableWrapEl = document.getElementById("inputAtomTableWrap");

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
    price: "$0.00047/s - $0.00062/s",
    minRate: 0.00047,
    maxRate: 0.00062,
  },
  performance: {
    label: "Performance",
    gpu: "H200 / H100",
    price: "$0.00174/s - $0.00230/s",
    minRate: 0.00174,
    maxRate: 0.00230,
  },
};

const DEFAULT_MODAL_TITLE = modalTitleEl?.textContent?.trim() || "Submit Job";
const DEFAULT_MD_MODE_TITLE = mdModeTitleEl?.textContent?.trim() || "Molecular Dynamics";
const DEFAULT_MD_MODE_DESCRIPTION =
  mdModeDescriptionEl?.textContent?.trim() ||
  "Run a short molecular dynamics trajectory and return frame-by-frame nuclear coordinates for playback.";
const DEFAULT_MD_INPUT_HINT = mdInputHintEl?.textContent?.trim() || "";
const DEFAULT_VELOCITY_UNITS = "angstrom_per_fs";
const DEFAULT_SYSTEM_CHARGE = 0;
const BUILDER_NUMBER_STEP = "0.0001";

const DEFAULT_ELEMENT_STYLE = { number: 6, symbol: "X", name: "Atom", color: "#91a9bf", radius: 1.2 };
const ELEMENT_DATA = [
  { number: 1, symbol: "H", name: "Hydrogen" },
  { number: 2, symbol: "He", name: "Helium" },
  { number: 3, symbol: "Li", name: "Lithium" },
  { number: 4, symbol: "Be", name: "Beryllium" },
  { number: 5, symbol: "B", name: "Boron" },
  { number: 6, symbol: "C", name: "Carbon" },
  { number: 7, symbol: "N", name: "Nitrogen" },
  { number: 8, symbol: "O", name: "Oxygen" },
  { number: 9, symbol: "F", name: "Fluorine" },
  { number: 10, symbol: "Ne", name: "Neon" },
  { number: 11, symbol: "Na", name: "Sodium" },
  { number: 12, symbol: "Mg", name: "Magnesium" },
  { number: 13, symbol: "Al", name: "Aluminum" },
  { number: 14, symbol: "Si", name: "Silicon" },
  { number: 15, symbol: "P", name: "Phosphorus" },
  { number: 16, symbol: "S", name: "Sulfur" },
  { number: 17, symbol: "Cl", name: "Chlorine" },
  { number: 18, symbol: "Ar", name: "Argon" },
  { number: 19, symbol: "K", name: "Potassium" },
  { number: 20, symbol: "Ca", name: "Calcium" },
  { number: 21, symbol: "Sc", name: "Scandium" },
  { number: 22, symbol: "Ti", name: "Titanium" },
  { number: 23, symbol: "V", name: "Vanadium" },
  { number: 24, symbol: "Cr", name: "Chromium" },
  { number: 25, symbol: "Mn", name: "Manganese" },
  { number: 26, symbol: "Fe", name: "Iron" },
  { number: 27, symbol: "Co", name: "Cobalt" },
  { number: 28, symbol: "Ni", name: "Nickel" },
  { number: 29, symbol: "Cu", name: "Copper" },
  { number: 30, symbol: "Zn", name: "Zinc" },
  { number: 31, symbol: "Ga", name: "Gallium" },
  { number: 32, symbol: "Ge", name: "Germanium" },
  { number: 33, symbol: "As", name: "Arsenic" },
  { number: 34, symbol: "Se", name: "Selenium" },
  { number: 35, symbol: "Br", name: "Bromine" },
  { number: 36, symbol: "Kr", name: "Krypton" },
  { number: 37, symbol: "Rb", name: "Rubidium" },
  { number: 38, symbol: "Sr", name: "Strontium" },
  { number: 39, symbol: "Y", name: "Yttrium" },
  { number: 40, symbol: "Zr", name: "Zirconium" },
  { number: 41, symbol: "Nb", name: "Niobium" },
  { number: 42, symbol: "Mo", name: "Molybdenum" },
  { number: 43, symbol: "Tc", name: "Technetium" },
  { number: 44, symbol: "Ru", name: "Ruthenium" },
  { number: 45, symbol: "Rh", name: "Rhodium" },
  { number: 46, symbol: "Pd", name: "Palladium" },
  { number: 47, symbol: "Ag", name: "Silver" },
  { number: 48, symbol: "Cd", name: "Cadmium" },
  { number: 49, symbol: "In", name: "Indium" },
  { number: 50, symbol: "Sn", name: "Tin" },
  { number: 51, symbol: "Sb", name: "Antimony" },
  { number: 52, symbol: "Te", name: "Tellurium" },
  { number: 53, symbol: "I", name: "Iodine" },
  { number: 54, symbol: "Xe", name: "Xenon" },
  { number: 55, symbol: "Cs", name: "Cesium" },
  { number: 56, symbol: "Ba", name: "Barium" },
  { number: 57, symbol: "La", name: "Lanthanum" },
  { number: 58, symbol: "Ce", name: "Cerium" },
  { number: 59, symbol: "Pr", name: "Praseodymium" },
  { number: 60, symbol: "Nd", name: "Neodymium" },
  { number: 61, symbol: "Pm", name: "Promethium" },
  { number: 62, symbol: "Sm", name: "Samarium" },
  { number: 63, symbol: "Eu", name: "Europium" },
  { number: 64, symbol: "Gd", name: "Gadolinium" },
  { number: 65, symbol: "Tb", name: "Terbium" },
  { number: 66, symbol: "Dy", name: "Dysprosium" },
  { number: 67, symbol: "Ho", name: "Holmium" },
  { number: 68, symbol: "Er", name: "Erbium" },
  { number: 69, symbol: "Tm", name: "Thulium" },
  { number: 70, symbol: "Yb", name: "Ytterbium" },
  { number: 71, symbol: "Lu", name: "Lutetium" },
  { number: 72, symbol: "Hf", name: "Hafnium" },
  { number: 73, symbol: "Ta", name: "Tantalum" },
  { number: 74, symbol: "W", name: "Tungsten" },
  { number: 75, symbol: "Re", name: "Rhenium" },
  { number: 76, symbol: "Os", name: "Osmium" },
  { number: 77, symbol: "Ir", name: "Iridium" },
  { number: 78, symbol: "Pt", name: "Platinum" },
  { number: 79, symbol: "Au", name: "Gold" },
  { number: 80, symbol: "Hg", name: "Mercury" },
  { number: 81, symbol: "Tl", name: "Thallium" },
  { number: 82, symbol: "Pb", name: "Lead" },
  { number: 83, symbol: "Bi", name: "Bismuth" },
  { number: 84, symbol: "Po", name: "Polonium" },
  { number: 85, symbol: "At", name: "Astatine" },
  { number: 86, symbol: "Rn", name: "Radon" },
  { number: 87, symbol: "Fr", name: "Francium" },
  { number: 88, symbol: "Ra", name: "Radium" },
  { number: 89, symbol: "Ac", name: "Actinium" },
  { number: 90, symbol: "Th", name: "Thorium" },
  { number: 91, symbol: "Pa", name: "Protactinium" },
  { number: 92, symbol: "U", name: "Uranium" },
  { number: 93, symbol: "Np", name: "Neptunium" },
  { number: 94, symbol: "Pu", name: "Plutonium" },
  { number: 95, symbol: "Am", name: "Americium" },
  { number: 96, symbol: "Cm", name: "Curium" },
  { number: 97, symbol: "Bk", name: "Berkelium" },
  { number: 98, symbol: "Cf", name: "Californium" },
  { number: 99, symbol: "Es", name: "Einsteinium" },
  { number: 100, symbol: "Fm", name: "Fermium" },
  { number: 101, symbol: "Md", name: "Mendelevium" },
  { number: 102, symbol: "No", name: "Nobelium" },
  { number: 103, symbol: "Lr", name: "Lawrencium" },
  { number: 104, symbol: "Rf", name: "Rutherfordium" },
  { number: 105, symbol: "Db", name: "Dubnium" },
  { number: 106, symbol: "Sg", name: "Seaborgium" },
  { number: 107, symbol: "Bh", name: "Bohrium" },
  { number: 108, symbol: "Hs", name: "Hassium" },
  { number: 109, symbol: "Mt", name: "Meitnerium" },
  { number: 110, symbol: "Ds", name: "Darmstadtium" },
  { number: 111, symbol: "Rg", name: "Roentgenium" },
  { number: 112, symbol: "Cn", name: "Copernicium" },
  { number: 113, symbol: "Nh", name: "Nihonium" },
  { number: 114, symbol: "Fl", name: "Flerovium" },
  { number: 115, symbol: "Mc", name: "Moscovium" },
  { number: 116, symbol: "Lv", name: "Livermorium" },
  { number: 117, symbol: "Ts", name: "Tennessine" },
  { number: 118, symbol: "Og", name: "Oganesson" },
];
const COMMON_ELEMENT_STYLES = {
  1: { color: "#f0f2f5", radius: 0.31 },
  5: { color: "#ffb5b5", radius: 0.84 },
  6: { color: "#3b3d44", radius: 0.76 },
  7: { color: "#4665ff", radius: 0.71 },
  8: { color: "#ef3d3d", radius: 0.66 },
  9: { color: "#8be65a", radius: 0.57 },
  14: { color: "#f2c975", radius: 1.11 },
  15: { color: "#ff8c1a", radius: 1.07 },
  16: { color: "#f0db32", radius: 1.05 },
  17: { color: "#30d651", radius: 1.02 },
  35: { color: "#9b3a35", radius: 1.2 },
  53: { color: "#9a44a8", radius: 1.39 },
};
const ELEMENT_CHOICES = ELEMENT_DATA.map((element) => ({
  ...element,
  ...getDefaultElementVisual(element.number),
}));
const ELEMENT_BY_NUMBER = ELEMENT_CHOICES.reduce((map, item) => {
  map[item.number] = item;
  return map;
}, {});

let inputBuilderRenderRaf = 0;
let inputBuilderProjectedAtoms = [];
const inputBuilderView = {
  yaw: -0.58,
  pitch: 0.42,
  zoom: 1,
};
const inputBuilderPointer = {
  active: false,
  moved: false,
  pointerId: 0,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
};

let _state = {
  fileName: "",
  displayFileName: "",
  nAtoms: 0,
  atoms: [],
  nextAtomId: 1,
  selectedAtomId: "",
  hasEditableInput: false,
  isInputBuilderReadOnly: false,
  hadInitialVelocities: false,
  velocityUnits: DEFAULT_VELOCITY_UNITS,
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
  initialSystemCharge: DEFAULT_SYSTEM_CHARGE,
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

function toOptionalPositiveFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toNonnegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function parseSystemCharge(value, fallback = DEFAULT_SYSTEM_CHARGE) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;

  const number = Number(text);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new Error("Total system charge must be a whole number.");
  }

  return number;
}

function normalizeInitialSystemCharge(value) {
  try {
    return parseSystemCharge(value, DEFAULT_SYSTEM_CHARGE);
  } catch (_) {
    return DEFAULT_SYSTEM_CHARGE;
  }
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

function builderLocalName(node) {
  return (node && (node.localName || node.nodeName || "")).split(":").pop();
}

function findBuilderFirstByLocalName(root, name) {
  const all = root && typeof root.getElementsByTagName === "function"
    ? root.getElementsByTagName("*")
    : [];
  for (let i = 0; i < all.length; i += 1) {
    if (builderLocalName(all[i]) === name) return all[i];
  }
  return null;
}

function builderChildrenByLocalName(parent, name) {
  if (!parent) return [];
  const out = [];
  for (let i = 0; i < parent.children.length; i += 1) {
    if (builderLocalName(parent.children[i]) === name) out.push(parent.children[i]);
  }
  return out;
}

function extractSystemChargeFromXml(moleculeXml) {
  const xmlText = String(moleculeXml || "").trim();
  if (!xmlText) return DEFAULT_SYSTEM_CHARGE;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parserErrors = doc.getElementsByTagName("parsererror");
    if (parserErrors && parserErrors.length) return DEFAULT_SYSTEM_CHARGE;

    const settingsEl = findBuilderFirstByLocalName(doc, "DFTSettings");
    const chargeEl = settingsEl
      ? builderChildrenByLocalName(settingsEl, "SystemCharge")[0]
      : findBuilderFirstByLocalName(doc, "SystemCharge");
    return normalizeInitialSystemCharge(chargeEl?.textContent);
  } catch (_) {
    return DEFAULT_SYSTEM_CHARGE;
  }
}

function parseBuilderNumericList(parent, childName) {
  return builderChildrenByLocalName(parent, childName).map((node) => {
    const value = Number((node.textContent || "").trim());
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric value in <${childName}>.`);
    }
    return value;
  });
}

function minifyBuilderXml(xmlText) {
  return String(xmlText || "")
    .replace(/>\s+</g, "><")
    .replace(/\r?\n/g, "")
    .trim();
}

function escapeBuilderXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeBuilderXmlAttribute(value) {
  return escapeBuilderXmlText(value).replace(/"/g, "&quot;");
}

function escapeBuilderHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatXmlNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  if (Math.abs(number) < 1e-12) return "0";
  return String(Number(number.toPrecision(12)));
}

function formatBuilderInputNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) < 1e-12) return "0";
  return String(Number(number.toFixed(6)));
}

function getDefaultElementVisual(atomicNumber) {
  const number = Math.trunc(Number(atomicNumber) || 0);
  if (COMMON_ELEMENT_STYLES[number]) return COMMON_ELEMENT_STYLES[number];

  if ([2, 10, 18, 36, 54, 86, 118].includes(number)) {
    return { color: "#7fdcff", radius: 1.05 };
  }
  if ([3, 11, 19, 37, 55, 87].includes(number)) {
    return { color: "#c69cff", radius: 1.62 };
  }
  if ([4, 12, 20, 38, 56, 88].includes(number)) {
    return { color: "#73df91", radius: 1.45 };
  }
  if ((number >= 57 && number <= 71)) {
    return { color: "#ff9fd2", radius: 1.58 };
  }
  if ((number >= 89 && number <= 103)) {
    return { color: "#ff8c87", radius: 1.62 };
  }
  if (
    (number >= 21 && number <= 30) ||
    (number >= 39 && number <= 48) ||
    (number >= 72 && number <= 80) ||
    (number >= 104 && number <= 112)
  ) {
    return { color: "#aebdca", radius: 1.32 };
  }
  if ([13, 31, 49, 50, 81, 82, 83, 113, 114, 115, 116].includes(number)) {
    return { color: "#8fc8ff", radius: 1.28 };
  }
  if ([32, 33, 34, 51, 52, 84].includes(number)) {
    return { color: "#ffbf72", radius: 1.22 };
  }
  if ([85, 117].includes(number)) {
    return { color: "#65d989", radius: 1.25 };
  }

  return { color: DEFAULT_ELEMENT_STYLE.color, radius: DEFAULT_ELEMENT_STYLE.radius };
}

function getElementStyle(atomicNumber) {
  return ELEMENT_BY_NUMBER[Math.trunc(Number(atomicNumber) || 0)] || {
    ...DEFAULT_ELEMENT_STYLE,
    number: Math.max(1, Math.trunc(Number(atomicNumber) || DEFAULT_ELEMENT_STYLE.number)),
  };
}

function getElementSymbol(atomicNumber) {
  const style = getElementStyle(atomicNumber);
  return style.symbol || `Z${Math.trunc(Number(atomicNumber) || 0)}`;
}

function normalizeBuilderAtomicNumber(value) {
  const number = Math.trunc(Number(value) || DEFAULT_ELEMENT_STYLE.number);
  return Math.max(1, Math.min(118, number));
}

function normalizeBuilderFloat(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function createBuilderAtomId() {
  const id = `atom-${_state.nextAtomId}`;
  _state.nextAtomId += 1;
  return id;
}

function getBuilderAtomById(atomId) {
  return _state.atoms.find((atom) => atom.id === atomId) || null;
}

function parseInitialVelocityXml(initialVelocityXml, atomCount) {
  const zeros = Array.from({ length: atomCount }, () => 0);
  const raw = String(initialVelocityXml || "").trim();
  if (!raw) {
    return {
      units: DEFAULT_VELOCITY_UNITS,
      hadInitialVelocities: false,
      vx: zeros.slice(),
      vy: zeros.slice(),
      vz: zeros.slice(),
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<InsightVelocity>${raw}</InsightVelocity>`, "application/xml");
  const parserErrors = doc.getElementsByTagName("parsererror");
  if (parserErrors && parserErrors.length) {
    throw new Error("Unable to parse initial velocity XML.");
  }

  const unitsEl = findBuilderFirstByLocalName(doc, "VelocityUnits");
  const vxEl = findBuilderFirstByLocalName(doc, "VelocityX");
  const vyEl = findBuilderFirstByLocalName(doc, "VelocityY");
  const vzEl = findBuilderFirstByLocalName(doc, "VelocityZ");
  const hasAnyVelocity = Boolean(vxEl || vyEl || vzEl);

  if (!hasAnyVelocity) {
    return {
      units: (unitsEl?.textContent || DEFAULT_VELOCITY_UNITS).trim() || DEFAULT_VELOCITY_UNITS,
      hadInitialVelocities: false,
      vx: zeros.slice(),
      vy: zeros.slice(),
      vz: zeros.slice(),
    };
  }

  if (!vxEl || !vyEl || !vzEl) {
    throw new Error("Initial velocities must include VelocityX, VelocityY, and VelocityZ.");
  }

  const vx = parseBuilderNumericList(vxEl, "VelocityX_E");
  const vy = parseBuilderNumericList(vyEl, "VelocityY_E");
  const vz = parseBuilderNumericList(vzEl, "VelocityZ_E");

  if (vx.length !== atomCount || vy.length !== atomCount || vz.length !== atomCount) {
    throw new Error("Initial velocity counts must match the atom count.");
  }

  return {
    units: (unitsEl?.textContent || DEFAULT_VELOCITY_UNITS).trim() || DEFAULT_VELOCITY_UNITS,
    hadInitialVelocities: true,
    vx,
    vy,
    vz,
  };
}

function getInitialVelocityXmlFromMoleculeDoc(doc) {
  const velocityUnitsEl = findBuilderFirstByLocalName(doc, "VelocityUnits");
  const velocityXEl = findBuilderFirstByLocalName(doc, "VelocityX");
  const velocityYEl = findBuilderFirstByLocalName(doc, "VelocityY");
  const velocityZEl = findBuilderFirstByLocalName(doc, "VelocityZ");

  if (!velocityUnitsEl && !velocityXEl && !velocityYEl && !velocityZEl) return "";

  const serializer = new XMLSerializer();
  return [velocityUnitsEl, velocityXEl, velocityYEl, velocityZEl]
    .filter(Boolean)
    .map((node) => serializer.serializeToString(node))
    .join("");
}

function parseInputBuilderAtoms(moleculeXml, initialVelocityXml) {
  const xmlText = String(moleculeXml || "").trim();
  if (!xmlText) {
    return {
      atoms: [],
      velocityUnits: DEFAULT_VELOCITY_UNITS,
      hadInitialVelocities: false,
    };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserErrors = doc.getElementsByTagName("parsererror");
  if (parserErrors && parserErrors.length) {
    throw new Error("Unable to parse molecule XML for editing.");
  }

  const atomsEl = findBuilderFirstByLocalName(doc, "PC-Atoms_element");
  const xEl = findBuilderFirstByLocalName(doc, "PC-Conformer_x");
  const yEl = findBuilderFirstByLocalName(doc, "PC-Conformer_y");
  const zEl = findBuilderFirstByLocalName(doc, "PC-Conformer_z");

  if (!atomsEl || !xEl || !yEl || !zEl) {
    throw new Error("Molecule XML is missing atom or coordinate tags.");
  }

  const atomicNumbers = parseBuilderNumericList(atomsEl, "PC-Element").map(normalizeBuilderAtomicNumber);
  const xs = parseBuilderNumericList(xEl, "PC-Conformer_x_E");
  const ys = parseBuilderNumericList(yEl, "PC-Conformer_y_E");
  const zs = parseBuilderNumericList(zEl, "PC-Conformer_z_E");

  if (!atomicNumbers.length) {
    throw new Error("Molecule XML does not contain any atoms.");
  }

  if (atomicNumbers.length !== xs.length || xs.length !== ys.length || ys.length !== zs.length) {
    throw new Error("Atom and coordinate counts do not match.");
  }

  const velocityXml = String(initialVelocityXml || "").trim() || getInitialVelocityXmlFromMoleculeDoc(doc);
  const velocities = parseInitialVelocityXml(velocityXml, atomicNumbers.length);
  const atoms = atomicNumbers.map((atomicNumber, index) => ({
    id: createBuilderAtomId(),
    atomicNumber,
    x: xs[index],
    y: ys[index],
    z: zs[index],
    vx: velocities.vx[index] || 0,
    vy: velocities.vy[index] || 0,
    vz: velocities.vz[index] || 0,
  }));

  return {
    atoms,
    velocityUnits: velocities.units || DEFAULT_VELOCITY_UNITS,
    hadInitialVelocities: velocities.hadInitialVelocities,
  };
}

function getElementOptionsHtml(selectedAtomicNumber) {
  const selected = normalizeBuilderAtomicNumber(selectedAtomicNumber);
  const selectedKnown = Boolean(ELEMENT_BY_NUMBER[selected]);
  const options = ELEMENT_CHOICES.map((item) => {
    const label = `${item.symbol} (${item.number})`;
    return `<option value="${item.number}"${item.number === selected ? " selected" : ""}>${label}</option>`;
  });

  if (!selectedKnown) {
    options.push(`<option value="${selected}" selected>Z=${selected}</option>`);
  }

  return options.join("");
}

function renderInputAtomRows() {
  if (!inputAtomRowsEl) return;

  if (!_state.hasEditableInput || !_state.atoms.length) {
    inputAtomRowsEl.innerHTML = "";
    return;
  }

  const readOnly = Boolean(_state.isInputBuilderReadOnly);
  const selectAttrs = readOnly ? " disabled aria-disabled=\"true\"" : "";
  const numberAttrs = readOnly ? " readonly aria-readonly=\"true\"" : "";

  inputAtomRowsEl.innerHTML = _state.atoms
    .map((atom, index) => {
      const selectedClass = atom.id === _state.selectedAtomId ? " is-selected" : "";
      const readOnlyClass = readOnly ? " is-readonly" : "";
      const symbol = escapeBuilderHtml(getElementSymbol(atom.atomicNumber));
      return `
        <tr class="input-atom-row${selectedClass}${readOnlyClass}" data-atom-id="${escapeBuilderHtml(atom.id)}">
          <td class="input-atom-row__atom">
            <span class="input-atom-index">${index + 1}</span>
            <select class="input-atom-select" data-atom-field="atomicNumber" aria-label="Atom ${index + 1} element"${selectAttrs}>
              ${getElementOptionsHtml(atom.atomicNumber)}
            </select>
            <span class="input-atom-symbol" aria-hidden="true">${symbol}</span>
          </td>
          ${["x", "y", "z", "vx", "vy", "vz"]
            .map((field) => `
              <td>
                <input
                  class="input-atom-number"
                  data-atom-field="${field}"
                  type="number"
                  step="${BUILDER_NUMBER_STEP}"
                  value="${formatBuilderInputNumber(atom[field])}"
                  aria-label="Atom ${index + 1} ${field}"
                  ${numberAttrs}
                />
              </td>
            `)
            .join("")}
          <td>
            ${readOnly ? "" : `<button class="input-atom-remove" type="button" data-atom-action="remove" title="Remove atom" aria-label="Remove atom ${index + 1}">&times;</button>`}
          </td>
        </tr>
      `;
    })
    .join("");
}

function updateInputBuilderChrome() {
  const hasInputBuilderRows = Boolean(_state.hasEditableInput);
  const hasInputBuilderAtoms = Boolean(hasInputBuilderRows && _state.atoms.length);
  const readOnly = Boolean(_state.isInputBuilderReadOnly);

  if (inputBuilderEmptyEl) {
    inputBuilderEmptyEl.hidden = hasInputBuilderAtoms;
  }

  if (inputAtomTableWrapEl) {
    inputAtomTableWrapEl.hidden = !hasInputBuilderRows;
  }

  if (inputBuilderAddAtomBtn) {
    inputBuilderAddAtomBtn.hidden = readOnly;
    inputBuilderAddAtomBtn.disabled = !hasInputBuilderRows || readOnly;
  }

}

function setSelectedBuilderAtom(atomId, options = {}) {
  const nextId = getBuilderAtomById(atomId) ? atomId : (_state.atoms[0]?.id || "");
  _state.selectedAtomId = nextId;

  if (inputAtomRowsEl) {
    inputAtomRowsEl.querySelectorAll(".input-atom-row").forEach((row) => {
      row.classList.toggle("is-selected", row.dataset.atomId === nextId);
    });

    if (options.scroll && nextId) {
      inputAtomRowsEl
        .querySelector(`[data-atom-id="${nextId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  scheduleInputBuilderRender();
}

function buildMoleculeXmlFromBuilderAtoms(atoms) {
  const safeAtoms = Array.isArray(atoms) ? atoms : [];
  const elementXml = safeAtoms
    .map((atom) => {
      const atomicNumber = normalizeBuilderAtomicNumber(atom.atomicNumber);
      const style = getElementStyle(atomicNumber);
      const valueAttr = style.symbol && style.symbol !== "X"
        ? ` value="${escapeBuilderXmlAttribute(style.symbol.toLowerCase())}"`
        : "";
      return `<PC-Element${valueAttr}>${atomicNumber}</PC-Element>`;
    })
    .join("");
  const vectorXml = (tagName, entryTagName, field) => safeAtoms
    .map((atom) => `<${entryTagName}>${formatXmlNumber(atom[field])}</${entryTagName}>`)
    .join("");

  return minifyBuilderXml(`<PC-Compounds>
    <PC-Atoms_element>${elementXml}</PC-Atoms_element>
    <PC-Conformer_x>${vectorXml("PC-Conformer_x", "PC-Conformer_x_E", "x")}</PC-Conformer_x>
    <PC-Conformer_y>${vectorXml("PC-Conformer_y", "PC-Conformer_y_E", "y")}</PC-Conformer_y>
    <PC-Conformer_z>${vectorXml("PC-Conformer_z", "PC-Conformer_z_E", "z")}</PC-Conformer_z>
  </PC-Compounds>`);
}

function builderAtomsHaveVelocity() {
  return _state.atoms.some((atom) =>
    Math.abs(Number(atom.vx) || 0) > 1e-12 ||
    Math.abs(Number(atom.vy) || 0) > 1e-12 ||
    Math.abs(Number(atom.vz) || 0) > 1e-12
  );
}

function buildInitialVelocityXmlFromBuilderAtoms(atoms) {
  const safeAtoms = Array.isArray(atoms) ? atoms : [];
  if (!safeAtoms.length) return "";
  if (!_state.hadInitialVelocities && !builderAtomsHaveVelocity()) return "";

  const units = String(_state.velocityUnits || DEFAULT_VELOCITY_UNITS).trim() || DEFAULT_VELOCITY_UNITS;
  const vectorXml = (tagName, entryTagName, field) => safeAtoms
    .map((atom) => `<${entryTagName}>${formatXmlNumber(atom[field])}</${entryTagName}>`)
    .join("");

  return [
    `<VelocityUnits>${escapeBuilderXmlText(units)}</VelocityUnits>`,
    `<VelocityX>${vectorXml("VelocityX", "VelocityX_E", "vx")}</VelocityX>`,
    `<VelocityY>${vectorXml("VelocityY", "VelocityY_E", "vy")}</VelocityY>`,
    `<VelocityZ>${vectorXml("VelocityZ", "VelocityZ_E", "vz")}</VelocityZ>`,
  ].join("");
}

function validateBuilderAtoms() {
  if (!_state.hasEditableInput) return;
  if (!_state.atoms.length) {
    throw new Error("Add at least one atom before submitting.");
  }

  _state.atoms.forEach((atom, index) => {
    atom.atomicNumber = normalizeBuilderAtomicNumber(atom.atomicNumber);
    ["x", "y", "z", "vx", "vy", "vz"].forEach((field) => {
      const value = Number(atom[field]);
      if (!Number.isFinite(value)) {
        throw new Error(`Atom ${index + 1} has an invalid ${field.toUpperCase()} value.`);
      }
      atom[field] = value;
    });
  });
}

function refreshBuilderXmlFromAtoms() {
  if (!_state.hasEditableInput || _state.isInputBuilderReadOnly) {
    updateInputBuilderChrome();
    scheduleInputBuilderRender();
    return;
  }

  _state.nAtoms = _state.atoms.length;
  _state.moleculeXml = buildMoleculeXmlFromBuilderAtoms(_state.atoms);
  _state.mdInitialVelocityXml = buildInitialVelocityXmlFromBuilderAtoms(_state.atoms);
  setBoundText("atomCount", String(_state.nAtoms));
  updateInputBuilderChrome();
  scheduleInputBuilderRender();
}

function resetInputBuilderView() {
  inputBuilderView.yaw = -0.58;
  inputBuilderView.pitch = 0.42;
  inputBuilderView.zoom = 1;
  scheduleInputBuilderRender();
}

function setInputBuilderFromXml(moleculeXml, initialVelocityXml) {
  _state.atoms = [];
  _state.nextAtomId = 1;
  _state.selectedAtomId = "";
  _state.hasEditableInput = false;
  _state.hadInitialVelocities = false;
  _state.velocityUnits = DEFAULT_VELOCITY_UNITS;

  const xmlText = String(moleculeXml || "").trim();
  if (!xmlText) {
    renderInputAtomRows();
    updateInputBuilderChrome();
    scheduleInputBuilderRender();
    return;
  }

  const parsed = parseInputBuilderAtoms(xmlText, initialVelocityXml);
  _state.atoms = parsed.atoms;
  _state.hasEditableInput = true;
  _state.hadInitialVelocities = parsed.hadInitialVelocities;
  _state.velocityUnits = parsed.velocityUnits || DEFAULT_VELOCITY_UNITS;
  _state.selectedAtomId = _state.atoms[0]?.id || "";
  _state.nAtoms = _state.atoms.length;

  resetInputBuilderView();
  renderInputAtomRows();
  scrollInputBuilderToTop();
  if (_state.isInputBuilderReadOnly) {
    setBoundText("atomCount", String(_state.nAtoms));
    updateInputBuilderChrome();
    scheduleInputBuilderRender();
  } else {
    refreshBuilderXmlFromAtoms();
  }
}

function setBlankInputBuilder() {
  _state.atoms = [];
  _state.nextAtomId = 1;
  _state.selectedAtomId = "";
  _state.hasEditableInput = true;
  _state.hadInitialVelocities = false;
  _state.velocityUnits = DEFAULT_VELOCITY_UNITS;
  _state.nAtoms = 0;
  resetInputBuilderView();
  renderInputAtomRows();
  scrollInputBuilderToTop();
  refreshBuilderXmlFromAtoms();
}

function createDefaultBuilderAtom() {
  const lastAtom = _state.atoms[_state.atoms.length - 1];
  return {
    id: createBuilderAtomId(),
    atomicNumber: 6,
    x: lastAtom ? Number(lastAtom.x) + 1.35 : 0,
    y: lastAtom ? Number(lastAtom.y) : 0,
    z: lastAtom ? Number(lastAtom.z) : 0,
    vx: 0,
    vy: 0,
    vz: 0,
  };
}

function addBuilderAtom() {
  if (!_state.hasEditableInput || _state.isInputBuilderReadOnly) return;
  const atom = createDefaultBuilderAtom();
  _state.atoms.push(atom);
  showError("");
  renderInputAtomRows();
  setSelectedBuilderAtom(atom.id, { scroll: true });
  refreshBuilderXmlFromAtoms();
}

function removeBuilderAtom(atomId) {
  if (!_state.hasEditableInput || _state.isInputBuilderReadOnly) return;
  const index = _state.atoms.findIndex((atom) => atom.id === atomId);
  if (index < 0) return;

  _state.atoms.splice(index, 1);
  const nextAtom = _state.atoms[Math.min(index, _state.atoms.length - 1)] || _state.atoms[0] || null;
  _state.selectedAtomId = nextAtom?.id || "";
  renderInputAtomRows();
  refreshBuilderXmlFromAtoms();
}

function readAtomFieldChange(target) {
  if (_state.isInputBuilderReadOnly) return;

  const row = target.closest("[data-atom-id]");
  const field = target.dataset.atomField || "";
  if (!row || !field) return;

  const atom = getBuilderAtomById(row.dataset.atomId);
  if (!atom) return;

  if (field === "atomicNumber") {
    atom.atomicNumber = normalizeBuilderAtomicNumber(target.value);
    renderInputAtomRows();
    setSelectedBuilderAtom(atom.id);
  } else if (["x", "y", "z", "vx", "vy", "vz"].includes(field)) {
    atom[field] = normalizeBuilderFloat(target.value);
  }

  refreshBuilderXmlFromAtoms();
}

function hexToRgb(hex) {
  const text = String(hex || "").replace("#", "");
  const value = /^[0-9a-f]{6}$/i.test(text) ? parseInt(text, 16) : 0x91a9bf;
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbString(rgb, alpha = 1) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function lightenRgb(rgb, amount) {
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * amount),
    g: Math.round(rgb.g + (255 - rgb.g) * amount),
    b: Math.round(rgb.b + (255 - rgb.b) * amount),
  };
}

function getBuilderBounds(atoms) {
  if (!atoms.length) {
    return {
      center: [0, 0, 0],
      radius: 1,
    };
  }

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  atoms.forEach((atom) => {
    const values = [Number(atom.x) || 0, Number(atom.y) || 0, Number(atom.z) || 0];
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], values[i]);
      max[i] = Math.max(max[i], values[i]);
    }
  });

  const center = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  return {
    center,
    radius: Math.max(0.8, Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5 + 0.9),
  };
}

function rotateBuilderPoint(x, y, z) {
  const cy = Math.cos(inputBuilderView.yaw);
  const sy = Math.sin(inputBuilderView.yaw);
  const cp = Math.cos(inputBuilderView.pitch);
  const sp = Math.sin(inputBuilderView.pitch);
  const rx = cy * x + sy * z;
  const rz = -sy * x + cy * z;
  const ry = cp * y - sp * rz;
  const rz2 = sp * y + cp * rz;
  return [rx, ry, rz2];
}

function projectBuilderPoint(point, bounds, width, height) {
  const centered = [
    Number(point[0] || 0) - bounds.center[0],
    Number(point[1] || 0) - bounds.center[1],
    Number(point[2] || 0) - bounds.center[2],
  ];
  const rotated = rotateBuilderPoint(centered[0], centered[1], centered[2]);
  const scale = Math.min(width, height) * 0.38 * inputBuilderView.zoom / bounds.radius;
  return {
    x: width * 0.5 + rotated[0] * scale,
    y: height * 0.5 - rotated[1] * scale,
    z: rotated[2],
    scale,
  };
}

function inferBuilderBonds(atoms) {
  const bonds = [];
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const a = atoms[i];
      const b = atoms[j];
      const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
      const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
      const dz = (Number(a.z) || 0) - (Number(b.z) || 0);
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const cutoff = (getElementStyle(a.atomicNumber).radius + getElementStyle(b.atomicNumber).radius) * 1.22 + 0.18;
      if (distance > 0.22 && distance <= cutoff) {
        bonds.push([i, j]);
      }
    }
  }
  return bonds;
}

function resizeInputBuilderCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return {
    width: rect.width || width / dpr,
    height: rect.height || height / dpr,
    dpr,
  };
}

function drawBuilderVelocitySegment(ctx, segment) {
  ctx.save();
  ctx.strokeStyle = segment.color;
  ctx.lineWidth = segment.lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(segment.x0, segment.y0);
  ctx.lineTo(segment.x1, segment.y1);
  ctx.stroke();
  ctx.restore();
}

function drawBuilderVelocityHead(ctx, head) {
  ctx.save();
  ctx.fillStyle = head.color;
  ctx.beginPath();
  ctx.moveTo(head.x, head.y);
  ctx.lineTo(
    head.x - head.ux * head.size - head.uy * head.size * 0.44,
    head.y - head.uy * head.size + head.ux * head.size * 0.44
  );
  ctx.lineTo(
    head.x - head.ux * head.size + head.uy * head.size * 0.44,
    head.y - head.uy * head.size - head.ux * head.size * 0.44
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBuilderBondSegment(ctx, segment) {
  ctx.save();
  ctx.strokeStyle = "rgba(219,228,235,0.72)";
  ctx.lineWidth = segment.lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(segment.x0, segment.y0);
  ctx.lineTo(segment.x1, segment.y1);
  ctx.stroke();
  ctx.restore();
}

function drawBuilderAtom(ctx, item, atomCount) {
  const rgb = hexToRgb(item.style.color);
  const highlight = lightenRgb(rgb, 0.58);
  const shade = lightenRgb(rgb, 0.05);
  const gradient = ctx.createRadialGradient(
    item.x - item.radius * 0.35,
    item.y - item.radius * 0.45,
    Math.max(1, item.radius * 0.15),
    item.x,
    item.y,
    item.radius
  );
  gradient.addColorStop(0, rgbString(highlight, 1));
  gradient.addColorStop(0.62, rgbString(rgb, 1));
  gradient.addColorStop(1, rgbString(shade, 1));

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (item.atom.id === _state.selectedAtomId) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,102,0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.radius + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (atomCount <= 80 && item.radius >= 7) {
    ctx.save();
    ctx.fillStyle = item.style.number === 6 ? "rgba(255,255,255,0.95)" : "rgba(5,9,11,0.82)";
    ctx.font = "800 10px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(getElementSymbol(item.atom.atomicNumber), item.x, item.y + 0.5);
    ctx.restore();
  }
}

function getBuilderBondSegments(projected, atoms) {
  const segments = [];
  const bondLineWidth = Math.max(2, Math.min(4, 2.4 * inputBuilderView.zoom));

  inferBuilderBonds(atoms).forEach(([a, b]) => {
    const startAtom = projected[a];
    const endAtom = projected[b];
    if (!startAtom || !endAtom) return;

    const dx = endAtom.x - startAtom.x;
    const dy = endAtom.y - startAtom.y;
    const dz = endAtom.z - startAtom.z;
    const screenLength = Math.sqrt(dx * dx + dy * dy);
    if (!(screenLength > 1e-5)) return;

    const trimStart = Math.min(screenLength * 0.35, Math.max(bondLineWidth, startAtom.radius * 0.82));
    const trimEnd = Math.min(screenLength * 0.35, Math.max(bondLineWidth, endAtom.radius * 0.82));
    const tStart = trimStart / screenLength;
    const tEnd = 1 - trimEnd / screenLength;
    if (tEnd <= tStart) return;

    const segmentCount = Math.max(3, Math.min(16, Math.ceil(screenLength / 16)));
    for (let i = 0; i < segmentCount; i += 1) {
      const t0 = tStart + (tEnd - tStart) * (i / segmentCount);
      const t1 = tStart + (tEnd - tStart) * ((i + 1) / segmentCount);
      const tm = (t0 + t1) * 0.5;
      segments.push({
        type: "bond",
        depth: startAtom.z + dz * tm,
        x0: startAtom.x + dx * t0,
        y0: startAtom.y + dy * t0,
        x1: startAtom.x + dx * t1,
        y1: startAtom.y + dy * t1,
        lineWidth: bondLineWidth,
      });
    }
  });

  return segments;
}

function getBuilderVelocityArrowItems(projected, atoms, bounds, width, height) {
  const maxVelocity = Math.max(
    ...atoms.map((atom) => {
      const vx = Number(atom.vx) || 0;
      const vy = Number(atom.vy) || 0;
      const vz = Number(atom.vz) || 0;
      return Math.sqrt(vx * vx + vy * vy + vz * vz);
    }),
    0
  );

  if (!(maxVelocity > 0)) return [];

  const items = [];
  const color = "rgba(126, 222, 255, 0.9)";
  const lineWidth = 1.2;
  const velocityWorldScale = bounds.radius * 0.34 / maxVelocity;

  projected.forEach((item) => {
    const atom = item.atom;
    const end = projectBuilderPoint(
      [
        (Number(atom.x) || 0) + (Number(atom.vx) || 0) * velocityWorldScale,
        (Number(atom.y) || 0) + (Number(atom.vy) || 0) * velocityWorldScale,
        (Number(atom.z) || 0) + (Number(atom.vz) || 0) * velocityWorldScale,
      ],
      bounds,
      width,
      height
    );

    const dx = end.x - item.x;
    const dy = end.y - item.y;
    const dz = end.z - item.z;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!(length > 5)) return;

    const segmentCount = Math.max(3, Math.min(18, Math.ceil(length / 12)));
    for (let i = 0; i < segmentCount; i += 1) {
      const t0 = i / segmentCount;
      const t1 = (i + 1) / segmentCount;
      const tm = (t0 + t1) * 0.5;
      items.push({
        type: "velocitySegment",
        depth: item.z + dz * tm,
        x0: item.x + dx * t0,
        y0: item.y + dy * t0,
        x1: item.x + dx * t1,
        y1: item.y + dy * t1,
        lineWidth,
        color,
      });
    }

    items.push({
      type: "velocityHead",
      depth: end.z,
      x: end.x,
      y: end.y,
      ux: dx / length,
      uy: dy / length,
      size: Math.min(9, Math.max(5, length * 0.22)),
      color,
    });
  });

  return items;
}

function renderInputBuilderCanvas() {
  inputBuilderRenderRaf = 0;
  if (!inputBuilderCanvas) return;

  const ctx = inputBuilderCanvas.getContext("2d");
  if (!ctx) return;

  const { width, height, dpr } = resizeInputBuilderCanvas(inputBuilderCanvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#090c0f";
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();

  const atoms = _state.hasEditableInput ? _state.atoms : [];
  inputBuilderProjectedAtoms = [];
  if (!atoms.length) {
    ctx.fillStyle = "rgba(255,255,255,0.56)";
    ctx.font = "600 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No atoms", width * 0.5, height * 0.5);
    return;
  }

  const bounds = getBuilderBounds(atoms);
  const projected = atoms.map((atom, index) => {
    const style = getElementStyle(atom.atomicNumber);
    const point = projectBuilderPoint([atom.x, atom.y, atom.z], bounds, width, height);
    const radius = Math.max(6, Math.min(18, 6 + style.radius * 5.2));
    return {
      ...point,
      index,
      atom,
      radius,
      style,
    };
  });
  inputBuilderProjectedAtoms = projected;

  const renderItems = [
    ...getBuilderBondSegments(projected, atoms),
    ...getBuilderVelocityArrowItems(projected, atoms, bounds, width, height),
    ...projected.map((item) => ({
      type: "atom",
      depth: item.z,
      item,
    })),
  ].sort((left, right) => left.depth - right.depth);

  renderItems.forEach((renderItem) => {
    if (renderItem.type === "bond") {
      drawBuilderBondSegment(ctx, renderItem);
    } else if (renderItem.type === "velocitySegment") {
      drawBuilderVelocitySegment(ctx, renderItem);
    } else if (renderItem.type === "velocityHead") {
      drawBuilderVelocityHead(ctx, renderItem);
    } else {
      drawBuilderAtom(ctx, renderItem.item, atoms.length);
    }
  });

}

function scheduleInputBuilderRender() {
  if (inputBuilderRenderRaf) return;
  inputBuilderRenderRaf = window.requestAnimationFrame(renderInputBuilderCanvas);
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
    const hint = String(_state.mdInputHint || DEFAULT_MD_INPUT_HINT || "").trim();
    mdInputHintEl.textContent = hint;
    mdInputHintEl.hidden = !hint;
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
  if (!input) return 100;

  const minStepCount = Number(input.min || 1);
  const maxStepCount = Number(input.max || 100000);
  const fallbackStepCount = Number(input.dataset.defaultValue || 100);
  return clampInt(input.value, minStepCount, maxStepCount, fallbackStepCount);
}

function getValidatedMdTimeStepFs(input) {
  if (!input) return 0.5;

  const minTimeStep = Number(input.min || 0.001);
  const maxTimeStep = Number(input.max || 10);
  const fallbackTimeStep = Number(input.dataset.defaultValue || 0.5);
  return clampFloat(input.value, minTimeStep, maxTimeStep, fallbackTimeStep);
}

function getValidatedSystemCharge(input) {
  if (!input) return DEFAULT_SYSTEM_CHARGE;
  return parseSystemCharge(input.value, DEFAULT_SYSTEM_CHARGE);
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

function scrollInputBuilderToTop() {
  if (!inputAtomTableWrapEl) return;
  inputAtomTableWrapEl.scrollTop = 0;
  inputAtomTableWrapEl.scrollLeft = 0;
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
  const initialMaxRuntimeMinutes = toOptionalPositiveFiniteNumber(_state.initialMaxRuntimeMinutes);
  const initialMdStepCount = toOptionalPositiveFiniteNumber(_state.initialMdStepCount);
  const initialMdTimeStepFs = toOptionalPositiveFiniteNumber(_state.initialMdTimeStepFs);
  const initialSystemCharge = normalizeInitialSystemCharge(_state.initialSystemCharge);
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
    input.value = String(initialMdStepCount ?? (input.dataset.defaultValue || "100"));
  });

  document.querySelectorAll('[data-submit-input="mdTimeStepFs"]').forEach((input) => {
    input.value = String(initialMdTimeStepFs ?? (input.dataset.defaultValue || "0.5"));
  });

  document.querySelectorAll('[data-submit-input="systemCharge"]').forEach((input) => {
    input.value = String(initialSystemCharge);
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
  const systemChargeEl = getActiveInput("systemCharge");
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
    const systemCharge = getValidatedSystemCharge(systemChargeEl);

    if (maxRuntimeEl) maxRuntimeEl.value = String(maxMinutes);
    if (systemChargeEl) systemChargeEl.value = String(systemCharge);

    let moleculeXml = _state.moleculeXml;
    let mdInitialVelocityXml = _state.mdInitialVelocityXml;
    let nAtoms = _state.nAtoms;

    if (_state.hasEditableInput && !_state.isInputBuilderReadOnly) {
      validateBuilderAtoms();
      refreshBuilderXmlFromAtoms();
      renderInputAtomRows();
      moleculeXml = _state.moleculeXml;
      mdInitialVelocityXml = _state.mdInitialVelocityXml;
      nAtoms = _state.nAtoms;
    }

    let mdConfig = null;
    if (_state.selectedMode === "molecular_dynamics") {
      const stepCount = getValidatedMdStepCount(mdStepCountEl);
      const timeStepFs = getValidatedMdTimeStepFs(mdTimeStepFsEl);

      if (mdStepCountEl) mdStepCountEl.value = String(stepCount);
      if (mdTimeStepFsEl) mdTimeStepFsEl.value = String(timeStepFs);

      mdConfig = {
        initial_velocity_xml: mdInitialVelocityXml || "",
        step_count: stepCount,
        time_step_fs: timeStepFs,
        total_time_fs: stepCount * timeStepFs,
        trajectory_file: "md_trajectory.json",
        system_charge: systemCharge,
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
      systemCharge,
      system_charge: systemCharge,
      nAtoms,
      moleculeXml,
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

inputBuilderAddAtomBtn?.addEventListener("click", addBuilderAtom);
inputBuilderResetViewBtn?.addEventListener("click", resetInputBuilderView);

inputAtomRowsEl?.addEventListener("focusin", (e) => {
  const row = e.target.closest("[data-atom-id]");
  if (row) setSelectedBuilderAtom(row.dataset.atomId);
});

inputAtomRowsEl?.addEventListener("click", (e) => {
  const actionTarget = e.target.closest("[data-atom-action]");
  const row = e.target.closest("[data-atom-id]");
  if (!row) return;

  if (actionTarget?.dataset.atomAction === "remove") {
    removeBuilderAtom(row.dataset.atomId);
    return;
  }

  setSelectedBuilderAtom(row.dataset.atomId);
});

inputAtomRowsEl?.addEventListener("input", (e) => {
  if (!e.target.matches("[data-atom-field]")) return;
  readAtomFieldChange(e.target);
});

inputAtomRowsEl?.addEventListener("change", (e) => {
  if (!e.target.matches("[data-atom-field]")) return;
  readAtomFieldChange(e.target);
  if (e.target.type === "number") {
    e.target.value = formatBuilderInputNumber(e.target.value);
  }
});

inputBuilderCanvas?.addEventListener("pointerdown", (e) => {
  inputBuilderPointer.active = true;
  inputBuilderPointer.moved = false;
  inputBuilderPointer.pointerId = e.pointerId;
  inputBuilderPointer.startX = e.clientX;
  inputBuilderPointer.startY = e.clientY;
  inputBuilderPointer.lastX = e.clientX;
  inputBuilderPointer.lastY = e.clientY;
  inputBuilderCanvas.setPointerCapture?.(e.pointerId);
});

inputBuilderCanvas?.addEventListener("pointermove", (e) => {
  if (!inputBuilderPointer.active || e.pointerId !== inputBuilderPointer.pointerId) return;

  const dx = e.clientX - inputBuilderPointer.lastX;
  const dy = e.clientY - inputBuilderPointer.lastY;
  if (Math.abs(e.clientX - inputBuilderPointer.startX) + Math.abs(e.clientY - inputBuilderPointer.startY) > 4) {
    inputBuilderPointer.moved = true;
  }

  inputBuilderPointer.lastX = e.clientX;
  inputBuilderPointer.lastY = e.clientY;
  inputBuilderView.yaw += dx * 0.01;
  inputBuilderView.pitch = clampFloat(inputBuilderView.pitch + dy * 0.01, -1.25, 1.25, inputBuilderView.pitch);
  scheduleInputBuilderRender();
});

inputBuilderCanvas?.addEventListener("pointerup", (e) => {
  if (!inputBuilderPointer.active || e.pointerId !== inputBuilderPointer.pointerId) return;

  inputBuilderPointer.active = false;
  inputBuilderCanvas.releasePointerCapture?.(e.pointerId);

  if (!inputBuilderPointer.moved) {
    const rect = inputBuilderCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const nearest = inputBuilderProjectedAtoms
      .map((item) => ({
        atomId: item.atom.id,
        distance: Math.hypot(item.x - x, item.y - y),
        radius: item.radius,
        depth: item.z,
      }))
      .filter((item) => item.distance <= Math.max(item.radius + 10, 18))
      .sort((a, b) => b.depth - a.depth || a.distance - b.distance)[0];

    if (nearest) setSelectedBuilderAtom(nearest.atomId, { scroll: true });
  }
});

inputBuilderCanvas?.addEventListener("pointercancel", () => {
  inputBuilderPointer.active = false;
});

inputBuilderCanvas?.addEventListener("wheel", (e) => {
  e.preventDefault();
  const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
  inputBuilderView.zoom = clampFloat(inputBuilderView.zoom * zoomFactor, 0.35, 4, 1);
  scheduleInputBuilderRender();
}, { passive: false });

window.addEventListener("resize", scheduleInputBuilderRender);

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
  initialSystemCharge = null,
  initialFocusInput = "",
  disabledInputs = [],
  inputBuilderReadOnly = false,
  startBlank = false,
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
    atoms: [],
    nextAtomId: 1,
    selectedAtomId: "",
    hasEditableInput: false,
    isInputBuilderReadOnly: Boolean(inputBuilderReadOnly),
    hadInitialVelocities: false,
    velocityUnits: DEFAULT_VELOCITY_UNITS,
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
    initialMaxRuntimeMinutes: toOptionalPositiveFiniteNumber(initialMaxRuntimeMinutes),
    initialMdStepCount: toOptionalPositiveFiniteNumber(initialMdStepCount),
    initialMdTimeStepFs: toOptionalPositiveFiniteNumber(initialMdTimeStepFs),
    initialSystemCharge: normalizeInitialSystemCharge(
      initialSystemCharge ?? extractSystemChargeFromXml(moleculeXml)
    ),
    initialFocusInput: initialFocusInput || "",
    disabledInputs: Array.isArray(disabledInputs) ? disabledInputs : [],
    isSubmitting: false,
    healthLoading: false,
    healthError: "",
    hardwareHealth: {},
    activeHealthRequestId: 0,
  };

  if (startBlank) {
    setBlankInputBuilder();
  } else {
    try {
      setInputBuilderFromXml(_state.moleculeXml, _state.mdInitialVelocityXml);
    } catch (err) {
      _state.hasEditableInput = false;
      _state.atoms = [];
      _state.nAtoms = toNonnegativeInt(nAtoms);
      renderInputAtomRows();
      updateInputBuilderChrome();
      scheduleInputBuilderRender();
      console.warn("Input builder could not parse molecule XML:", err);
    }
  }

  setBoundText("fileName", _state.displayFileName || "-");
  setBoundText("atomCount", Number.isFinite(_state.nAtoms) ? String(_state.nAtoms) : "-");

  applyModalChrome();
  resetInputs();
  applyInputDisabledStates();
  renderHardwareCards();
  renderRuntimeEstimates();
  renderMdEstimates();
  showError("");
  renderSelectedMode();
  scrollActivePanelToTop();
  scrollInputBuilderToTop();
  open();
  setTimeout(() => {
    scrollActivePanelToTop();
    scrollInputBuilderToTop();
    scheduleInputBuilderRender();
  }, 0);
  scheduleInputBuilderRender();
  focusActiveInput();
  refreshHardwareHealth();
};
