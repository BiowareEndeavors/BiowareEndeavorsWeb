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

def get_max_xml_chars() -> int:
    return int(os.environ.get("MAX_XML_CHARS", str(DEFAULT_MAX_XML_CHARS)))

def get_request_timeout_s() -> float:
    return float(os.environ.get("REQUEST_TIMEOUT_S", str(DEFAULT_REQUEST_TIMEOUT_S)))

def get_runpod_endpoint() -> str:
    # Accept either:
    #   - full run URL: https://api.runpod.ai/v2/<endpointId>/run
    #   - base URL:     https://api.runpod.ai/v2/<endpointId>
    # We normalize in runpod_client.py.
    return os.environ.get("RUNPOD_ENDPOINT", "").strip()

def get_runpod_api_key() -> str:
    return os.environ.get("RUNPOD_API_KEY", "").strip()
