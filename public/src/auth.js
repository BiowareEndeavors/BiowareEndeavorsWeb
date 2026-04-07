// /src/auth.js  (updated: Option A "no login until verified")
import { auth } from "/src/firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signOut,
  sendPasswordResetEmail
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

  // clear verify panel
  const vp = qs("verifyPanel");
  if (vp) vp.classList.add("hidden");
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

  const resend = qs("resendVerifyBtn");
  if (resend) resend.disabled = isBusy;

  const forgot = qs("forgotBtn");
  if (forgot) forgot.disabled = isBusy;
}

// Firebase error -> friendly copy + which fields to mark
function mapAuthError(err) {
  const code = err?.code || "";
  const msg = err?.message || "Authentication failed.";

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

// ---- forgot password ----
function mapResetError(err) {
  const code = err?.code || "";
  switch (code) {
    case "auth/invalid-email":
      return { banner: "That email address doesn’t look valid.", field: { inputId: "email", hintId: "emailHint", hint: "Enter a valid email." } };
    case "auth/user-not-found":
      // For security, don’t confirm whether the account exists.
      return { banner: "If an account exists for that email, you’ll receive a password reset link shortly.", field: null };
    case "auth/too-many-requests":
      return { banner: "Too many requests. Try again in a bit.", field: null };
    case "auth/network-request-failed":
      return { banner: "Network error. Check your connection and retry.", field: null };
    default:
      return { banner: "Could not send reset email. Please try again.", field: null };
  }
}

window.forgotPassword = async function forgotPassword() {
  if (isSignup) return; // should be hidden in signup mode anyway

  clearErrors();
  const email = (qs("email")?.value || "").trim();
  if (!email) {
    showBanner("Enter your email to reset your password.");
    markInvalid("email", "emailHint", "Email is required to send a reset link.");
    shakeCard();
    return;
  }

  setBusy(true);
  try {
    await sendPasswordResetEmail(auth, email);
    showBanner("If an account exists for that email, you’ll receive a password reset link shortly.");
  } catch (err) {
    const mapped = mapResetError(err);
    showBanner(mapped.banner);
    if (mapped.field) markInvalid(mapped.field.inputId, mapped.field.hintId, mapped.field.hint);
    shakeCard();
  } finally {
    setBusy(false);
  }
};

// ---- verification gate ----
function showVerifyPanel(email) {
  const vp = qs("verifyPanel");
  if (!vp) return;
  const ve = qs("verifyEmail");
  if (ve) ve.textContent = email || "";
  vp.classList.remove("hidden");
}

async function enforceVerifiedOrSignOut(user, emailForUI) {
  if (!user) return false;

  // If unverified, show instructions and sign them out (Option A).
  if (!user.emailVerified) {
    showBanner("Please verify your email before logging in. We just sent a verification email.");
    showVerifyPanel(emailForUI || user.email || "");
    try { await signOut(auth); } catch (_) {}
    return false;
  }
  return true;
}

window.resendVerification = async function resendVerification() {
  clearErrors();
  const email = (qs("email")?.value || "").trim();

  setBusy(true);
  try {
    // User must be signed in to resend via client SDK; we sign them out when unverified.
    // So we do a quick sign-in using the provided email/password, resend, then sign out again.
    const pass = qs("password")?.value || "";
    if (!email || !pass) {
      showBanner("Enter your email and password, then click resend.");
      shakeCard();
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await sendEmailVerification(cred.user);
    showBanner("Verification email sent. Check your inbox (and spam).");
    showVerifyPanel(email);
    try { await signOut(auth); } catch (_) {}
  } catch (err) {
    const mapped = mapAuthError(err);
    showBanner(mapped.banner);
    if (mapped.field) markInvalid(mapped.field.inputId, mapped.field.hintId, mapped.field.hint);
    shakeCard();
  } finally {
    setBusy(false);
  }
};

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

  const forgotRow = qs("forgotRow");

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

    if (forgotRow) forgotRow.classList.add("hidden");
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

    if (forgotRow) forgotRow.classList.remove("hidden");
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
    let cred;

    if (isSignup) {
      cred = await createUserWithEmailAndPassword(auth, email, pass);

      // Ensure doc exists (fine even before verification)
      await ensureUserDoc({ email });

      // Send verification email
      await sendEmailVerification(cred.user);

      // Enforce Option A: sign out + show verify instructions
      showBanner("Account created. Please verify your email before logging in.");
      showVerifyPanel(email);
      try { await signOut(auth); } catch (_) {}
      return;
    } else {
      cred = await signInWithEmailAndPassword(auth, email, pass);

      // Block unverified users (Option A)
      const ok = await enforceVerifiedOrSignOut(cred.user, email);
      if (!ok) return;

      // Ensure doc exists for verified users
      await ensureUserDoc({ email });

      window.location.href = "/";
      return;
    }
  } catch (err) {
    const mapped = mapAuthError(err);
    showBanner(mapped.banner);
    if (mapped.field) markInvalid(mapped.field.inputId, mapped.field.hintId, mapped.field.hint);
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
}

onAuthStateChanged(auth, async (user) => {
  // If verified and logged in, hide auth panel.
  if (user && user.emailVerified) {
    hideAuthPanel();
    return;
  }

  // If logged in but unverified (e.g., another tab signed in), force sign-out and show verify gate.
  if (user && !user.emailVerified) {
    showBanner("Please verify your email before logging in.");
    showVerifyPanel(user.email || "");
    try { await signOut(auth); } catch (_) {}
    showAuthPanel();
    return;
  }

  showAuthPanel();
});
