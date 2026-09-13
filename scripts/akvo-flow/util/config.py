"""Shared Flow-to-MIS form configuration for the akvo-flow notebooks.

The live file is storage/akvo-flow/flow_forms.json (outside git, shared
with the backend seeder); flow_forms.example.json next to the notebooks is
the committed template.
"""
import json
from pathlib import Path
from typing import Dict, List

FLOW_FORMS_PATH = Path("../../storage/akvo-flow/flow_forms.json")


def load_flow_forms(path: Path = FLOW_FORMS_PATH) -> dict:
    """Return {"forms": {flow_id: {...}}, "active": [flow_id, ...]}.

    `active` lists the Flow form ids the notebooks should process; empty or
    missing means every form in `forms`.
    """
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found; copy flow_forms.example.json there and edit"
        )
    with open(path, encoding="utf-8") as f:
        cfg = json.load(f)
    forms = {str(k): v for k, v in cfg.get("forms", {}).items()}
    active = [str(a) for a in cfg.get("active", [])] or list(forms)
    unknown = [a for a in active if a not in forms]
    if unknown:
        raise ValueError(f"active ids missing from forms: {unknown}")
    return {"forms": forms, "active": active}


def active_form_ids(cfg: dict) -> List[str]:
    return list(cfg["active"])


def parent_form_ids(cfg: dict) -> Dict[str, int]:
    """Flow form id -> MIS parent form id, active forms only."""
    return {
        fid: int(cfg["forms"][fid]["mis_form_id"]) for fid in cfg["active"]
    }


def child_form_ids(cfg: dict) -> Dict[str, List[int]]:
    """Flow form id -> MIS child form ids, active forms only."""
    return {
        fid: [int(c) for c in cfg["forms"][fid].get("mis_child_form_ids", [])]
        for fid in cfg["active"]
    }
