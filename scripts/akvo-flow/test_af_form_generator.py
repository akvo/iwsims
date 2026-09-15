"""Self-check for af_form_generator, run against the two real Flow surveys.

    python test_af_form_generator.py

Asserts the Phase 4 checks in doc/claude/flow-form-generator-plan.md.
"""
import json
import re
import sys

from af_form_generator import FORM_OUT_DIR, find_flow_form
from util.config import load_flow_forms
from util.form_transform import META_TYPES, build_form

FLOW_IDS = ["535151018", "540671011"]

# Mirrors CADDISFLY_TARGETS in af_forms_mapping.ipynb. Keyed by MIS type, so
# each generated question only has to satisfy the lambda for its own type.
CADDISFLY_TARGETS = {
    "number": lambda label: "cbt" in label and "lab" not in label,
    "option": lambda label: "risk" in label,
    "photo": lambda label: "cbt" in label,
}

# api/v1/v1_forms/constants.py:QuestionTypes
QUESTION_TYPES = {
    "geo", "administration", "text", "number", "option", "multiple_option",
    "cascade", "photo", "date", "autofield", "attachment", "signature",
    "input",
}
FORBIDDEN_TYPES = {"cascade", "entity"}


def flat_questions(form):
    return [q for g in form["question_groups"] for q in g["questions"]]


def generated_filenames(config):
    """Files this generator owns, excluded from the collision check."""
    return {
        f"{config['forms'][f]['generate']['prefix']}_"
        f"{config['forms'][f]['generate']['mis_form_id']}.prod.json"
        for f in FLOW_IDS
    }


def existing_ids(config):
    """Every question and group id already used by other form definitions."""
    owned = generated_filenames(config)
    ids = set()
    for path in FORM_OUT_DIR.glob("*.json"):
        if path.name in owned:
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        ids.add(data.get("id"))
        for group in data.get("question_groups", []):
            ids.add(group.get("id"))
            ids.update(q.get("id") for q in group.get("questions", []))
    return {i for i in ids if i is not None}


def check_completeness(form, flow_form):
    flow_questions = [
        q for g in flow_form["questionGroup"]
        for q in (g.get("question") or [])
    ]
    caddisfly = sum(1 for q in flow_questions if q.get("type") == "caddisfly")
    expected = len(flow_questions) - caddisfly + 3 * caddisfly
    actual = len(flat_questions(form))
    assert actual == expected, f"expected {expected} questions, got {actual}"
    return expected, caddisfly


def check_dependencies(form):
    questions = {q["id"]: q for q in flat_questions(form)}
    for question in questions.values():
        for dependency in question.get("dependency") or []:
            target = questions.get(dependency["id"])
            assert target, (
                f"q{question['id']} depends on missing q{dependency['id']}"
            )
            values = {o["value"] for o in target.get("options") or []}
            for option in dependency["options"]:
                assert option in values, (
                    f"q{question['id']} depends on q{target['id']} value "
                    f"'{option}', which offers {sorted(values)}"
                )


def check_ids(form, taken):
    ids = [g["id"] for g in form["question_groups"]]
    ids += [q["id"] for q in flat_questions(form)]
    duplicates = {i for i in ids if ids.count(i) > 1}
    assert not duplicates, f"duplicate ids: {sorted(duplicates)}"
    clash = taken.intersection(ids + [form["id"]])
    assert not clash, f"ids already used by another form: {sorted(clash)}"


def check_types(form):
    for question in flat_questions(form):
        assert question["type"] in QUESTION_TYPES, (
            f"q{question['id']} has unknown type '{question['type']}'"
        )
        assert question["type"] not in FORBIDDEN_TYPES, (
            f"q{question['id']} uses forbidden type '{question['type']}'"
        )


def check_caddisfly(form, expected_sets):
    fanout = [
        q for q in flat_questions(form)
        if q["label"].lower().startswith("e.coli cbt test")
    ]
    assert len(fanout) == expected_sets * 3, (
        f"expected {expected_sets * 3} caddisfly questions, got {len(fanout)}"
    )
    for question in fanout:
        predicate = CADDISFLY_TARGETS[question["type"]]
        assert predicate(question["label"].lower()), (
            f"caddisfly {question['type']} label "
            f"'{question['label']}' fails CADDISFLY_TARGETS"
        )


def check_names(form):
    names = [q["name"] for q in flat_questions(form)]
    duplicates = {n for n in names if names.count(n) > 1}
    assert not duplicates, f"duplicate question names: {sorted(duplicates)}"
    for name in names:
        assert re.fullmatch(r"[a-z0-9]+(_[a-z0-9]+)*", name or ""), (
            f"name '{name}' is not snake_case"
        )


def check_meta(form):
    metas = [q for q in flat_questions(form) if q.get("meta")]
    assert metas, "form has no meta question, so datapoints have no name"
    for question in metas:
        assert question["type"] in META_TYPES, (
            f"meta q{question['id']} '{question['label']}' is "
            f"'{question['type']}'; datapoint-name questions must be one of "
            f"{list(META_TYPES)}"
        )
    admin = [q for q in flat_questions(form) if q["type"] == "administration"]
    assert len(admin) == 1, (
        f"expected 1 administration question, got {len(admin)}"
    )
    assert admin[0].get("api", {}).get("max_level") == 3, (
        "administration question must stop at Tikina (max_level 3)"
    )
    geo_meta = [q for q in metas if q["type"] == "geo"]
    assert len(geo_meta) <= 1, (
        "only the first geo question may be meta; got "
        f"{[q['id'] for q in geo_meta]}"
    )


def main():
    config = load_flow_forms()
    taken = existing_ids(config)
    for flow_id in FLOW_IDS:
        flow_form = json.loads(
            find_flow_form(flow_id).read_text(encoding="utf-8")
        )
        form = build_form(flow_form, config["forms"][flow_id]["generate"])

        total, caddisfly = check_completeness(form, flow_form)
        check_dependencies(form)
        check_ids(form, taken)
        check_types(form)
        check_caddisfly(form, caddisfly)
        check_names(form)
        check_meta(form)

        print(
            f"OK {flow_id}: {len(form['question_groups'])} groups, "
            f"{total} questions ({caddisfly} caddisfly fan-out)"
        )
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
