import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";

import { getAuth } from
  "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import {
  connectFunctionsEmulator,
  getFunctions,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

import {
  getFirestore,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

import {
  getStorage,
  connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA3xNVmleR1aaF5gLKRn0H-G18DE7pQPMk",
  authDomain: "insight-93569.firebaseapp.com",
  projectId: "insight-93569",
  storageBucket: "insight-93569.firebasestorage.app",
  messagingSenderId: "464094393650",
  appId: "1:464094393650:web:84004f8b65df746ef5532b",
  measurementId: "G-3HDXPE3JLX"
};

// Init
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const LOCAL_FUNCTIONS_HOST = "127.0.0.1";
const LOCAL_FUNCTIONS_PORT = 5001;
const LOCAL_STORAGE_HOST = "127.0.0.1";
const LOCAL_STORAGE_PORT = 9199;
const LOCAL_FUNCTIONS_REGIONS = new Set();
const FUNCTIONS_EMULATOR_FLAG = "insight.useFunctionsEmulator";
let didConnectStorageEmulator = false;

function isLocalFunctionsEmulatorHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname || "";
  return host === "127.0.0.1" || host === "localhost";
}

function shouldUseFunctionsEmulator() {
  if (!isLocalFunctionsEmulatorHost()) return false;
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search || "");
  const queryValue = String(params.get("functions_emulator") || "").trim().toLowerCase();
  if (queryValue === "1" || queryValue === "true" || queryValue === "yes") {
    return true;
  }
  if (queryValue === "0" || queryValue === "false" || queryValue === "no") {
    return false;
  }

  try {
    const stored = String(window.localStorage.getItem(FUNCTIONS_EMULATOR_FLAG) || "").trim().toLowerCase();
    if (stored === "1" || stored === "true" || stored === "yes") return true;
    if (stored === "0" || stored === "false" || stored === "no") return false;
  } catch (_) {
    // Localhost should still prefer the emulator if storage is unavailable.
  }

  return true;
}

function connectLocalStorageEmulatorIfNeeded() {
  if (!shouldUseFunctionsEmulator() || didConnectStorageEmulator) return;

  connectStorageEmulator(storage, LOCAL_STORAGE_HOST, LOCAL_STORAGE_PORT);
  didConnectStorageEmulator = true;
  console.info(
    `[firebase] Using local Storage emulator at ${LOCAL_STORAGE_HOST}:${LOCAL_STORAGE_PORT}`
  );
}

connectLocalStorageEmulatorIfNeeded();

export function getInsightFunctions(region = "us-central1") {
  const functions = getFunctions(app, region);

  if (!shouldUseFunctionsEmulator()) {
    return functions;
  }

  const regionKey = String(region || "us-central1");
  if (!LOCAL_FUNCTIONS_REGIONS.has(regionKey)) {
    connectFunctionsEmulator(functions, LOCAL_FUNCTIONS_HOST, LOCAL_FUNCTIONS_PORT);
    LOCAL_FUNCTIONS_REGIONS.add(regionKey);
    console.info(
      `[firebase] Using local Functions emulator at ${LOCAL_FUNCTIONS_HOST}:${LOCAL_FUNCTIONS_PORT} (${regionKey})`
    );
  }

  return functions;
}
