# functions/runpod_client.py
from __future__ import annotations

from typing import Any, Dict
import requests

from firebase_functions import https_fn
from firebase_admin import firestore, storage

from config import (
    get_request_timeout_s,
    get_runpod_api_key,
    get_storage_bucket_name,
)

RUNPOD_ENDPOINTS = {
    "budget": "https://api.runpod.ai/v2/997hkd7d6wr8zs",
    "performance": "https://api.runpod.ai/v2/18yokgwihr9lxm",
}
LEGACY_HARDWARE_TIER = "performance"
RUNPOD_JOB_TYPES = {
    "point_solve": "single_point",
    "geometry_optimization": "geometry_optimization",
    "molecular_dynamics": "molecular_dynamics",
}
INPUT_XML_STORAGE_PREFIX = "jobInputs"

def build_input_xml_storage_path(job_id: str) -> str:
    normalized_job_id = str(job_id or "").strip()
    if not normalized_job_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="job_id is required to build the input XML storage path.",
        )
    return f"{INPUT_XML_STORAGE_PREFIX}/{normalized_job_id}/input.xml"

def upload_job_input_xml(job_id: str, molecule_xml: str) -> Dict[str, Any]:
    normalized_xml = str(molecule_xml or "")
    if not normalized_xml:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="molecule_xml is required to upload input XML.",
        )

    bucket_name = get_storage_bucket_name()
    bucket = storage.bucket(bucket_name) if bucket_name else storage.bucket()
    blob_path = build_input_xml_storage_path(job_id)
    blob = bucket.blob(blob_path)
    blob.cache_control = "private, max-age=0, no-transform"
    blob.upload_from_string(normalized_xml, content_type="application/xml; charset=utf-8")
    blob.reload()

    if not blob.exists():
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=(
                "Input XML upload completed without a readable object at "
                f"gs://{bucket.name}/{blob_path}."
            ),
        )

    return {
        "bucket": bucket.name,
        "path": blob_path,
        "bytes": int(blob.size or len(normalized_xml.encode("utf-8"))),
        "contentType": blob.content_type or "application/xml; charset=utf-8",
        **({"generation": str(blob.generation)} if blob.generation is not None else {}),
    }

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
    If the configured endpoint includes /run, strip it first.
    """
    e = (endpoint or "").rstrip("/")
    if e.endswith("/run") or e.endswith("/runsync"):
        e = e.rsplit("/", 1)[0]
    return f"{e}/status/{job_id}"


def _normalize_health_url(endpoint: str) -> str:
    """
    Health endpoint shape is:
      https://api.runpod.ai/v2/<endpointId>/health
    If the configured endpoint includes /run, strip it first.
    """
    e = (endpoint or "").rstrip("/")
    if e.endswith("/run") or e.endswith("/runsync"):
        e = e.rsplit("/", 1)[0]
    return f"{e}/health"


def get_runpod_endpoint_for_tier(hardware_tier: str, *, fallback: str = LEGACY_HARDWARE_TIER) -> str:
    tier = str(hardware_tier or "").strip().lower() or fallback
    endpoint = RUNPOD_ENDPOINTS.get(tier)
    if endpoint:
        return endpoint

    fallback_endpoint = RUNPOD_ENDPOINTS.get(fallback)
    if fallback_endpoint:
        return fallback_endpoint

    raise https_fn.HttpsError(
        code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
        message=f"Unsupported RunPod hardware tier: {tier}",
    )


def get_runpod_health_for_tier(hardware_tier: str) -> Dict[str, Any]:
    """
    Fetches serverless endpoint health for the given hardware tier.
    """
    endpoint = get_runpod_endpoint_for_tier(hardware_tier, fallback="budget")
    api_key = get_runpod_api_key()
    if not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Server not configured: RUNPOD_API_KEY missing.",
        )

    health_url = _normalize_health_url(endpoint)
    timeout_s = get_request_timeout_s()
    headers = {"Authorization": api_key}

    try:
        r = requests.get(health_url, headers=headers, timeout=timeout_s)
    except requests.RequestException as e:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAVAILABLE,
            message=f"RunPod health request failed: {str(e)}",
        )

    if not (200 <= r.status_code < 300):
        body_snip = (r.text or "")[:500]
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message=f"RunPod health error {r.status_code}: {body_snip}",
        )

    try:
        return r.json()
    except ValueError:
        return {"raw": (r.text or "")[:2000]}


def get_runpod_job_type_for_mode(mode: str) -> str:
    normalized_mode = str(mode or "").strip().lower()
    job_type = RUNPOD_JOB_TYPES.get(normalized_mode)
    if job_type:
        return job_type

    raise https_fn.HttpsError(
        code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
        message=f"Unsupported RunPod job mode: {normalized_mode}",
    )

def create_job_doc(
    uid: str,
    upstream: Dict[str, Any],
    filename: str,
    nickname: str,
    n_atoms: int,
    mode: str,
    hardware_tier: str,
    max_runtime_sec: int,
    runpod_endpoint: str,
    system_charge: int = 0,
    input_xml_ref: Dict[str, Any] | None = None,
    input_xml_upload_error: str = "",
    md_config: Dict[str, Any] | None = None,
    md_continuation: Dict[str, Any] | None = None,
) -> str:
    db = firestore.client()
    runpod_id = upstream.get("id")
    job_type = get_runpod_job_type_for_mode(mode)

    doc_ref = db.collection("jobs").document(runpod_id)
    doc_ref.set(
        {
            "uid": uid,
            "runpodId": runpod_id,
            "filename": filename,
            "nickname": nickname,
            "nAtoms": n_atoms,
            "mode": mode,
            "jobType": job_type,
            "hardwareTier": hardware_tier,
            "maxRuntimeSec": max_runtime_sec,
            "systemCharge": int(system_charge),
            "runpodEndpoint": runpod_endpoint,
            **({"inputXmlRef": input_xml_ref} if input_xml_ref else {}),
            **({"inputXmlUploadError": input_xml_upload_error} if input_xml_upload_error else {}),
            **({"mdConfig": md_config} if md_config else {}),
            **({"mdContinuation": md_continuation} if md_continuation else {}),
            "status": "IN_QUEUE",
            "statusPriority": 0,
            "needsAttention": 1,
            "createdAt": firestore.SERVER_TIMESTAMP,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    return doc_ref.id

def submit_job(
    molecule_xml: str,
    uid: str,
    mode: str,
    hardware_tier: str,
    max_runtime_sec: int,
    system_charge: int = 0,
    runpod_endpoint: str | None = None,
    md_config: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """
    Submits a RunPod serverless job. Returns RunPod response JSON.
    """
    endpoint = runpod_endpoint or get_runpod_endpoint_for_tier(hardware_tier, fallback="budget")
    job_type = get_runpod_job_type_for_mode(mode)
    api_key = get_runpod_api_key()
    if not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Server not configured: RUNPOD_API_KEY missing.",
        )

    run_url = _normalize_run_url(endpoint)
    timeout_s = get_request_timeout_s()

    # RunPod expects the API key directly (no Bearer prefix).
    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }
    payload = {
        "input": {
            "molecule_xml": molecule_xml,
            "uid": uid,
            "mode": mode,
            "jobType": job_type,
            "job_type": job_type,
            "hardware_tier": hardware_tier,
            "max_runtime_sec": max_runtime_sec,
            "system_charge": int(system_charge),
            "systemCharge": int(system_charge),
            **({"md_config": md_config, "molecularDynamics": md_config} if md_config else {}),
        }
    }

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


def get_status(job_id: str, hardware_tier: str | None = None) -> Dict[str, Any]:
    """
    Fetches job status from RunPod by job id. Returns RunPod response JSON.
    """
    endpoint = get_runpod_endpoint_for_tier(hardware_tier, fallback=LEGACY_HARDWARE_TIER)
    api_key = get_runpod_api_key()
    if not api_key:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message="Server not configured: RUNPOD_API_KEY missing.",
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
