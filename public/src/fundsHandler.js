import { app, auth, db } from "/src/firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js";
import { collection, addDoc, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-functions.js";

let unsubscribeFunds = null;

const FUNCTIONS_REGION = "us-central1";
const functions = getFunctions(app, FUNCTIONS_REGION);

// You will implement this callable in your Cloud Functions:
// returns { url: "https://checkout.stripe.com/..." }
const createCheckoutSession = httpsCallable(functions, "create_checkout_session");

const overlay = document.getElementById("fundsOverlay");
const btnCancel = document.getElementById("fundsCancelBtn");
const btnCheckout = document.getElementById("fundsCheckoutBtn");
const inputAmt = document.getElementById("fundsAmountInput");
const elErr = document.getElementById("fundsError");

let _authUser = null;
let _open = false;
let _selected = null; // number dollars

function setError(msg) {
  if (!elErr) return;
  elErr.textContent = msg || "";
  elErr.style.display = msg ? "block" : "none";
}

function setOpen(open) {
  _open = open;
  if (!overlay) return;

  if (open) {
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    setError("");
    // default selection
    if (!_selected) selectPreset(25);
  } else {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    setError("");
  }
}

function clearPresetSelection() {
  document.querySelectorAll(".funds-preset.is-selected").forEach((b) => b.classList.remove("is-selected"));
}

function selectPreset(amount) {
  _selected = Number(amount);
  clearPresetSelection();
  document.querySelectorAll(".funds-preset").forEach((b) => {
    if (Number(b.getAttribute("data-amt")) === _selected) b.classList.add("is-selected");
  });
  if (inputAmt) inputAmt.value = _selected.toFixed(2);
}

async function startCheckout() {
    setError("");
    const _authUser = auth.currentUser; // Get the current authenticated user
    if (!_authUser) {
        setError("You must be signed in.");
        return;
    }

    const amount = _selected;
    if (amount == null || amount < 1) {
        setError("Enter an amount of at least $1.00.");
        return;
    }

    btnCheckout.disabled = true;
    btnCheckout.textContent = "Creating checkout…";

    try {
        // 1. Define the path to the checkout_sessions collection
        // IMPORTANT: Confirm this path with your extension configuration.
        // Based on your Firestore rules, 'customers/{uid}/checkout_sessions' is highly likely.
        const checkoutSessionCollectionRef = collection(db, `customers/${_authUser.uid}/checkout_sessions`);

        // 2. Create a new document in Firestore to initiate the Stripe Checkout Session
        // This is what the Firebase Stripe Payments Extension listens for.
        const checkoutSessionDocRef = await addDoc(checkoutSessionCollectionRef, {
            mode: 'payment', // Set mode to 'payment' for one-time payments
            // Define the item being purchased using line_items for dynamic pricing
            line_items: [{
                price_data: {
                    currency: 'usd', // Match your desired currency
                    product_data: {
                        name: 'Add Funds to Account', // This name will appear on the Stripe Checkout page
                        // You could add images, descriptions, etc. here if desired
                    },
                    unit_amount: amount * 100, // Amount in cents (or your currency's smallest unit)
                },
                quantity: 1, // Always 1 for adding funds
            }],
            // URLs Stripe redirects to after payment or cancellation
            success_url: window.location.origin + '/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
            cancel_url: window.location.origin + '/?checkout=cancel',
            // You can add more metadata here if needed, e.g., 'firebaseUID': _authUser.uid
        });

        // 3. Listen for updates to this document
        // The extension will populate this document with the Stripe Checkout URL.
        const unsubscribe = onSnapshot(checkoutSessionDocRef, (snapshot) => {
            const data = snapshot.data();
            if (data && data.url) {
                // If the URL is present, redirect the user
                unsubscribe(); // Stop listening once we have the URL
                console.log("Redirecting to Stripe Checkout URL:", data.url);
                window.location.href = data.url;
            }
            if (data && data.error) {
                // Handle any errors returned by the extension during session creation
                unsubscribe();
                setError(data.error.message || "An error occurred during checkout setup.");
                btnCheckout.disabled = false;
                btnCheckout.textContent = "Continue to Checkout";
            }
        });

    } catch (err) {
        setError(err?.message || String(err));
        btnCheckout.disabled = false;
        btnCheckout.textContent = "Continue to Checkout";
    }
}

// Global opener for your onclick
window.openAddFundsModal = function openAddFundsModal() {
  setOpen(true);
};

function wirePresets() {
  document.querySelectorAll(".funds-preset").forEach((b) => {
    b.addEventListener("click", () => {
      const amt = Number(b.getAttribute("data-amt"));
      if (!Number.isFinite(amt)) return;
      selectPreset(amt);
      setError("");
    });
  });
}

if (btnCancel) btnCancel.addEventListener("click", () => setOpen(false));
if (overlay) {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) setOpen(false);
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _open) setOpen(false);
});

if (btnCheckout) btnCheckout.addEventListener("click", startCheckout);

wirePresets();

onAuthStateChanged(auth, (user) => {
  _authUser = user;
});

function setFundsText(text) {
  const el = document.getElementById("fundsAmount");
  if (el) el.textContent = text;
}

function attachFundsListener(uid) {
  // clean up if re-auth happens
  if (unsubscribeFunds) unsubscribeFunds();

  const ref = doc(db, "users", uid);
  unsubscribeFunds = onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        setFundsText("$0.00");
        return;
      }
      const data = snap.data() || {};
      const credits = data.credits ?? 0;
      setFundsText(credits.toLocaleString(undefined, { style: "currency", currency: "USD" }));
    },
    (err) => {
      console.error("funds listener error:", err);
      // keep UI stable
    }
  );
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (unsubscribeFunds) unsubscribeFunds();
    unsubscribeFunds = null;
    setFundsText("$0.00");
    return;
  }
  attachFundsListener(user.uid);
});

// Return
function openPaymentModal() {
  const overlay = document.getElementById("paymentModal_overlay");
  if (!overlay) return;
  overlay.classList.add("paymentModal_open");
}

function closePaymentModal() {
  const overlay = document.getElementById("paymentModal_overlay");
  if (!overlay) return;
  overlay.classList.remove("paymentModal_open");
}

function showToast(message) {
  console.log(message);
}

function handleCheckoutReturn() {
  const url = new URL(window.location.href);
  const checkout = url.searchParams.get("checkout");
  const sessionId = url.searchParams.get("session_id");

  if (checkout === "success") {
    openPaymentModal();

    // Clean URL so refresh doesn't reopen modal
    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    window.history.replaceState({}, "", url.pathname);
    return;
  }

  if (checkout === "cancel") {
    showToast("Checkout cancelled.");

    url.searchParams.delete("checkout");
    window.history.replaceState({}, "", url.pathname);
    return;
  }
}

// Bind close button
document.getElementById("paymentModal_close")
  ?.addEventListener("click", closePaymentModal);

// Run on page load
handleCheckoutReturn();