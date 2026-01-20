# functions/auth_helpers.py
from __future__ import annotations

from typing import Any, Dict

from firebase_functions import https_fn


def require_auth(req: https_fn.CallableRequest) -> Dict[str, Any]:
    """
    Enforces Firebase Authentication for callable functions.
    Returns a dict with uid/token.
    """
    auth = getattr(req, "auth", None)
    if not auth:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required.",
        )

    uid = getattr(auth, "uid", None)
    if not uid:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message="Authentication required (missing uid).",
        )

    return {"uid": uid, "token": getattr(auth, "token", None)}
