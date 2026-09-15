"""Generate IWSIMS form definitions from downloaded Akvo Flow surveys.

Reads a Flow survey definition from ``output/flow_forms/`` and writes an
IWSIMS registration form to ``../../backend/source/forms/``.

Writing there is safe: form_seeder is a manual trigger, so a regenerated file
does not reach the database until someone runs it.

See doc/claude/flow-form-generator-plan.md for the mapping rules.

Usage::

    python af_form_generator.py --flow-id 535151018 --flow-id 540671011
"""
import argparse
import csv
import json
import logging
import sys
from pathlib import Path

from util.config import load_flow_forms
from util.form_mapping import build_mapping_rows
from util.form_transform import build_form

logger = logging.getLogger(__name__)

FLOW_FORM_DIR = Path("./output/flow_forms")
FORM_OUT_DIR = Path("../../backend/source/forms")
MAPPING_OUT_DIR = Path("./output/forms")


def find_flow_form(flow_id: str, directory: Path = FLOW_FORM_DIR) -> Path:
    """Locate the downloaded Flow JSON for a survey id."""
    matches = sorted(directory.glob(f"{flow_id}_*.json"))
    if not matches:
        raise FileNotFoundError(
            f"no Flow form for {flow_id} in {directory}; "
            "run af_downloader first"
        )
    return matches[0]


def generate(flow_id: str) -> Path:
    """Generate one IWSIMS form and return the path written."""
    config = load_flow_forms()
    entry = config["forms"].get(flow_id)
    if not entry:
        raise KeyError(f"{flow_id} not present in flow_forms.json")
    generate_config = entry.get("generate")
    if not generate_config:
        raise KeyError(
            f"{flow_id} has no 'generate' block in flow_forms.json"
        )

    source = find_flow_form(flow_id)
    with open(source, encoding="utf-8") as handle:
        flow_form = json.load(handle)

    form = build_form(flow_form, generate_config)

    FORM_OUT_DIR.mkdir(parents=True, exist_ok=True)
    prefix = generate_config["prefix"]
    destination = FORM_OUT_DIR / f"{prefix}_{form['id']}.prod.json"
    with open(destination, "w", encoding="utf-8") as handle:
        json.dump(form, handle, indent=2, ensure_ascii=False)
        handle.write("\n")

    rows = build_mapping_rows(flow_form, form)
    MAPPING_OUT_DIR.mkdir(parents=True, exist_ok=True)
    mapping_path = (
        MAPPING_OUT_DIR / f"{flow_id}_mapping_parent_{form['id']}.csv"
    )
    with open(mapping_path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    logger.info("%s (%d mapping rows)", mapping_path, len(rows))

    total = sum(len(g["questions"]) for g in form["question_groups"])
    logger.info(
        "%s -> %s (%d groups, %d questions)",
        source.name, destination, len(form["question_groups"]), total,
    )
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--flow-id", action="append", required=True,
        help="Flow survey id; repeatable",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    for flow_id in args.flow_id:
        generate(str(flow_id))
    return 0


if __name__ == "__main__":
    sys.exit(main())
