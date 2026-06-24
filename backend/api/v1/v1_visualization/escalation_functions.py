from datetime import date
from urllib.parse import urlencode

from django.db.models import Q

from api.v1.v1_data.models import FormData
from api.v1.v1_forms.models import Questions
from api.v1.v1_visualization.functions import (
    apply_administration_filter,
    apply_criteria_to_monitoring_qs,
    apply_parent_criteria_to_qs,
    build_date_filters,
    get_latest_monitoring_subquery,
    format_date_group,
    split_criteria_by_form,
)
from api.v1.v1_visualization.models import (
    MVAnswerDenormalized,
    MVCrossFormLatest,
)


def build_escalation_criteria_filter(criteria, latest_ids):
    """Build OR query from parsed escalation criteria.

    Uses mv_answer_denormalized exclusively — GIN index on answer_options
    and indexed answer_value/answer_name fields replace the direct Answers
    table scans. Tests must call _refresh_all_mvs() in setUp so the MV
    contains the test data before this function is called.

    Args:
        criteria: List of parsed criteria dicts with
            'type' and 'parts' keys.
        latest_ids: List of latest monitoring data IDs.

    Returns:
        Q object combining all criteria with OR logic.
    """
    or_condition = Q()

    for criterion in criteria:
        ctype = criterion["type"]
        parts = criterion["parts"]

        if ctype == "option_equals":
            qname = parts[0]
            value = parts[1]
            matching = MVAnswerDenormalized.objects.filter(
                data_id__in=latest_ids,
                question_name=qname,
                answer_options__contains=[value],
            ).values_list("data_id", flat=True)
            or_condition |= Q(latest_id__in=matching)

        elif ctype == "threshold_gt":
            qname = parts[0]
            threshold = float(parts[1])
            matching = MVAnswerDenormalized.objects.filter(
                data_id__in=latest_ids,
                question_name=qname,
                answer_value__gt=threshold,
            ).values_list("data_id", flat=True)
            or_condition |= Q(latest_id__in=matching)

        elif ctype == "threshold_lt":
            qname = parts[0]
            threshold = float(parts[1])
            matching = MVAnswerDenormalized.objects.filter(
                data_id__in=latest_ids,
                question_name=qname,
                answer_value__lt=threshold,
            ).values_list("data_id", flat=True)
            or_condition |= Q(latest_id__in=matching)

        elif ctype == "overdue":
            completion_qname = parts[0]
            deadline_qname = parts[1]
            # Optional 3rd/4th parts describe what "still incomplete" means.
            #   mode "option" (default): the project is incomplete when its
            #     completion question carries the given option value
            #     (e.g. is_project_completed = "no").
            #   mode "lt": the completion question is numeric and the project
            #     is incomplete when its value is below the threshold
            #     (e.g. project_completion_percentage < 100). A missing value
            #     is NOT counted as incomplete.
            incomplete_value = parts[2] if len(parts) > 2 else "no"
            mode = parts[3] if len(parts) > 3 else "option"
            today = date.today().isoformat()
            base = MVAnswerDenormalized.objects.filter(
                data_id__in=latest_ids,
                question_name=completion_qname,
            )
            if mode == "lt":
                base = base.filter(answer_value__lt=float(incomplete_value))
            else:
                base = base.filter(
                    answer_options__contains=[incomplete_value]
                )
            incomplete = set(base.values_list("data_id", flat=True))
            overdue_ids = set(
                MVAnswerDenormalized.objects.filter(
                    data_id__in=latest_ids,
                    question_name=deadline_qname,
                    answer_name__lt=today,
                ).values_list("data_id", flat=True)
            )
            or_condition |= Q(
                latest_id__in=incomplete & overdue_ids
            )

    return or_condition


def _answer_cell_value(answer):
    """Collapse an Answers row into the cell value used by escalation."""
    if not answer:
        return None
    if answer.get("options"):
        return answer["options"][0]
    if answer.get("value") is not None:
        return answer["value"]
    return answer.get("name")


def build_column_caches(paginated, columns):
    """Pre-fetch answers and FormData needed for rendering one page.

    Reduces the per-row work in extract_column_value from O(columns)
    queries per row to a handful of bulk queries per page.
    """
    latest_ids = [p.latest_id for p in paginated]
    parent_ids = [p.id for p in paginated]

    answer_qnames = set()
    parent_answer_qnames = set()
    latest_date_qnames = set()
    need_created_fallback = False

    for c in columns:
        src = c["source"]
        qname = c.get("question_name")
        if src == "answer" and qname:
            answer_qnames.add(qname)
        elif src == "parent_answer" and qname:
            parent_answer_qnames.add(qname)
        elif src == "latest_date":
            if qname:
                latest_date_qnames.add(qname)
            else:
                need_created_fallback = True

    answer_map = {}
    if answer_qnames or latest_date_qnames:
        rows = MVAnswerDenormalized.objects.filter(
            data_id__in=latest_ids,
            question_name__in=answer_qnames | latest_date_qnames,
        ).values(
            "data_id", "question_name",
            "answer_name", "answer_value", "answer_options",
        )
        for r in rows:
            answer_map[(r["data_id"], r["question_name"])] = {
                "name": r["answer_name"],
                "value": r["answer_value"],
                "options": r["answer_options"],
            }

    parent_answer_map = {}
    if parent_answer_qnames:
        rows = MVAnswerDenormalized.objects.filter(
            data_id__in=parent_ids,
            question_name__in=parent_answer_qnames,
        ).values(
            "data_id", "question_name",
            "answer_name", "answer_value", "answer_options",
        )
        for r in rows:
            parent_answer_map[(r["data_id"], r["question_name"])] = {
                "name": r["answer_name"],
                "value": r["answer_value"],
                "options": r["answer_options"],
            }

    created_map = {}
    if need_created_fallback:
        fd_rows = FormData.objects.filter(
            id__in=latest_ids,
        ).values("id", "created")
        created_map = {r["id"]: r["created"] for r in fd_rows}

    return {
        "answer": answer_map,
        "parent_answer": parent_answer_map,
        "created": created_map,
    }


def extract_column_value(parent, latest_id, col, caches):
    """Extract a column value for a single parent row using caches."""
    source = col["source"]

    if source == "parent_name":
        return parent.name

    if source == "administration":
        adm = parent.administration
        if adm and adm.path:
            ancestors = adm.ancestors.values_list(
                "name", flat=True,
            )
            parts = list(ancestors) + [adm.name]
            return " > ".join(parts)
        return adm.name if adm else None

    if source == "answer":
        qname = col.get("question_name")
        if not qname:
            return None
        return _answer_cell_value(
            caches["answer"].get((latest_id, qname))
        )

    if source == "parent_answer":
        qname = col.get("question_name")
        if not qname:
            return None
        return _answer_cell_value(
            caches["parent_answer"].get((parent.id, qname))
        )

    if source == "latest_date":
        qname = col.get("question_name")
        if qname:
            answer = caches["answer"].get((latest_id, qname))
            if answer and answer.get("name"):
                return format_date_group(answer["name"])
        created = caches["created"].get(latest_id)
        if created:
            return format_date_group(created)
        return None

    return None


def handle_escalation(
    parent_form, monitoring_form_id,
    criteria, columns, params,
):
    """Handle escalation query.

    Args:
        parent_form: Registration form instance.
        monitoring_form_id: Monitoring form ID.
        criteria: Parsed criteria list.
        columns: Parsed columns list.
        params: Dict with page, page_size,
            administration_id, from_date, to_date.

    Returns:
        Dict with count, next, previous, results.
    """
    page = params.get("page", 1)
    page_size = params.get("page_size", 20)
    administration_id = params.get("administration_id")

    # No pinned monitoring form → resolve each question's latest answer
    # across every monitoring form in the family via mv_cross_form_latest.
    if not monitoring_form_id:
        return _handle_escalation_cross_form(
            parent_form, criteria, columns, params,
        )

    date_filters = build_date_filters(params)

    parents = FormData.objects.filter(
        form=parent_form,
        parent__isnull=True,
        is_pending=False,
        is_draft=False,
    ).annotate(
        latest_id=get_latest_monitoring_subquery(
            monitoring_form_id, date_filters or None
        ),
    ).filter(latest_id__isnull=False)

    if administration_id:
        parents = apply_administration_filter(
            parents, administration_id
        )

    # Optional AND-narrowing criteria (shared grammar with /values)
    # applied on top of the OR-escalation criteria. Split by form so
    # parent-form filters (e.g. implementing_agency) go through
    # apply_parent_criteria_to_qs while monitoring-form filters go
    # through apply_criteria_to_monitoring_qs.
    filter_criteria = params.get("filter_criteria")
    if filter_criteria:
        mon_criteria, parent_criteria = split_criteria_by_form(
            filter_criteria, monitoring_form_id, parent_form.id,
        )
        parents = apply_criteria_to_monitoring_qs(
            parents, True, mon_criteria,
        )
        parents = apply_parent_criteria_to_qs(
            parents, True, parent_criteria,
        )

    latest_ids = list(
        parents.values_list("latest_id", flat=True)
    )

    or_condition = build_escalation_criteria_filter(
        criteria, latest_ids
    )
    matching = parents.filter(or_condition).order_by("id")

    total = matching.count()
    start = (page - 1) * page_size
    end = start + page_size
    paginated = list(
        matching[start:end].select_related("administration")
    )

    caches = build_column_caches(paginated, columns)

    results = []
    for parent in paginated:
        row = {"id": parent.id}
        for col in columns:
            row[col["key"]] = extract_column_value(
                parent, parent.latest_id, col, caches,
            )
        results.append(row)

    base_params = _escalation_base_params(
        params, monitoring_form_id, page_size, administration_id,
    )
    return _escalation_response(
        total, results, page, page_size, end, base_params,
    )


def _escalation_base_params(
    params, monitoring_form_id, page_size, administration_id,
):
    """Build the querystring params used for next/previous page links."""
    query_string = params.get("query_string")
    if query_string:
        return [(k, v) for k, v in query_string if k != "page"]
    base = []
    if monitoring_form_id:
        base.append(("monitoring_form_id", monitoring_form_id))
    base.append(("page_size", page_size))
    if administration_id:
        base.append(("administration_id", administration_id))
    for key in ("from_date", "to_date", "date_question_name"):
        if params.get(key):
            base.append((key, params[key]))
    return base


def _escalation_response(total, results, page, page_size, end, base_params):
    """Assemble the paginated escalation response with page links."""
    def build_link(target_page):
        link_params = base_params + [("page", target_page)]
        return f"?{urlencode(link_params, doseq=True)}"

    return {
        "count": total,
        "next": build_link(page + 1) if end < total else None,
        "previous": build_link(page - 1) if page > 1 else None,
        "results": results,
    }


def _split_filter_criteria_registration(criteria, parent_form_id):
    """For the cross-form path, split AND-narrowing filter criteria into
    (monitoring, registration): a question defined on the registration form
    narrows the parents directly; anything else narrows via cross-form
    latest."""
    if not criteria:
        return None, None
    qnames = {c["parts"][0] for c in criteria}
    on_parent = set(
        Questions.objects.filter(
            name__in=qnames, form_id=parent_form_id,
        ).values_list("name", flat=True)
    )
    parent = [c for c in criteria if c["parts"][0] in on_parent]
    mon = [c for c in criteria if c["parts"][0] not in on_parent]
    return (mon or None), (parent or None)


def _cross_form_and_narrow(criteria, parent_ids, parent_form_id):
    """AND-narrow parent_ids by monitoring filter criteria, resolving each
    question's latest answer across forms via mv_cross_form_latest."""
    keep = set(parent_ids)
    base = MVCrossFormLatest.objects.filter(
        parent_id__in=parent_ids, parent_form_id=parent_form_id,
    )
    for c in criteria:
        ctype = c["type"]
        parts = c["parts"]
        q = base.filter(question_name=parts[0])
        if ctype in ("option_equals", "option_contains"):
            q = q.filter(latest_option_values__contains=[parts[1]])
        elif ctype == "option_in":
            values = parts[1] if isinstance(parts[1], list) else [parts[1]]
            sub = Q()
            for v in values:
                sub |= Q(latest_option_values__contains=[v])
            q = q.filter(sub)
        elif ctype == "threshold_gt":
            q = q.filter(latest_numeric_value__gt=float(parts[1]))
        elif ctype == "threshold_lt":
            q = q.filter(latest_numeric_value__lt=float(parts[1]))
        else:
            continue
        keep &= set(q.values_list("parent_id", flat=True))
    return keep


def build_cross_form_escalation_filter(criteria, parent_ids, parent_form_id):
    """OR-match parents using mv_cross_form_latest (no pinned monitoring
    form). Each criterion resolves the latest answer per
    (parent, question_name) across every monitoring form in the family.

    Returns the set of matching parent (registration) ids.
    """
    matched = set()
    base = MVCrossFormLatest.objects.filter(
        parent_id__in=parent_ids, parent_form_id=parent_form_id,
    )
    today = date.today().isoformat()
    for criterion in criteria:
        ctype = criterion["type"]
        parts = criterion["parts"]

        if ctype == "option_equals":
            ids = base.filter(
                question_name=parts[0],
                latest_option_values__contains=[parts[1]],
            ).values_list("parent_id", flat=True)
            matched |= set(ids)

        elif ctype == "threshold_gt":
            ids = base.filter(
                question_name=parts[0],
                latest_numeric_value__gt=float(parts[1]),
            ).values_list("parent_id", flat=True)
            matched |= set(ids)

        elif ctype == "threshold_lt":
            ids = base.filter(
                question_name=parts[0],
                latest_numeric_value__lt=float(parts[1]),
            ).values_list("parent_id", flat=True)
            matched |= set(ids)

        elif ctype == "overdue":
            completion_qname = parts[0]
            deadline_qname = parts[1]
            incomplete_value = parts[2] if len(parts) > 2 else "no"
            mode = parts[3] if len(parts) > 3 else "option"
            comp = base.filter(question_name=completion_qname)
            if mode == "lt":
                comp = comp.filter(
                    latest_numeric_value__lt=float(incomplete_value)
                )
            else:
                comp = comp.filter(
                    latest_option_values__contains=[incomplete_value]
                )
            incomplete = set(comp.values_list("parent_id", flat=True))
            overdue = set(
                base.filter(
                    question_name=deadline_qname,
                    latest_text_value__lt=today,
                ).values_list("parent_id", flat=True)
            )
            matched |= incomplete & overdue

    return matched


def build_cross_form_column_caches(paginated, columns, parent_form_id):
    """Column caches for the cross-form path, keyed by parent id.

    Monitoring answers (source answer / latest_date) come from
    mv_cross_form_latest; registration answers (parent_answer) from
    mv_answer_denormalized on the registration datapoint itself. The
    returned shape matches build_column_caches so extract_column_value can
    be reused (passing parent.id as the latest_id key)."""
    parent_ids = [p.id for p in paginated]

    answer_qnames = set()
    parent_answer_qnames = set()
    latest_date_qnames = set()
    for c in columns:
        src = c["source"]
        qname = c.get("question_name")
        if src == "answer" and qname:
            answer_qnames.add(qname)
        elif src == "parent_answer" and qname:
            parent_answer_qnames.add(qname)
        elif src == "latest_date" and qname:
            latest_date_qnames.add(qname)

    answer_map = {}
    mon_qnames = answer_qnames | latest_date_qnames
    if mon_qnames:
        rows = MVCrossFormLatest.objects.filter(
            parent_id__in=parent_ids,
            parent_form_id=parent_form_id,
            question_name__in=mon_qnames,
        ).values(
            "parent_id", "question_name",
            "latest_text_value", "latest_numeric_value",
            "latest_option_values",
        )
        for r in rows:
            answer_map[(r["parent_id"], r["question_name"])] = {
                "name": r["latest_text_value"],
                "value": r["latest_numeric_value"],
                "options": r["latest_option_values"],
            }

    parent_answer_map = {}
    if parent_answer_qnames:
        rows = MVAnswerDenormalized.objects.filter(
            data_id__in=parent_ids,
            question_name__in=parent_answer_qnames,
        ).values(
            "data_id", "question_name",
            "answer_name", "answer_value", "answer_options",
        )
        for r in rows:
            parent_answer_map[(r["data_id"], r["question_name"])] = {
                "name": r["answer_name"],
                "value": r["answer_value"],
                "options": r["answer_options"],
            }

    return {
        "answer": answer_map,
        "parent_answer": parent_answer_map,
        "created": {},
    }


def _handle_escalation_cross_form(parent_form, criteria, columns, params):
    """Escalation without a pinned monitoring form.

    Resolves each question's latest answer across every monitoring form in
    the family via mv_cross_form_latest, so a table need not name a specific
    monitoring form. Registration columns/filters still key on the parent
    datapoint."""
    page = params.get("page", 1)
    page_size = params.get("page_size", 20)
    administration_id = params.get("administration_id")

    parents = FormData.objects.filter(
        form=parent_form,
        parent__isnull=True,
        is_pending=False,
        is_draft=False,
    )
    if administration_id:
        parents = apply_administration_filter(parents, administration_id)

    filter_criteria = params.get("filter_criteria")
    if filter_criteria:
        mon_criteria, parent_criteria = (
            _split_filter_criteria_registration(
                filter_criteria, parent_form.id,
            )
        )
        parents = apply_parent_criteria_to_qs(
            parents, False, parent_criteria,
        )
        if mon_criteria:
            pids = list(parents.values_list("id", flat=True))
            keep = _cross_form_and_narrow(
                mon_criteria, pids, parent_form.id,
            )
            parents = parents.filter(id__in=keep)

    parent_ids = list(parents.values_list("id", flat=True))
    matched = build_cross_form_escalation_filter(
        criteria, parent_ids, parent_form.id,
    )
    matching = parents.filter(id__in=matched).order_by("id")

    total = matching.count()
    start = (page - 1) * page_size
    end = start + page_size
    paginated = list(
        matching[start:end].select_related("administration")
    )

    caches = build_cross_form_column_caches(
        paginated, columns, parent_form.id,
    )

    results = []
    for parent in paginated:
        row = {"id": parent.id}
        for col in columns:
            row[col["key"]] = extract_column_value(
                parent, parent.id, col, caches,
            )
        results.append(row)

    base_params = _escalation_base_params(
        params, None, page_size, administration_id,
    )
    return _escalation_response(
        total, results, page, page_size, end, base_params,
    )
