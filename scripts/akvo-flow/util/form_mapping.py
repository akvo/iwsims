"""Flow question -> IWSIMS question mapping rows for af_forms_mapping CSVs."""
from typing import List


def build_mapping_rows(flow_form: dict, form: dict) -> List[dict]:
    """Pair every Flow question with the IWSIMS question(s) it became.

    Question ids are the Flow ids (see the plan, §4), so the parent mapping is
    the identity function and needs none of af_forms_mapping's rapidfuzz
    scoring. The one exception is caddisfly, where a single Flow question
    becomes three IWSIMS questions and therefore three rows.

    Flow and IWSIMS questions sit in the same order within a group, so the two
    are walked in lockstep rather than matched by id.
    """
    rows = []
    flow_groups = flow_form.get("questionGroup") or []
    for flow_group, group in zip(flow_groups, form["question_groups"]):
        flow_questions = sorted(
            flow_group.get("question") or [],
            key=lambda q: int(q.get("order") or 0),
        )
        questions = iter(group["questions"])
        for flow_question in flow_questions:
            fanout = 3 if flow_question.get("type") == "caddisfly" else 1
            for _ in range(fanout):
                question = next(questions)
                rows.append({
                    "flow_form_id": flow_form.get("surveyId"),
                    "flow_question_group": flow_group.get("heading"),
                    "flow_question_label": flow_question.get("text"),
                    "flow_question_id": flow_question.get("id"),
                    "mis_form_id": form["id"],
                    "mis_question_group": group["label"],
                    "mis_question_label": (
                        f"{group['label']} |\n{question['label']}"
                    ),
                    "mis_question_id": question["id"],
                    "match_score": 100.0,
                    "match_confidence": "high",
                    "match_method": "identity",
                    "mis_question_order": (
                        group["order"] * 1000 + question["order"]
                    ),
                })
    return rows
