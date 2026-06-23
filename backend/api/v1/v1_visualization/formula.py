"""Pure-function formula evaluator for the dashboard map filter.

Each formula has a list of ``buckets``; for each bucket we test that
**all** conditions in ``all_of`` pass against the supplied
``answers_by_qname`` mapping. The first bucket whose conditions all pass
wins; otherwise the formula's ``default`` bucket is returned.

``answers_by_qname`` maps ``question_name`` to whatever Answers row should
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


def _answer_empty(answer):
    """Return True when a numeric/option answer is absent or blank."""
    if answer is None:
        return True
    return _answer_numeric(answer) is None and not _answer_options(answer)


def _match(condition, answers_by_qname):
    """Return True iff the condition passes against the answers map."""
    if "all_of" in condition:
        return all(
            _match(child, answers_by_qname)
            for child in condition.get("all_of") or []
        )
    if "any_of" in condition:
        return any(
            _match(child, answers_by_qname)
            for child in condition.get("any_of") or []
        )

    qname = condition.get("question_name")
    op = condition.get("op")
    answer = answers_by_qname.get(qname)

    if op == "is_empty":
        return _answer_empty(answer)
    if op == "is_not_empty":
        return not _answer_empty(answer)
    if op == "option_not_contains":
        return condition.get("value") not in _answer_options(answer)
    if op in ("option_contains", "option_equals"):
        return condition.get("value") in _answer_options(answer)

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

    if op == "option_in":
        opts = _answer_options(answer)
        return any(v in opts for v in condition.get("values", []))

    return False


def evaluate(formula, answers_by_qname):
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
        group = (
            {"all_of": bucket["all_of"]}
            if "all_of" in bucket
            else {"any_of": bucket.get("any_of") or []}
        )
        if _match(group, answers_by_qname):
            return bucket["value"]
    return formula.get("default", {}).get("value")


def pick_latest_repeat(answers):
    """Pick the highest-index Answers row per ``question_name``.

    Accepts either a list of Answers-shaped objects (with a
    ``question_name`` attribute) or a list of dicts with at least
    ``question_name`` and ``index`` keys. The rows must therefore carry
    ``question_name`` — source them from ``mv_answer_denormalized``, not
    the base ``Answers`` table.
    Returns ``dict[question_name -> answer_row]``.
    """
    out = {}
    best_idx = {}
    for ans in answers:
        if hasattr(ans, "question_name"):
            qname = ans.question_name
        elif isinstance(ans, dict):
            qname = ans.get("question_name")
        else:
            qname = None
        if qname is None:
            continue
        idx = getattr(ans, "index", None)
        if idx is None and isinstance(ans, dict):
            idx = ans.get("index", 0)
        idx = idx or 0
        if qname not in best_idx or idx > best_idx[qname]:
            best_idx[qname] = idx
            out[qname] = ans
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

    def validate_condition(cond, location):
        if not isinstance(cond, dict):
            raise ValueError(f"{location} must be an object")
        groups = [key for key in ("all_of", "any_of") if key in cond]
        if groups:
            if len(groups) != 1:
                raise ValueError(
                    f"{location} must use exactly one condition group"
                )
            children = cond[groups[0]]
            if not isinstance(children, list) or not children:
                raise ValueError(
                    f"{location}.{groups[0]} must be a non-empty array"
                )
            for index, child in enumerate(children):
                validate_condition(
                    child, f"{location}.{groups[0]}[{index}]"
                )
            return

        if "question_name" not in cond or "op" not in cond:
            raise ValueError(
                f"{location} requires 'question_name' and 'op'"
            )
        op = cond["op"]
        if op == "between":
            if "min" not in cond or "max" not in cond:
                raise ValueError(
                    f"{location} op 'between' requires 'min' and 'max'"
                )
            if not isinstance(cond["min"], (int, float)) or \
                    not isinstance(cond["max"], (int, float)):
                raise ValueError(
                    f"{location} op 'between' 'min' and 'max' "
                    "must be numbers"
                )
        elif op == "option_in":
            if not isinstance(cond.get("values"), list):
                raise ValueError(
                    f"{location} op 'option_in' requires 'values' array"
                )
        elif op in NUMERIC_OPS:
            if "value" not in cond:
                raise ValueError(
                    f"{location} op '{op}' requires 'value'"
                )
            if not isinstance(cond["value"], (int, float)):
                raise ValueError(
                    f"{location} op '{op}' 'value' must be a number"
                )
        elif op in (
            "option_equals", "option_contains", "option_not_contains",
        ):
            if "value" not in cond:
                raise ValueError(
                    f"{location} op '{op}' requires 'value'"
                )
        elif op not in ("is_empty", "is_not_empty"):
            raise ValueError(f"{location} unsupported op '{op}'")

    for i, bucket in enumerate(buckets):
        if not isinstance(bucket, dict):
            raise ValueError(f"buckets[{i}] must be an object")
        if "value" not in bucket or "label" not in bucket:
            raise ValueError(
                f"buckets[{i}] must include 'value' and 'label'"
            )
        groups = [key for key in ("all_of", "any_of") if key in bucket]
        if len(groups) != 1:
            raise ValueError(
                f"buckets[{i}] must use exactly one of 'all_of' or 'any_of'"
            )
        validate_condition(
            {groups[0]: bucket[groups[0]]}, f"buckets[{i}]"
        )
    default = formula.get("default")
    if not isinstance(default, dict):
        raise ValueError("formula.default must be an object")
    if "value" not in default or "label" not in default:
        raise ValueError(
            "formula.default must include 'value' and 'label'"
        )
    return formula
