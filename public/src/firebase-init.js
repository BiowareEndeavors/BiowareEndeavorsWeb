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
const LOCAL_FUNCTIONS_REGIONS = new Set();

function isLocalFunctionsEmulatorHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname || "";
  return host === "127.0.0.1" || host === "localhost";
}

export function getInsightFunctions(region = "us-central1") {
  const functions = getFunctions(app, region);

  if (!isLocalFunctionsEmulatorHost()) {
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
