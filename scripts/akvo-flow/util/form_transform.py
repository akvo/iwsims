"""Akvo Flow -> IWSIMS question mapping.

Pure translation logic: no file IO, no config loading. See
doc/claude/flow-form-generator-plan.md for the rules this implements.
"""
import re
from typing import Dict, List, Optional

# Administration levels seeded from source/fiji.csv:
# National=0, Division=1, Province=2, Tikina=3, Village=4.
ADMINISTRATION_MAX_LEVEL = 3

# ColorBrewer Dark2, then extras, matching the palette already in
# backend/source/forms/*.prod.json.
PALETTE = [
    "#1b9e77", "#d95f02", "#7570b3", "#e7298a",
    "#66a61e", "#e6ab02", "#a6761d", "#666666",
    "#1f78b4", "#a65628", "#377eb8", "#003f5c",
]
YES_COLOR = "#64A73B"
NO_COLOR = "#e41a1c"

# Labels are fixed, never derived from the Flow label: the two surveys word
# the caddisfly question differently and only one of them contains "cbt",
# which CADDISFLY_TARGETS in af_forms_mapping.ipynb requires.
CADDISFLY_FANOUT = [
    {
        "offset": 101,
        "type": "number",
        "label": "E.Coli CBT test result (MPN/100ml)",
        "name": "ecoli_cbt_mpn",
        "rule": {"allowDecimal": True},
    },
    {
        "offset": 102,
        "type": "option",
        "label": "E.Coli CBT test health risk category",
        "name": "ecoli_cbt_risk_category",
        # Values, labels and colors copied verbatim from the existing risk
        # questions (e.g. q1754995400001 in 1_1749652214711) so the entries
        # already in label_aliases.json keep resolving.
        "options": [
            {"value": "no_risk", "label": "No risk", "color": YES_COLOR},
            {"value": "low_risk", "label": "Low risk", "color": "#1f78b4"},
            {"value": "moderate_risk", "label": "Moderate Risk",
             "color": "#d95f02"},
            {"value": "high_risk", "label": "High Risk", "color": NO_COLOR},
        ],
    },
    {
        "offset": 103,
        "type": "photo",
        "label": "E.Coli CBT test result photo",
        "name": "ecoli_cbt_photo",
    },
]

MAX_NAME_LENGTH = 50

# Meta questions build the datapoint name, so they are restricted to the three
# types that render a usable name: the administration path, a single-line name,
# and a geo point. A meta question that would otherwise be `text` is emitted as
# `input`; anything else meta is rejected by the self-check rather than
# silently converted.
META_TYPES = ("administration", "input", "geo")


class UnsupportedFlowType(Exception):
    """Raised for a Flow question type the generator does not handle."""


def snake_case(value: str) -> str:
    """Normalise a label or Flow variableName into a snake_case identifier.

    Close to form_seeder.clean_string, with two deliberate differences:
    underscores survive (Flow variableName values such as
    "WASH_school_toilets_photo" carry them) and separator punctuation becomes
    an underscore rather than vanishing, so "Division-Province-Tikina" gives
    "division_province_tikina" instead of "divisionprovincetikina".

    Safe to diverge: the generator always emits an explicit option "value",
    so the seeder never derives one itself, and dependency options are
    matched against values this same function produced.
    """
    text = re.sub(r"[-/\\]+", " ", value.strip().lower())
    text = re.sub(r"[^a-z0-9 _]", "", text)
    return re.sub(r"_+", "_", text.replace(" ", "_")).strip("_")


def truncate_name(value: str, limit: int = MAX_NAME_LENGTH) -> str:
    """Trim a snake_case name to `limit` chars on an underscore boundary."""
    if len(value) <= limit:
        return value
    head = value[:limit]
    if "_" in head:
        head = head.rsplit("_", 1)[0]
    return head.strip("_")


def option_color(label: str, order: int) -> str:
    """Yes/No keep their conventional colors; the rest cycle the palette."""
    normalised = label.strip().lower()
    if normalised == "yes":
        return YES_COLOR
    if normalised == "no":
        return NO_COLOR
    return PALETTE[(order - 1) % len(PALETTE)]


def build_options(flow_question: dict) -> List[dict]:
    """Translate a Flow option block into IWSIMS options."""
    block = flow_question.get("options") or {}
    options = []
    for index, option in enumerate(block.get("option") or []):
        label = (option.get("text") or option.get("value") or "").strip()
        order = index + 1
        options.append({
            "value": snake_case(option.get("value") or label),
            "label": label,
            "order": order,
            "color": option_color(label, order),
        })
    if block.get("allowOther"):
        order = len(options) + 1
        options.append({
            "value": "other",
            "label": "Other",
            "order": order,
            "color": option_color("Other", order),
        })
    return options


def build_rule(flow_question: dict) -> Optional[dict]:
    """Translate a numeric Flow validationRule into an IWSIMS rule."""
    validation = flow_question.get("validationRule") or {}
    if validation.get("validationType") != "numeric":
        return None
    allow_decimal = bool(validation.get("allowDecimal"))
    rule: Dict[str, object] = {"allowDecimal": allow_decimal}
    cast = float if allow_decimal else int
    for flow_key, mis_key in (("minVal", "min"), ("maxVal", "max")):
        raw = validation.get(flow_key)
        if raw not in (None, ""):
            rule[mis_key] = cast(float(raw))
    return rule


def build_dependency(flow_question: dict) -> Optional[List[dict]]:
    """Translate Flow dependencies, splitting multi-value answers on '|'."""
    dependencies = flow_question.get("dependency") or []
    result = []
    for dependency in dependencies:
        question_id = str(dependency.get("question", "")).lstrip("Q")
        if not question_id:
            continue
        answers = str(dependency.get("answerValue") or "").split("|")
        result.append({
            "id": int(question_id),
            "options": [snake_case(a) for a in answers if a.strip()],
        })
    return result or None


def resolve_type(flow_question: dict, administration_cascade: str) -> str:
    """Map a Flow question type onto an IWSIMS question type."""
    flow_type = flow_question.get("type")
    if flow_type == "free":
        if (flow_question.get("validationRule") or {}).get(
            "validationType"
        ) == "numeric":
            return "number"
        return "text"
    if flow_type == "option":
        block = flow_question.get("options") or {}
        return "multiple_option" if block.get("allowMultiple") else "option"
    if flow_type == "cascade":
        if flow_question.get("cascadeResource") == administration_cascade:
            return "administration"
        # Entity management is disabled in IWSIMS, and the school hierarchy is
        # not in the administration tree; transform_mis_value joins the cascade
        # levels with " - " into a single input.
        return "input"
    if flow_type in ("geo", "date", "photo"):
        return flow_type
    raise UnsupportedFlowType(
        f"question {flow_question.get('id')}: unsupported Flow type "
        f"'{flow_type}'"
    )


def build_tooltip(flow_question: dict) -> Optional[dict]:
    """Flow help text becomes an IWSIMS tooltip; {'text': None} is dropped."""
    text = (flow_question.get("help") or {}).get("text")
    return {"text": text} if text else None


def _assign_name(label: str, flow_question: dict, used: set) -> str:
    """Pick a form-unique snake_case name, preferring Flow variableName."""
    base = snake_case(flow_question.get("variableName") or "") or snake_case(
        label
    )
    base = truncate_name(base) or f"question_{flow_question.get('id')}"
    name, suffix = base, 1
    while name in used:
        suffix += 1
        name = f"{base}_{suffix}"
    used.add(name)
    return name


def build_caddisfly_questions(
    flow_question: dict, form_base: int, order: int, used: set
) -> List[dict]:
    """Fan one caddisfly question out into number / option / photo."""
    dependency = build_dependency(flow_question)
    required = bool(flow_question.get("mandatory"))
    tooltip = {"text": flow_question.get("text")}
    questions = []
    for index, spec in enumerate(CADDISFLY_FANOUT):
        name, suffix = spec["name"], 1
        while name in used:
            suffix += 1
            name = f"{spec['name']}_{suffix}"
        used.add(name)
        question = {
            "id": form_base + spec["offset"],
            "name": name,
            "label": spec["label"],
            "order": order + index,
            "type": spec["type"],
            "required": required,
            "meta": False,
            "tooltip": tooltip,
        }
        if spec.get("options"):
            question["options"] = [
                {**option, "order": position + 1}
                for position, option in enumerate(spec["options"])
            ]
        if spec.get("rule"):
            question["rule"] = spec["rule"]
        if dependency:
            question["dependency"] = dependency
        questions.append(question)
    return questions


def build_question(
    flow_question: dict, administration_cascade: str, order: int, used: set
) -> dict:
    """Translate one non-caddisfly Flow question."""
    label = (flow_question.get("text") or "").strip()
    mis_type = resolve_type(flow_question, administration_cascade)
    is_administration = mis_type == "administration"
    is_meta = is_administration or bool(
        flow_question.get("localeNameFlag")
        or flow_question.get("localeLocationFlag")
    )
    if is_meta and mis_type == "text":
        mis_type = "input"
    question = {
        "id": int(str(flow_question["id"]).lstrip("Q")),
        "name": _assign_name(label, flow_question, used),
        "label": label,
        "order": order,
        "type": mis_type,
        "required": bool(flow_question.get("mandatory")),
        "meta": is_meta,
    }
    if is_administration:
        question["api"] = {"max_level": ADMINISTRATION_MAX_LEVEL}
    options = build_options(flow_question)
    if options:
        question["options"] = options
    rule = build_rule(flow_question)
    if rule:
        question["rule"] = rule
    tooltip = build_tooltip(flow_question)
    if tooltip:
        question["tooltip"] = tooltip
    dependency = build_dependency(flow_question)
    if dependency:
        question["dependency"] = dependency
    return question


def build_question_group(
    flow_group: dict,
    group_order: int,
    form_base: int,
    administration_cascade: str,
    used: set,
) -> dict:
    """Translate one Flow question group, expanding caddisfly questions."""
    flow_questions = sorted(
        flow_group.get("question") or [],
        key=lambda q: int(q.get("order") or 0),
    )
    questions: List[dict] = []
    order = 1
    for flow_question in flow_questions:
        if flow_question.get("type") == "caddisfly":
            fanout = build_caddisfly_questions(
                flow_question, form_base, order, used
            )
            questions.extend(fanout)
            order += len(fanout)
            continue
        questions.append(
            build_question(
                flow_question, administration_cascade, order, used
            )
        )
        order += 1
    repeatable = bool(flow_group.get("repeatable"))
    heading = (flow_group.get("heading") or "").strip()
    return {
        "id": form_base + group_order,
        "name": snake_case(heading) or f"group_{group_order}",
        "label": heading,
        "description": None,
        "order": group_order,
        "repeatable": repeatable,
        "questions": questions,
        "repeat_text": "Add another" if repeatable else None,
    }


def demote_extra_geo_meta(groups: List[dict]) -> None:
    """Keep only the first geo question as meta.

    A datapoint name takes a single point; a second geo question — a reading
    on a repeatable group, say — would only add noise. Flow marks each with
    localeLocationFlag independently, so the survey can carry more than one.
    """
    seen = False
    for group in groups:
        for question in group["questions"]:
            if question["type"] != "geo" or not question.get("meta"):
                continue
            if seen:
                question["meta"] = False
            seen = True


def build_form(flow_form: dict, generate_config: dict) -> dict:
    """Translate a whole Flow survey into an IWSIMS registration form."""
    form_base = int(generate_config["mis_form_id"])
    administration_cascade = generate_config["administration_cascade"]
    language = flow_form.get("defaultLanguageCode") or "en"
    used: set = set()
    groups = [
        build_question_group(
            flow_group, index + 1, form_base, administration_cascade, used
        )
        for index, flow_group in enumerate(
            flow_form.get("questionGroup") or []
        )
    ]
    demote_extra_geo_meta(groups)
    name = generate_config.get("form_name") or flow_form.get(
        "name", ""
    ).strip()
    return {
        "id": form_base,
        "form": name,
        "description": generate_config.get("description")
        or f"{name} - Registration",
        "defaultLanguage": language,
        "languages": [language],
        "version": 1,
        "type": 1,
        "question_groups": groups,
    }
