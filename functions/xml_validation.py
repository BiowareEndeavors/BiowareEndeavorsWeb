# functions/xml_validation.py
from __future__ import annotations

from typing import Optional
import xml.etree.ElementTree as ET

from firebase_functions import https_fn

from config import REQUIRED_TAGS, get_max_xml_chars


def _local(tag: str) -> str:
    """
    ElementTree tag forms:
      '{uri}TagName' -> TagName
      'ns0:TagName'  -> TagName (rare after parse, but handle anyway)
    """
    if not tag:
        return ""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag.split(":")[-1]


def _find_first_by_local(root: ET.Element, name: str) -> Optional[ET.Element]:
    for el in root.iter():
        if _local(el.tag) == name:
            return el
    return None


def _count_children_by_local(parent: ET.Element, child_local_name: str) -> int:
    # direct children only
    return sum(1 for ch in list(parent) if _local(ch.tag) == child_local_name)


def validate_molecule_xml(molecule_xml: str) -> int:
    """
    Validates molecule_xml and returns nAtoms (count of PC-Element / conformer entries).
    Raises HttpsError on invalid inputs.
    """
    if not molecule_xml or not isinstance(molecule_xml, str):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="molecule_xml must be a non-empty string.",
        )

    max_chars = get_max_xml_chars()
    if len(molecule_xml) > max_chars:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=f"molecule_xml too large (>{max_chars} chars).",
        )

    try:
        root = ET.fromstring(molecule_xml)
    except ET.ParseError:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="XML parse error.",
        )

    # Allow either <PC-Compounds> root or a wrapper that contains it
    if _local(root.tag) != "PC-Compounds":
        pc = _find_first_by_local(root, "PC-Compounds")
        if pc is None:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message="Missing root tag: PC-Compounds.",
            )
        root = pc

    counts = []
    for parent_local, child_local in REQUIRED_TAGS:
        parent_el = _find_first_by_local(root, parent_local)
        if parent_el is None:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message=f"Missing tag: {parent_local}.",
            )

        c = _count_children_by_local(parent_el, child_local)
        if c <= 0:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                message=f"Tag {parent_local} has 0 children <{child_local}>.",
            )
        counts.append(c)

    if any(c != counts[0] for c in counts[1:]):
        detail = ", ".join(f"{REQUIRED_TAGS[i][0]}={counts[i]}" for i in range(len(counts)))
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message=f"Mismatched child counts: {detail}.",
        )

    return counts[0]