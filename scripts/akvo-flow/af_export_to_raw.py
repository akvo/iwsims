"""Convert an Akvo Flow Excel export into the raw CSV the downloader writes.

Use when the Flow API data endpoint is unavailable. Output goes to
storage/akvo-flow/raw/<form_id>_<form_name>.csv with the same value encoding
as af_downloader.ipynb (JSON for cascade, geo, option, photo and caddisfly).

    python af_export_to_raw.py <flow_form_id> <export.xlsx>

Repeatable groups come as extra sheets ("Group N"). Like the downloader, one
row per submission is kept; for a repeat sheet the repeat marked "Primary" is
used when such a question exists, otherwise the first repeat.
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

FLOW_FORMS_DIR = Path("./output/flow_forms")
RAW_DATA_DIR = Path("../../storage/akvo-flow/raw")
META_COLUMNS = {
    "Identifier", "Repeat no", "Display Name", "Device identifier",
    "Instance", "Submission Date", "Submitter", "Duration", "Form version",
}
CADDISFLY_RESULT_NAMES = {
    "MPN": ("MPN", "MPN/100ml"),
    "Upper 95% Confidence Interval": ("Upper 95% Confidence Interval", ""),
}


def load_form(form_id: str):
    path = next(FLOW_FORMS_DIR.glob(f"{form_id}_*.json"))
    form = json.load(open(path))
    types = {}
    for group in form["questionGroup"]:
        for q in group["question"]:
            types[str(q["id"])] = q.get("type")
    return path.stem, types


def parse_header(col: str):
    """Return (question_id, label, suffix) for '<id>|<label>[--OTHER--]'."""
    col = re.sub(r"\.\d+$", "", str(col))  # pandas duplicate suffix
    if "|" not in col:
        return None, col, ""
    qid, label = col.split("|", 1)
    suffix = ""
    for marker in ("--OTHER--", "--Image"):
        if label.endswith(marker):
            label, suffix = label[: -len(marker)], marker
    return qid, label, suffix


def cell(row, col):
    val = row.get(col)
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    val = str(val).strip()
    return val or None


def to_created_at(text: str) -> str:
    try:
        return datetime.strptime(text, "%d-%m-%Y %H:%M:%S UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return text


def convert_row(row: pd.Series, columns: list, types: dict) -> dict:
    """Build {question_id: raw value} for one export row."""
    out = {}
    current_qid = None
    i = 0
    while i < len(columns):
        col = columns[i]
        qid, label, suffix = parse_header(col)
        if qid and qid != "--GEOLON--" and not qid.startswith("--"):
            current_qid = qid
        q_type = types.get(current_qid)
        value = cell(row, col)
        if qid is None or qid.startswith("--"):
            i += 1
            continue
        if suffix == "--OTHER--":
            if value:
                out.setdefault(qid, [])
                if isinstance(out[qid], list):
                    out[qid].append({"text": value, "isOther": True})
            i += 1
            continue
        if q_type == "geo":
            lon = cell(row, columns[i + 1]) if i + 1 < len(columns) else None
            elev = cell(row, columns[i + 2]) if i + 2 < len(columns) else None
            if value and lon:
                out[qid] = {"lat": float(value), "long": float(lon),
                            "elev": float(elev) if elev else None}
            i += 3
            continue
        if q_type == "caddisfly":
            results = []
            if value:
                results.append({"name": label.split("|", 1)[-1] if "|" in label else "Health Risk Category (Based on MPN and Confidence Interval)",
                                "unit": "", "id": 1, "value": value})
            image = None
            j = i + 1
            while j < len(columns) and str(columns[j]).startswith("--CADDISFLY--"):
                _, sub_label, sub_suffix = parse_header(columns[j])
                sub_val = cell(row, columns[j])
                if sub_suffix == "--Image":
                    image = sub_val
                elif sub_val is not None:
                    key = sub_label.split("(")[0].strip()
                    name, unit = CADDISFLY_RESULT_NAMES.get(key, (sub_label, ""))
                    results.append({"name": name, "unit": unit, "id": len(results) + 1, "value": sub_val})
                j += 1
            if results or image:
                out[qid] = {"type": "caddisfly", "name": "Water - E.coli",
                            "result": results, "image": image}
            i = j
            continue
        if value is None:
            i += 1
            continue
        if q_type == "cascade":
            out[qid] = [{"code": p.strip(), "name": p.strip()} for p in value.split("|")]
        elif q_type == "option":
            items = [{"text": p.strip()} for p in value.split("|") if p.strip()]
            out[qid] = items + (out[qid] if isinstance(out.get(qid), list) else [])
        elif q_type == "photo":
            out[qid] = {"filename": value, "location": None}
        elif q_type == "date":
            out[qid] = f"{value[:10]}T00:00:00Z" if re.match(r"\d{4}-\d{2}-\d{2}", value) else value
        else:
            out[qid] = value
        i += 1
    return {k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v
            for k, v in out.items()}


def pick_repeat(group_df: pd.DataFrame) -> pd.DataFrame:
    """One row per Identifier: the 'Primary' repeat if asked, else the first."""
    primary_cols = [c for c in group_df.columns if "primary or secondary" in str(c).lower()]
    if primary_cols:
        is_primary = group_df[primary_cols[0]].astype(str).str.strip().eq("Primary")
        group_df = pd.concat([group_df[is_primary], group_df[~is_primary]])
    return group_df.drop_duplicates(subset=["Identifier"], keep="first")


def main(form_id: str, export_path: str) -> None:
    stem, types = load_form(form_id)
    book = pd.ExcelFile(export_path)
    main_df = book.parse("Raw Data", header=1, dtype=str)
    frames = {"Raw Data": main_df}
    dropped = {}
    for sheet in book.sheet_names[1:]:
        df = book.parse(sheet, header=1, dtype=str)
        picked = pick_repeat(df)
        dropped[sheet] = len(df) - len(picked)
        frames[sheet] = picked.set_index("Identifier")

    rows = []
    for n, (_, row) in enumerate(main_df.iterrows(), start=1):
        record = {
            "number": n,
            "createdAt": to_created_at(cell(row, "Submission Date") or ""),
            "datapoint_id": cell(row, "Instance"),
            "identifier": cell(row, "Identifier"),
            "displayName": cell(row, "Display Name"),
            "submitter": cell(row, "Submitter"),
        }
        q_cols = [c for c in main_df.columns if c not in META_COLUMNS and not str(c).startswith("Unnamed")]
        record.update(convert_row(row, q_cols, types))
        for sheet, gdf in frames.items():
            if sheet == "Raw Data" or record["identifier"] not in gdf.index:
                continue
            grow = gdf.loc[record["identifier"]]
            g_cols = [c for c in gdf.columns if c not in META_COLUMNS and not str(c).startswith("Unnamed")]
            record.update(convert_row(grow, g_cols, types))
        rows.append(record)

    out_path = RAW_DATA_DIR / f"{stem}.csv"
    pd.DataFrame(rows).to_csv(out_path, index=False)
    print(f"{out_path}: {len(rows)} submissions; dropped extra repeats: {dropped}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
