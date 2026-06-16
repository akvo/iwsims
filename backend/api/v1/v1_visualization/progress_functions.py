from api.v1.v1_data.models import FormData
from api.v1.v1_visualization.functions import (
    apply_administration_filter,
    apply_administration_filter_mv,
    apply_criteria_to_monitoring_qs,
    apply_parent_criteria_to_qs,
    build_date_filters,
    get_latest_monitoring_subquery,
    narrow_data_ids_by_criteria,
)
from api.v1.v1_visualization.models import (
    MVAnswerDenormalized,
    MVLatestMonitoring,
)


def compute_any_yes(latest_data_id, question_ids, answers_map, **kwargs):
    """100% if ANY listed question answered 'Yes'."""
    for qid in question_ids:
        a = answers_map.get((latest_data_id, qid))
        if a and a.get("options") and "yes" in a["options"]:
            return 100.0
    return 0.0


def compute_completed_binary(
    latest_data_id, question_ids, answers_map, **kwargs
):
    """100% if answered 'Completed'."""
    for qid in question_ids:
        a = answers_map.get((latest_data_id, qid))
        if a and a.get("options") and "completed" in a["options"]:
            return 100.0
    return 0.0


def compute_ratio(
    latest_data_id, question_ids, answers_map, **kwargs
):
    """(Implemented / Planned) * 100, clamped to [0, 100].

    Expects question_ids = [implemented_qid, planned_qid].
    Returns 0.0 if either value is missing or planned <= 0.
    """
    if len(question_ids) < 2:
        return 0.0
    implemented_qid, planned_qid = question_ids[0], question_ids[1]
    impl_row = answers_map.get((latest_data_id, implemented_qid))
    plan_row = answers_map.get((latest_data_id, planned_qid))
    implemented = impl_row.get("value") if impl_row else None
    planned = plan_row.get("value") if plan_row else None
    if implemented is None or planned is None:
        return 0.0
    try:
        planned = float(planned)
        implemented = float(implemented)
    except (TypeError, ValueError):
        return 0.0
    if planned <= 0:
        return 0.0
    return round(min((implemented / planned) * 100, 100.0), 2)


def compute_multi_select_proportion(
    latest_data_id, question_ids, answers_map,
    total_items=1, **kwargs
):
    """Percentage based on number of selected options."""
    selected = None
    for qid in question_ids:
        a = answers_map.get((latest_data_id, qid))
        if a and a.get("options"):
            selected = a["options"]
            break
    if not selected:
        return 0.0
    if not total_items or total_items <= 0:
        return 0.0
    pct = (len(selected) / total_items) * 100
    return round(min(pct, 100.0), 2)


FORMULA_HANDLERS = {
    "any_yes": compute_any_yes,
    "completed_binary": compute_completed_binary,
    "ratio": compute_ratio,
    "multi_select_proportion": (
        compute_multi_select_proportion
    ),
}


def filter_components_by_scope(components, scope_value):
    """Filter components to those applicable for a scope value.

    If scope_value is None or a component has no applicable_types,
    the component is always included.
    """
    if not scope_value:
        return components
    return [
        c for c in components
        if not c.get("applicable_types")
        or scope_value in c["applicable_types"]
    ]


def compute_component_scores(
    latest_id, components, answers_map, scope_value=None,
):
    """Compute progress scores for applicable components."""
    active = filter_components_by_scope(components, scope_value)
    scores = {}
    for comp in active:
        handler = FORMULA_HANDLERS[comp["formula"]]
        kwargs = {}
        if comp.get("total_items"):
            kwargs["total_items"] = comp["total_items"]
        scores[comp["key"]] = handler(
            latest_id,
            comp["question_ids"],
            answers_map,
            **kwargs,
        )
    return scores


def build_progress_answers_map(latest_ids, components):
    """Bulk-fetch answers needed to score all components for all parents.

    Returns dict keyed by (data_id, question_id) carrying the fields
    formula handlers read (options, value).
    """
    qids = {
        q for c in components for q in c.get("question_ids", [])
    }
    if not qids or not latest_ids:
        return {}
    rows = MVAnswerDenormalized.objects.filter(
        data_id__in=latest_ids,
        question_id__in=qids,
    ).values(
        "data_id", "question_id",
        "answer_options", "answer_value",
    )
    return {
        (r["data_id"], r["question_id"]): {
            "options": r["answer_options"],
            "value": r["answer_value"],
        }
        for r in rows
    }


def build_histogram(eps_results):
    """Bucket overall progress into 10% ranges.

    Returns list of 10 buckets, each with progress label
    and count.
    """
    buckets = [
        "0-10%", "11-20%", "21-30%", "31-40%", "41-50%",
        "51-60%", "61-70%", "71-80%", "81-90%", "91-100%",
    ]
    counts = [0] * 10
    for eps in eps_results:
        overall = eps["overall"]
        if overall <= 0:
            idx = 0
        else:
            idx = min(max(0, int(overall - 1) // 10), 9)
        counts[idx] += 1
    return [
        {"progress": buckets[i], "count": counts[i]}
        for i in range(10)
    ]


def handle_progress(
    parent_form, monitoring_form_id,
    components, params,
):
    """Handle progress query.

    Uses mv_latest_monitoring as the primary queryset when no date
    filters are set — the MV has parent_id, parent_name and
    latest_data_id pre-joined so no FormData outer query is needed.

    Falls back to FormData + correlated subquery when date_filters is
    set: the MV stores the absolute latest monitoring, not the most
    recent within a date range.

    Args:
        parent_form: Registration form instance.
        monitoring_form_id: Monitoring form ID.
        components: Parsed component list with
            key/formula/question_ids/total_items.
        params: Dict with filter_question_id,
            filter_option_value, administration_id,
            from_date, to_date, date_question_id.

    Returns:
        Dict with histogram and details.
    """
    administration_id = params.get("administration_id")
    filter_qid = params.get("filter_question_id")
    filter_value = params.get("filter_option_value")
    criteria = params.get("criteria")
    parent_criteria = params.get("parent_criteria")
    scope_qid = params.get("scope_question_id")

    date_filters = build_date_filters(params)

    if not date_filters:
        # MV path: single indexed lookup, no FormData join needed.
        # The mixin always refreshes MVs in setUp, so this path also
        # works correctly inside TestCase transactions.
        mv_qs = MVLatestMonitoring.objects.filter(
            form_id=monitoring_form_id
        )

        if administration_id:
            mv_qs = apply_administration_filter_mv(
                mv_qs, administration_id,
                'parent_administration_id',
            )

        if criteria:
            ids = list(
                mv_qs.values_list("latest_data_id", flat=True)
            )
            narrowed = narrow_data_ids_by_criteria(ids, criteria)
            mv_qs = mv_qs.filter(latest_data_id__in=narrowed)

        if parent_criteria:
            pids = list(
                mv_qs.values_list("parent_id", flat=True)
            )
            narrowed = narrow_data_ids_by_criteria(
                pids, parent_criteria
            )
            mv_qs = mv_qs.filter(parent_id__in=narrowed)

        if filter_qid and filter_value:
            matching = MVAnswerDenormalized.objects.filter(
                data_id__in=mv_qs.values("latest_data_id"),
                question_id=filter_qid,
                answer_options__contains=[filter_value],
            ).values_list("data_id", flat=True)
            mv_qs = mv_qs.filter(latest_data_id__in=matching)

        parents_data = list(
            mv_qs.values("parent_id", "parent_name", "latest_data_id")
        )
        latest_ids = [p["latest_data_id"] for p in parents_data]

    else:
        # FormData fallback for date-filtered queries.
        # The correlated subquery finds the most recent submission
        # WITHIN the date range — semantics the MV cannot provide.
        fd_qs = FormData.objects.filter(
            form=parent_form,
            parent__isnull=True,
            is_pending=False,
            is_draft=False,
        ).annotate(
            latest_id=get_latest_monitoring_subquery(
                monitoring_form_id, date_filters
            ),
        ).filter(latest_id__isnull=False)

        if administration_id:
            fd_qs = apply_administration_filter(
                fd_qs, administration_id
            )

        fd_qs = apply_criteria_to_monitoring_qs(
            fd_qs, True, criteria,
        )
        fd_qs = apply_parent_criteria_to_qs(
            fd_qs, True, parent_criteria,
        )

        if filter_qid and filter_value:
            matching = MVAnswerDenormalized.objects.filter(
                data_id__in=fd_qs.values("latest_id"),
                question_id=filter_qid,
                answer_options__contains=[filter_value],
            ).values_list("data_id", flat=True)
            fd_qs = fd_qs.filter(latest_id__in=matching)

        parents_data = [
            {
                "parent_id": p.id,
                "parent_name": p.name,
                "latest_data_id": p.latest_id,
            }
            for p in fd_qs.only("id", "name")
        ]
        latest_ids = [p["latest_data_id"] for p in parents_data]

    answers_map = build_progress_answers_map(latest_ids, components)

    scope_map = {}
    if scope_qid:
        scope_rows = MVAnswerDenormalized.objects.filter(
            data_id__in=latest_ids,
            question_id=scope_qid,
        ).values("data_id", "answer_options")
        for row in scope_rows:
            opts = row.get("answer_options") or []
            if opts:
                scope_map[row["data_id"]] = opts[0]

    eps_results = []
    for parent in parents_data:
        scope_value = scope_map.get(parent["latest_data_id"])
        scores = compute_component_scores(
            parent["latest_data_id"], components, answers_map,
            scope_value=scope_value,
        )
        overall = (
            round(sum(scores.values()) / len(scores), 2)
            if scores else 0.0
        )
        eps_results.append({
            "label": parent["parent_name"],
            "group": str(parent["parent_id"]),
            "components": scores,
            "overall": overall,
        })

    histogram = build_histogram(eps_results)
    return {"histogram": histogram, "details": eps_results}
