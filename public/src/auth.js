import { auth } from "/src/firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

const functions = getFunctions();
const ensureUserDoc = httpsCallable(functions, "ensure_user_doc");

let isSignup = false;

// ---- UI helpers ----
function qs(id) { return document.getElementById(id); }

function clearErrors() {
  const banner = qs("formError");
  const bannerText = qs("formErrorText");
  if (banner) banner.classList.add("hidden");
  if (bannerText) bannerText.textContent = "";

  // clear per-field
  const hints = ["emailHint", "passwordHint", "confirmHint"];
  hints.forEach((hid) => {
    const h = qs(hid);
    if (h) { h.textContent = ""; h.classList.add("hidden"); }
  });

  // clear input styling
  ["email", "password", "confirmPassword"].forEach((iid) => {
    const el = qs(iid);
    if (el) el.classList.remove("input-invalid");
  });
}

function showBanner(msg) {
  const banner = qs("formError");
  const bannerText = qs("formErrorText");
  if (!banner || !bannerText) return;
  bannerText.textContent = msg;
  banner.classList.remove("hidden");
}

function markInvalid(inputId, hintId, msg) {
  const input = qs(inputId);
  if (input) input.classList.add("input-invalid");

  const hint = qs(hintId);
  if (hint) {
    hint.textContent = msg;
    hint.classList.remove("hidden");
  }
}

function shakeCard() {
  const card = qs("authCard");
  if (!card) return;
  card.classList.remove("shake"); // restart animation
  void card.offsetWidth;
  card.classList.add("shake");
}

function setBusy(isBusy) {
  const btn = qs("submitBtn");
  if (!btn) return;
  btn.disabled = isBusy;
  btn.dataset.prevText = btn.dataset.prevText || btn.textContent;
  btn.textContent = isBusy ? "Please wait..." : btn.dataset.prevText;
}

// Firebase error -> friendly copy + which fields to mark
function mapAuthError(err) {
  const code = err?.code || "";
  const msg = err?.message || "Authentication failed.";

  // Default
  let banner = "Unable to sign in. Please try again.";
  let field = null;

  switch (code) {
    case "auth/invalid-email":
      banner = "That email address doesn’t look valid.";
      field = { inputId: "email", hintId: "emailHint", hint: "Enter a valid email (example@domain.com)." };
      break;

    case "auth/user-not-found":
      banner = "No account found for that email.";
      field = { inputId: "email", hintId: "emailHint", hint: "Try signing up instead." };
      break;

    case "auth/wrong-password":
      banner = "Incorrect password.";
      field = { inputId: "password", hintId: "passwordHint", hint: "Check your password and try again." };
      break;

    case "auth/invalid-credential":
      banner = "Invalid email or password.";
      field = { inputId: "password", hintId: "passwordHint", hint: "Double-check your credentials." };
      break;

    case "auth/email-already-in-use":
      banner = "That email is already in use.";
      field = { inputId: "email", hintId: "emailHint", hint: "Try logging in instead." };
      break;

    case "auth/weak-password":
      banner = "Password is too weak.";
      field = { inputId: "password", hintId: "passwordHint", hint: "Use at least 6 characters (more is better)." };
      break;

    case "auth/too-many-requests":
      banner = "Too many attempts. Try again in a bit.";
      break;

    case "auth/network-request-failed":
      banner = "Network error. Check your connection and retry.";
      break;

    default:
      banner = msg.includes("Firebase") ? "Authentication failed. Please try again." : (msg || banner);
      break;
  }

  return { banner, field };
}

// ---- mode toggle ----
window.toggleMode = function toggleMode() {
  isSignup = !isSignup;

  const title = qs("formTitle");
  const btn = qs("submitBtn");
  const switchText = qs("switchText");
  const switchBtn = qs("switchBtn");
  const confirmField = qs("confirmPasswordField");
  const confirmInput = qs("confirmPassword");

  const termsRow = qs("termsRow");
  const termsBox = qs("termsCheckbox");

  clearErrors();

  if (isSignup) {
    title.textContent = "Sign Up";
    btn.textContent = "Create Account";
    btn.dataset.prevText = btn.textContent;
    switchText.textContent = "Already have an account?";
    switchBtn.textContent = "Login";

    confirmField.classList.remove("hidden");
    confirmInput.required = true;
    qs("password").setAttribute("autocomplete", "new-password");

    termsRow.classList.remove("hidden");
    termsBox.required = true;
  } else {
    title.textContent = "Login";
    btn.textContent = "Login";
    btn.dataset.prevText = btn.textContent;
    switchText.textContent = "Don't have an account?";
    switchBtn.textContent = "Sign up";

    confirmField.classList.add("hidden");
    confirmInput.required = false;
    qs("password").setAttribute("autocomplete", "current-password");

    termsRow.classList.add("hidden");
    termsBox.required = false;
    termsBox.checked = false;
  }
};

// Clear errors as the user edits
["email", "password", "confirmPassword"].forEach((id) => {
  const el = qs(id);
  if (el) el.addEventListener("input", () => clearErrors());
});

window.handleSubmit = async function handleSubmit(e) {
  e.preventDefault();
  clearErrors();

  const email = qs("email").value.trim();
  const pass = qs("password").value;
  const confirm = qs("confirmPassword").value;

  // Client-side checks first
  if (!email) {
    showBanner("Email is required.");
    markInvalid("email", "emailHint", "Enter your email.");
    shakeCard();
    return;
  }
  if (!pass) {
    showBanner("Password is required.");
    markInvalid("password", "passwordHint", "Enter your password.");
    shakeCard();
    return;
  }
  if (isSignup && pass !== confirm) {
    showBanner("Passwords do not match.");
    markInvalid("confirmPassword", "confirmHint", "Make sure both passwords match.");
    shakeCard();
    return;
  }
  if (isSignup && !qs("termsCheckbox").checked) {
    showBanner("You must agree to the Terms of Use.");
    shakeCard();
    return;
  }

  setBusy(true);

  try {
    if (isSignup) {
      await createUserWithEmailAndPassword(auth, email, pass);
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }

    // Always ensure user doc exists
    await ensureUserDoc({ email });

    // Redirect AFTER successful auth
    window.location.href = "/";

  } catch (err) {
    const mapped = mapAuthError(err);
    showBanner(mapped.banner);
    if (mapped.field) {
      markInvalid(mapped.field.inputId, mapped.field.hintId, mapped.field.hint);
    }
    shakeCard();
  } finally {
    setBusy(false);
  }
};

function showAuthPanel() {
  const authSide = document.querySelector(".auth-side");
  if (!authSide) return;
  authSide.classList.add("auth-visible");
}

function hideAuthPanel() {
  const authSide = document.querySelector(".auth-side");
  if (!authSide) return;
  authSide.classList.remove("auth-visible");
  // keep it display:none due to base CSS
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    hideAuthPanel();
  } else {
    showAuthPanel();
  }
});

