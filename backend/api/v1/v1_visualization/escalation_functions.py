from urllib.parse import urlencode

from django.db.models import Q

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_visualization.functions import (
    apply_administration_filter,
    latest_monitoring_subquery,
    format_date_group,
)


def build_escalation_criteria_filter(criteria, latest_ids):
    """Build OR query from parsed escalation criteria.

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
            qid = int(parts[0])
            value = parts[1]
            matching = Answers.objects.filter(
                data_id__in=latest_ids,
                question_id=qid,
                options__contains=[value],
            ).values_list("data_id", flat=True)
            or_condition |= Q(latest_id__in=matching)

        elif ctype == "threshold_gt":
            qid = int(parts[0])
            threshold = float(parts[1])
            matching = Answers.objects.filter(
                data_id__in=latest_ids,
                question_id=qid,
                value__gt=threshold,
            ).values_list("data_id", flat=True)
            or_condition |= Q(latest_id__in=matching)

        elif ctype == "threshold_lt":
            qid = int(parts[0])
            threshold = float(parts[1])
            matching = Answers.objects.filter(
                data_id__in=latest_ids,
                question_id=qid,
                value__lt=threshold,
            ).values_list("data_id", flat=True)
            or_condition |= Q(latest_id__in=matching)

        elif ctype == "overdue":
            from datetime import date
            completion_qid = int(parts[0])
            deadline_qid = int(parts[1])
            incomplete = set(Answers.objects.filter(
                data_id__in=latest_ids,
                question_id=completion_qid,
                options__contains=["no"],
            ).values_list("data_id", flat=True))
            overdue = set(Answers.objects.filter(
                data_id__in=latest_ids,
                question_id=deadline_qid,
                name__lt=date.today().isoformat(),
            ).values_list("data_id", flat=True))
            or_condition |= Q(
                latest_id__in=incomplete & overdue
            )

    return or_condition


def extract_column_value(parent, latest_id, col):
    """Extract a column value for a single parent row.

    Args:
        parent: Parent FormData instance (with
            latest_id annotation).
        latest_id: The latest monitoring data ID.
        col: Parsed column dict with 'key', 'source',
            and optional 'question_id'.

    Returns:
        The extracted value for this column.
    """
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
        qid = col.get("question_id")
        if not qid:
            return None
        answer = Answers.objects.filter(
            data_id=latest_id,
            question_id=qid,
        ).first()
        if not answer:
            return None
        if answer.options:
            return (
                answer.options[0]
                if answer.options else None
            )
        if answer.value is not None:
            return answer.value
        return answer.name

    if source == "parent_answer":
        qid = col.get("question_id")
        if not qid:
            return None
        answer = Answers.objects.filter(
            data_id=parent.id,
            question_id=qid,
        ).first()
        if not answer:
            return None
        if answer.options:
            return (
                answer.options[0]
                if answer.options else None
            )
        if answer.value is not None:
            return answer.value
        return answer.name

    if source == "latest_date":
        qid = col.get("question_id")
        if qid:
            answer = Answers.objects.filter(
                data_id=latest_id,
                question_id=qid,
            ).first()
            if answer and answer.name:
                return format_date_group(answer.name)
        fd = FormData.objects.filter(
            id=latest_id,
        ).values("created").first()
        if fd:
            return format_date_group(fd["created"])
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

    date_filters = {}
    if params.get("from_date"):
        date_filters["from_date"] = params["from_date"]
    if params.get("to_date"):
        date_filters["to_date"] = params["to_date"]
    if params.get("date_question_id"):
        date_filters["date_question_id"] = (
            params["date_question_id"]
        )

    parents = FormData.objects.filter(
        form=parent_form,
        parent__isnull=True,
        is_pending=False,
        is_draft=False,
    ).annotate(
        latest_id=latest_monitoring_subquery(
            monitoring_form_id, date_filters or None
        ),
    ).filter(latest_id__isnull=False)

    if administration_id:
        parents = apply_administration_filter(
            parents, administration_id
        )

    latest_ids = list(
        parents.values_list("latest_id", flat=True)
    )

    or_condition = build_escalation_criteria_filter(
        criteria, latest_ids
    )
    matching = parents.filter(or_condition)

    total = matching.count()
    start = (page - 1) * page_size
    end = start + page_size
    paginated = matching[start:end]

    results = []
    for parent in paginated:
        row = {"id": parent.id}
        for col in columns:
            row[col["key"]] = extract_column_value(
                parent, parent.latest_id, col
            )
        results.append(row)

    query_string = params.get("query_string")
    if query_string:
        base_params = [
            (k, v) for k, v in query_string
            if k != "page"
        ]
    else:
        base_params = [
            ("monitoring_form_id", monitoring_form_id),
            ("page_size", page_size),
        ]
        if administration_id:
            base_params.append(
                ("administration_id", administration_id)
            )
        for key in ("from_date", "to_date", "date_question_id"):
            if params.get(key):
                base_params.append((key, params[key]))

    def build_link(target_page):
        link_params = base_params + [("page", target_page)]
        return f"?{urlencode(link_params, doseq=True)}"

    return {
        "count": total,
        "next": build_link(page + 1) if end < total else None,
        "previous": build_link(page - 1) if page > 1 else None,
        "results": results,
    }
