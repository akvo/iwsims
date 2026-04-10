from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_visualization.functions import (
    apply_administration_filter,
    latest_monitoring_subquery,
)


def compute_any_yes(latest_data_id, question_ids, **kwargs):
    """100% if ANY listed question answered 'Yes'."""
    has_yes = Answers.objects.filter(
        data_id=latest_data_id,
        question_id__in=question_ids,
        options__contains=["yes"],
    ).exists()
    return 100.0 if has_yes else 0.0


def compute_completed_binary(
    latest_data_id, question_ids, **kwargs
):
    """100% if answered 'Completed'."""
    is_completed = Answers.objects.filter(
        data_id=latest_data_id,
        question_id__in=question_ids,
        options__contains=["completed"],
    ).exists()
    return 100.0 if is_completed else 0.0


def compute_ratio(latest_data_id, question_ids, **kwargs):
    """Value as percentage (numeric answer)."""
    answer = Answers.objects.filter(
        data_id=latest_data_id,
        question_id__in=question_ids,
        value__isnull=False,
    ).first()
    if not answer or answer.value is None:
        return 0.0
    return float(answer.value)


def compute_multi_select_proportion(
    latest_data_id, question_ids,
    total_items=1, **kwargs
):
    """Percentage based on number of selected options."""
    answer = Answers.objects.filter(
        data_id=latest_data_id,
        question_id__in=question_ids,
    ).first()
    if not answer or not answer.options:
        return 0.0
    return round(
        (len(answer.options) / total_items) * 100, 2
    )


FORMULA_HANDLERS = {
    "any_yes": compute_any_yes,
    "completed_binary": compute_completed_binary,
    "ratio": compute_ratio,
    "multi_select_proportion": (
        compute_multi_select_proportion
    ),
}


def compute_component_scores(latest_id, components):
    """Compute progress scores for all components."""
    scores = {}
    for comp in components:
        handler = FORMULA_HANDLERS[comp["formula"]]
        kwargs = {}
        if comp.get("total_items"):
            kwargs["total_items"] = comp["total_items"]
        scores[comp["key"]] = handler(
            latest_id,
            comp["question_ids"],
            **kwargs,
        )
    return scores


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

    # Optional filter by latest monitoring option value
    if filter_qid and filter_value:
        latest_ids = parents.values_list(
            "latest_id", flat=True
        )
        matching_ids = Answers.objects.filter(
            data_id__in=latest_ids,
            question_id=filter_qid,
            options__contains=[filter_value],
        ).values_list("data_id", flat=True)
        parents = parents.filter(
            latest_id__in=matching_ids
        )

    # Compute scores per parent
    eps_results = []
    for parent in parents:
        scores = compute_component_scores(
            parent.latest_id, components
        )
        overall = (
            round(sum(scores.values()) / len(scores), 2)
            if scores else 0.0
        )
        eps_results.append({
            "label": parent.name,
            "group": str(parent.id),
            "components": scores,
            "overall": overall,
        })

    histogram = build_histogram(eps_results)

    return {
        "histogram": histogram,
        "details": eps_results,
    }
