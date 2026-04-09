# functions/main.py
from __future__ import annotations
import requests

from typing import Any, List, Dict, Optional

from firebase_admin import firestore, initialize_app
from firebase_functions import https_fn

from auth_helpers import require_auth
from xml_validation import validate_molecule_xml
from runpod_client import (
    LEGACY_HARDWARE_TIER,
    create_job_doc,
    get_runpod_endpoint_for_tier,
    get_runpod_job_type_for_mode,
    get_user_credits_usd,
    submit_job,
)
from firebase_admin import firestore
from firebase_functions import firestore_fn, https_fn
import logging
from firebase_functions import https_fn

from config import (
    get_request_timeout_s,
    get_runpod_api_key,
)
initialize_app()
logging.basicConfig(level=logging.INFO)

SUPPORTED_JOB_MODES = {"point_solve", "geometry_optimization"}
SUPPORTED_HARDWARE_TIERS = {"budget", "performance"}
DEFAULT_MAX_RUNTIME_SEC = 30 * 60
MIN_MAX_RUNTIME_SEC = 60
MAX_MAX_RUNTIME_SEC = 3 * 60 * 60


def normalize_job_mode(raw_mode: Any) -> str:
    mode = str(raw_mode or "point_solve").strip().lower()
    if mode not in SUPPORTED_JOB_MODES:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=f"Unsupported job mode: {mode}",
        )
    return mode


def normalize_hardware_tier(raw_tier: Any) -> str:
    tier = str(raw_tier or "budget").strip().lower()
    if tier not in SUPPORTED_HARDWARE_TIERS:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=f"Unsupported hardware tier: {tier}",
        )
    return tier


def normalize_max_runtime_sec(raw_value: Any) -> int:
    if raw_value in (None, ""):
        return DEFAULT_MAX_RUNTIME_SEC

    try:
        value = int(raw_value)
    except (TypeError, ValueError):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="max_runtime_sec must be an integer number of seconds.",
        )

    if value < MIN_MAX_RUNTIME_SEC or value > MAX_MAX_RUNTIME_SEC:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=(
                f"max_runtime_sec must be between {MIN_MAX_RUNTIME_SEC} "
                f"and {MAX_MAX_RUNTIME_SEC} seconds."
            ),
        )

    return value

@https_fn.on_call(
    enforce_app_check=False,
    secrets=["RUNPOD_API_KEY"],
)
def submit_molecule(req: https_fn.CallableRequest) -> Any:
    auth_info = require_auth(req)
    uid = auth_info["uid"]

    db = firestore.client()

    # --- NEW: credit gate ---
    credits_usd = get_user_credits_usd(db, uid)
    if credits_usd < 1.0:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Insufficient credits. You need more than $1 in credits to submit a job.",
        )

    data = req.data or {}

    molecule_xml = data.get("molecule_xml", "")
    nickname = data.get("nickname", "")
    filename = data.get("fileName")
    mode = normalize_job_mode(data.get("mode"))
    job_type = get_runpod_job_type_for_mode(mode)
    hardware_tier = normalize_hardware_tier(data.get("hardware_tier"))
    max_runtime_sec = normalize_max_runtime_sec(data.get("max_runtime_sec"))
    runpod_endpoint = get_runpod_endpoint_for_tier(hardware_tier, fallback="budget")
    logging.info(
        "submit_molecule routing: mode=%s job_type=%s hardware_tier=%s max_runtime_sec=%s endpoint=%s",
        mode,
        job_type,
        hardware_tier,
        max_runtime_sec,
        runpod_endpoint,
    )

    n_atoms = validate_molecule_xml(molecule_xml)

    upstream = submit_job(
        molecule_xml=molecule_xml,
        uid=uid,
        mode=mode,
        hardware_tier=hardware_tier,
        max_runtime_sec=max_runtime_sec,
        runpod_endpoint=runpod_endpoint,
    )
    job_doc_id = create_job_doc(
        uid=uid,
        upstream=upstream,
        filename=filename,
        nickname=nickname,
        n_atoms=n_atoms,
        mode=mode,
        hardware_tier=hardware_tier,
        max_runtime_sec=max_runtime_sec,
        runpod_endpoint=runpod_endpoint,
    )

    return {
        "ok": True,
        "uid": uid,
        "nickname": nickname,
        "n_atoms": n_atoms,
        "mode": mode,
        "job_type": job_type,
        "hardware_tier": hardware_tier,
        "max_runtime_sec": max_runtime_sec,
        "runpod_endpoint": runpod_endpoint,
        "jobId": job_doc_id,
        "filename": filename,
    }

@https_fn.on_call(
    enforce_app_check=False,
    secrets=["RUNPOD_API_KEY"],
)
def cancel_job(req: https_fn.CallableRequest) -> Any:
    auth_info = require_auth(req)
    uid = auth_info["uid"]

    data = req.data or {}
    job_id = (data.get("jobId") or "").strip()
    if not job_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="jobId is required.",
        )

    db = firestore.client()
    job_ref = db.collection("jobs").document(job_id)
    snap = job_ref.get()
    if not snap.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message="Job not found.",
        )

    job = snap.to_dict() or {}
    if job.get("uid") != uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message="Not allowed.",
        )

    status = str(job.get("status") or "").upper()
    if status not in ("IN_QUEUE", "IN_PROGRESS"):
        # idempotent-ish: don't call RunPod if already terminal
        return {"ok": True, "jobId": job_id, "skipped": True, "status": status}

    runpod_id = (job.get("runpodId") or job.get("runpodId") or job_id).strip()
    hardware_tier = str(job.get("hardwareTier") or LEGACY_HARDWARE_TIER).strip().lower()

    api_key = get_runpod_api_key()
    if not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Server not configured: RUNPOD_API_KEY missing.",
        )

    endpoint = str(job.get("runpodEndpoint") or "").strip() or get_runpod_endpoint_for_tier(
        hardware_tier,
        fallback=LEGACY_HARDWARE_TIER,
    )
    url = f"{endpoint.rstrip('/')}/cancel/{runpod_id}"
    headers = {"Authorization": api_key}

    try:
        r = requests.post(url, headers=headers, timeout=get_request_timeout_s())
    except requests.RequestException as e:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message=f"RunPod cancel request failed: {str(e)}",
        )

    if not (200 <= r.status_code < 300):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"RunPod cancel error {r.status_code}: {(r.text or '')[:500]}",
        )

    cancel_payload: Dict[str, Any]
    try:
        cancel_payload = r.json()
    except Exception:
        cancel_payload = {"raw": (r.text or "")[:2000]}

    # Update job doc immediately (your status poller/webhook can reconcile later)
    job_ref.set(
        {
            "status": "CANCELLED",
            "statusPriority": 99,
            "needsAttention": 0,
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "cancel": {
                "at": firestore.SERVER_TIMESTAMP,
                "byUid": uid,
                "runpod": cancel_payload,
            },
        },
        merge=True,
    )

    return {"ok": True, "jobId": job_id, "runpod": cancel_payload}

@https_fn.on_call(enforce_app_check=False)
def ensure_user_doc(req: https_fn.CallableRequest) -> Any:
    auth_info = require_auth(req)
    uid = auth_info["uid"]

    data = req.data or {}
    email = (data.get("email") or "").strip()

    db = firestore.client()
    user_ref = db.collection("users").document(uid)

    @firestore.transactional
    def _tx_create_if_missing(tx: firestore.Transaction):
        snap = user_ref.get(transaction=tx)
        now = firestore.SERVER_TIMESTAMP

        if snap.exists:
            tx.set(
                user_ref,
                {
                    **({"email": email} if email else {}),
                },
                merge=True,
            )
            return False

        tx.set(
            user_ref,
            {
                "uid": uid,
                "email": email,
                "createdAt": now,
                "credits": 5,
            },
            merge=False,
        )
        return True

    created = _tx_create_if_missing(db.transaction())
    return {"ok": True, "uid": uid, "created": created}

@firestore_fn.on_document_created(document="customers/{uid}/payments/{paymentId}")
def handle_new_payment(event: firestore_fn.Event[firestore_fn.DocumentSnapshot | None]):
    def _get_amount_cents(payment_data: dict) -> Optional[int]:
        # Stripe extension may store amount in different fields depending on configuration/version.
        # Prefer amount (cents) if present; fallback candidates included.
        for key in ("amount", "amount_total", "amountSubtotal", "amount_subtotal"):
            v = payment_data.get(key)
            if isinstance(v, int):
                return v
        return None
    
    if event.data is None:
        logging.warning("No data found for payment event: %s", getattr(event, "id", "unknown"))
        return

    uid = event.params.get("uid")
    payment_id = event.params.get("paymentId")

    if not uid or not payment_id:
        logging.error("Missing uid/paymentId in event.params. params=%s", getattr(event, "params", None))
        return

    db = firestore.client()

    payment_snap = event.data
    payment_data = payment_snap.to_dict() or {}

    logging.info("New payment document created: %s for user %s", payment_id, uid)

    # Idempotency: if we ever see duplicates/retries, skip if already processed.
    # (A create trigger should run once, but retries and extension behaviors can still lead to double processing.)
    if payment_data.get("processed") is True:
        logging.info("Payment %s already marked processed; skipping.", payment_id)
        return

    payment_status = payment_data.get("status")
    if payment_status != "succeeded":
        logging.info("Payment %s status=%s; skipping credit.", payment_id, payment_status)
        return

    amount_cents = _get_amount_cents(payment_data)
    if amount_cents is None or amount_cents <= 0:
        logging.error("Missing/invalid amount cents for payment %s. data=%s", payment_id, payment_data)
        return

    # Store credits as integer cents to avoid float drift.
    user_ref = db.collection("users").document(uid)
    payment_ref = payment_snap.reference  # customers/{uid}/payments/{paymentId}

    @firestore.transactional
    def apply_credit(txn: firestore.Transaction):
        pay_doc = payment_ref.get(transaction=txn)
        pay = pay_doc.to_dict() or {}

        # Re-check inside transaction for idempotency
        if pay.get("processed") is True:
            return

        # Apply credit
        txn.set(
            user_ref,
            {
                "credits": firestore.Increment(amount_cents / 100.0),
                "creditsUpdatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        # Mark payment processed
        txn.set(
            payment_ref,
            {
                "processed": True,
                "processedAt": firestore.SERVER_TIMESTAMP,
                "appliedAmountCents": amount_cents,
            },
            merge=True,
        )

    try:
        txn = db.transaction()
        apply_credit(txn)
        logging.info("Payment %s applied: +%s cents to user %s", payment_id, amount_cents, uid)
    except Exception as e:
        logging.exception("Error processing payment %s for user %s: %s", payment_id, uid, e)
