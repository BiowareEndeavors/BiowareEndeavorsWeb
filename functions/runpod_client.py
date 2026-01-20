# functions/runpod_client.py
from __future__ import annotations

from typing import Any, Dict
import requests

from firebase_functions import https_fn
from firebase_admin import firestore

from config import (
    get_request_timeout_s,
    get_runpod_api_key,
    get_runpod_endpoint,
)

def get_user_credits_usd(db: firestore.Client, uid: str) -> float:
    """
    Reads users/{uid} and returns credits in USD.
    Supports either:
      - credits_usd: number (preferred)
      - credits_cents: integer
      - credits: number (fallback)
    Missing/invalid => 0.0
    """
    snap = db.collection("users").document(uid).get()
    if not snap.exists:
        return 0.0

    doc = snap.to_dict() or {}

    if "credits_usd" in doc:
        try:
            return float(doc.get("credits_usd") or 0.0)
        except Exception:
            return 0.0

    if "credits_cents" in doc:
        try:
            return float(int(doc.get("credits_cents") or 0)) / 100.0
        except Exception:
            return 0.0

    # fallback: "credits" as USD
    try:
        return float(doc.get("credits") or 0.0)
    except Exception:
        return 0.0

def _normalize_run_url(endpoint: str) -> str:
    """
    Accepts either:
      - https://api.runpod.ai/v2/<endpointId>           -> append /run
      - https://api.runpod.ai/v2/<endpointId>/run       -> keep
      - https://api.runpod.ai/v2/<endpointId>/runsync   -> keep
    """
    e = (endpoint or "").rstrip("/")
    if not e:
        return ""
    if e.endswith("/run") or e.endswith("/runsync"):
        return e
    return f"{e}/run"


def _normalize_status_url(endpoint: str, job_id: str) -> str:
    """
    Status endpoint shape is:
      https://api.runpod.ai/v2/<endpointId>/status/<jobId>
    If RUNPOD_ENDPOINT includes /run, strip it first.
    """
    e = (endpoint or "").rstrip("/")
    if e.endswith("/run") or e.endswith("/runsync"):
        e = e.rsplit("/", 1)[0]
    return f"{e}/status/{job_id}"

def create_job_doc(uid: str, upstream: Dict[str, Any], filename: str, nickname: str, n_atoms: int) -> str:
    db = firestore.client()
    runpod_id = upstream.get("id")

    doc_ref = db.collection("jobs").document(runpod_id)
    doc_ref.set(
        {
            "uid": uid,
            "runpodId": runpod_id,
            "filename": filename,
            "nickname": nickname,
            "nAtoms": n_atoms,
            "status": "IN_QUEUE",
            "statusPriority": 0,
            "needsAttention": 1,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    return doc_ref.id

def submit_job(molecule_xml: str, uid: str) -> Dict[str, Any]:
    """
    Submits a RunPod serverless job. Returns RunPod response JSON.
    """
    endpoint = get_runpod_endpoint()
    api_key = get_runpod_api_key()
    if not endpoint or not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Server not configured: RUNPOD_ENDPOINT / RUNPOD_API_KEY missing.",
        )

    run_url = _normalize_run_url(endpoint)
    timeout_s = get_request_timeout_s()

    # RunPod expects the API key directly (no Bearer prefix).
    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }
    payload = {"input": {"molecule_xml": molecule_xml, "uid": uid}}

    try:
        r = requests.post(run_url, json=payload, headers=headers, timeout=timeout_s)
    except requests.RequestException as e:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message=f"Upstream request failed: {str(e)}",
        )

    if not (200 <= r.status_code < 300):
        body_snip = (r.text or "")[:500]
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"Upstream error {r.status_code}: {body_snip}",
        )

    try:
        return r.json()
    except ValueError:
        return {"raw": (r.text or "")[:2000]}


def get_status(job_id: str) -> Dict[str, Any]:
    """
    Fetches job status from RunPod by job id. Returns RunPod response JSON.
    """
    endpoint = get_runpod_endpoint()
    api_key = get_runpod_api_key()
    if not endpoint or not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Server not configured: RUNPOD_ENDPOINT / RUNPOD_API_KEY missing.",
        )

    if not job_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="job_id is required.",
        )

    status_url = _normalize_status_url(endpoint, job_id)
    timeout_s = get_request_timeout_s()

    headers = {
        "Authorization": api_key,
    }

    try:
        r = requests.get(status_url, headers=headers, timeout=timeout_s)
    except requests.RequestException as e:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message=f"Upstream request failed: {str(e)}",
        )

    if not (200 <= r.status_code < 300):
        body_snip = (r.text or "")[:500]
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"Upstream error {r.status_code}: {body_snip}",
        )

    try:
        return r.json()
    except ValueError:
        return {"raw": (r.text or "")[:2000]}
