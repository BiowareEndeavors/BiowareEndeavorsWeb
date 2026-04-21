# functions/config.py
from __future__ import annotations

import os
from typing import List, Tuple


# Validation
DEFAULT_MAX_XML_CHARS = 2_000_000  # ~2MB

REQUIRED_TAGS: List[Tuple[str, str]] = [
    ("PC-Atoms_element", "PC-Element"),
    ("PC-Conformer_x", "PC-Conformer_x_E"),
    ("PC-Conformer_y", "PC-Conformer_y_E"),
    ("PC-Conformer_z", "PC-Conformer_z_E"),
]

# RunPod / networking
DEFAULT_REQUEST_TIMEOUT_S = 60.0
DEFAULT_STORAGE_BUCKET_SUFFIX = ".firebasestorage.app"
DEFAULT_STORAGE_BUCKET_FALLBACK = "insight-93569.firebasestorage.app"

def get_max_xml_chars() -> int:
    return int(os.environ.get("MAX_XML_CHARS", str(DEFAULT_MAX_XML_CHARS)))

def get_request_timeout_s() -> float:
    return float(os.environ.get("REQUEST_TIMEOUT_S", str(DEFAULT_REQUEST_TIMEOUT_S)))

def get_runpod_api_key() -> str:
    return os.environ.get("RUNPOD_API_KEY", "").strip()

def get_storage_bucket_name() -> str:
    explicit_bucket = (
        os.environ.get("FIREBASE_STORAGE_BUCKET", "").strip()
        or os.environ.get("STORAGE_BUCKET", "").strip()
    )
    if explicit_bucket:
        return explicit_bucket

    project_id = (
        os.environ.get("GCLOUD_PROJECT", "").strip()
        or os.environ.get("GCP_PROJECT", "").strip()
    )
    if project_id:
        return f"{project_id}{DEFAULT_STORAGE_BUCKET_SUFFIX}"

    return DEFAULT_STORAGE_BUCKET_FALLBACK
