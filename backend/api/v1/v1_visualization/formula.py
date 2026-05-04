"""Pure-function formula evaluator for the dashboard map filter.

Each formula has a list of ``buckets``; for each bucket we test that
**all** conditions in ``all_of`` pass against the supplied
``answers_by_qid`` mapping. The first bucket whose conditions all pass
wins; otherwise the formula's ``default`` bucket is returned.

``answers_by_qid`` maps ``question_id`` to whatever Answers row should
be considered the "current" value — for repeatable groups the caller
selects the latest repeat (highest ``index``) per question and passes
*that* row in.

No Django imports here so the unit-test surface stays trivial.
"""

NUMERIC_OPS = {
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def _answer_numeric(answer):
    """Return the numeric value of an Answer-shaped object or None."""
    value = getattr(answer, "value", None)
    if value is None and isinstance(answer, dict):
        value = answer.get("value")
    return value


def _answer_options(answer):
    """Return the options list of an Answer-shaped object or []."""
    options = getattr(answer, "options", None)
    if options is None and isinstance(answer, dict):
        options = answer.get("options")
    return options or []


def _match(condition, answers_by_qid):
    """Return True iff the condition passes against the answers map."""
    qid = condition.get("question_id")
    op = condition.get("op")
    answer = answers_by_qid.get(qid)
    if answer is None:
        return False

    if op in NUMERIC_OPS:
        value = _answer_numeric(answer)
        if value is None:
            return False
        return NUMERIC_OPS[op](value, condition["value"])

    if op == "between":
        value = _answer_numeric(answer)
        if value is None:
            return False
        return condition["min"] <= value <= condition["max"]

    if op == "option_equals":
        return condition["value"] in _answer_options(answer)

    if op == "option_in":
        opts = _answer_options(answer)
        return any(v in opts for v in condition.get("values", []))

    return False


def evaluate(formula, answers_by_qid):
    """Return the bucket value matching the answers, or the default.

    ``formula`` shape::

        {
          "buckets": [
            {"value": "...", "label": "...", "all_of": [<cond>, ...]},
            ...
          ],
          "default": {"value": "...", "label": "..."}
        }
    """
    for bucket in formula.get("buckets", []):
        conditions = bucket.get("all_of") or []
        if all(_match(c, answers_by_qid) for c in conditions):
            return bucket["value"]
    return formula.get("default", {}).get("value")


def pick_latest_repeat(answers):
    """Pick the highest-index Answers row per ``question_id``.

    Accepts either a list of Answers model instances or a list of dicts
    with at least ``question`` (or ``question_id``) and ``index`` keys.
    Returns ``dict[question_id -> answer_row]``.
    """
    out = {}
    best_idx = {}
    for ans in answers:
        if hasattr(ans, "question_id"):
            qid = ans.question_id
        elif isinstance(ans, dict):
            qid = ans.get("question") or ans.get("question_id")
        else:
            qid = None
        if qid is None:
            continue
        idx = getattr(ans, "index", None)
        if idx is None and isinstance(ans, dict):
            idx = ans.get("index", 0)
        idx = idx or 0
        if qid not in best_idx or idx > best_idx[qid]:
            best_idx[qid] = idx
            out[qid] = ans
    return out


def validate_shape(formula):
    """Lightweight structural validation; raises ValueError on bad input.

    Used by the request serializer to reject malformed formulas before
    the view starts iterating.
    """
    if not isinstance(formula, dict):
        raise ValueError("formula must be an object")
    buckets = formula.get("buckets")
    if not isinstance(buckets, list) or not buckets:
        raise ValueError("formula.buckets must be a non-empty array")
    for i, bucket in enumerate(buckets):
        if not isinstance(bucket, dict):
            raise ValueError(f"buckets[{i}] must be an object")
        if "value" not in bucket or "label" not in bucket:
            raise ValueError(
                f"buckets[{i}] must include 'value' and 'label'"
            )
        conditions = bucket.get("all_of")
        if not isinstance(conditions, list) or not conditions:
            raise ValueError(
                f"buckets[{i}].all_of must be a non-empty array"
            )
        for j, cond in enumerate(conditions):
            if not isinstance(cond, dict):
                raise ValueError(
                    f"buckets[{i}].all_of[{j}] must be an object"
                )
            if "question_id" not in cond or "op" not in cond:
                raise ValueError(
                    f"buckets[{i}].all_of[{j}] requires "
                    "'question_id' and 'op'"
                )
            op = cond["op"]
            if op == "between":
                if "min" not in cond or "max" not in cond:
                    raise ValueError(
                        f"buckets[{i}].all_of[{j}] op 'between' "
                        "requires 'min' and 'max'"
                    )
            elif op == "option_in":
                if not isinstance(cond.get("values"), list):
                    raise ValueError(
                        f"buckets[{i}].all_of[{j}] op 'option_in' "
                        "requires 'values' array"
                    )
            elif op in NUMERIC_OPS or op == "option_equals":
                if "value" not in cond:
                    raise ValueError(
                        f"buckets[{i}].all_of[{j}] op '{op}' "
                        "requires 'value'"
                    )
            else:
                raise ValueError(
                    f"buckets[{i}].all_of[{j}] unsupported op '{op}'"
                )
    default = formula.get("default")
    if not isinstance(default, dict):
        raise ValueError("formula.default must be an object")
    if "value" not in default or "label" not in default:
        raise ValueError(
            "formula.default must include 'value' and 'label'"
        )
    return formula
