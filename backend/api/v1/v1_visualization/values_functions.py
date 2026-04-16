from collections import defaultdict

from django.db.models import Count, Avg, F, OuterRef, Subquery
from django.db.models.functions import TruncMonth, Substr

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import QuestionOptions
from api.v1.v1_visualization.constants import AGG_FUNCS
from api.v1.v1_visualization.functions import (
    get_base_monitoring_qs,
    get_monitoring_data_ids,
    format_month_label,
    format_month_group,
    format_date_group,
    fill_month_gaps,
    fill_date_gaps,
)


def _should_fill_gaps(params):
    """Only gap-fill when both from_date and to_date are provided."""
    return bool(
        params.get("from_date") and params.get("to_date")
    )


# -- Count mode handler --

def handle_count_mode(form, params):
    """Handle count mode (no question_id)."""
    form_id = form.id
    monitoring = params.get("monitoring", "latest")
    group_by = params.get("group_by")
    value_type = params.get("value_type", "number")
    sum_by = params.get("sum_by")
    is_monitoring = form.parent is not None

    if is_monitoring and monitoring == "latest" \
            and sum_by == "parent_id":
        qs, is_latest, _ = get_base_monitoring_qs(
            form, form_id, params
        )
        count = qs.count()
        if value_type == "percentage":
            total = FormData.objects.filter(
                form=form.parent,
                parent__isnull=True,
                is_pending=False,
                is_draft=False,
            ).count()
            value = round(
                (count / total * 100), 2
            ) if total > 0 else 0
        else:
            value = count
        return (
            [{"value": value, "label": "Total"}],
            ["Total"],
        )

    qs, is_latest, _ = get_base_monitoring_qs(
        form, form_id, params
    )

    if not group_by:
        count = qs.count()
        if value_type == "percentage" and is_monitoring:
            total = FormData.objects.filter(
                form=form.parent,
                parent__isnull=True,
                is_pending=False,
                is_draft=False,
            ).count()
            value = round(
                (count / total * 100), 2
            ) if total > 0 else 0
        else:
            value = count
        return (
            [{"value": value, "label": "Total"}],
            ["Total"],
        )

    if group_by == "month":
        return _count_group_by_month(qs, is_latest, params)

    if group_by == "parent_id":
        return _count_group_by_parent(qs, is_latest)

    if group_by == "id":
        return _count_group_by_id(qs, is_latest)

    if group_by == "date":
        return _count_group_by_date(qs, is_latest, params)

    return [{"value": 0, "label": "Total"}], ["Total"]


def _count_group_by_month(qs, is_latest, params):
    """Count grouped by month."""
    date_qid = params.get("date_question_id")

    if is_latest:
        data_ids = get_monitoring_data_ids(qs, is_latest)
        if date_qid:
            answer_qs = Answers.objects.filter(
                data_id__in=data_ids,
                question_id=date_qid,
                name__isnull=False,
            )
            results = answer_qs.annotate(
                year_month=Substr("name", 1, 7),
            ).values("year_month").annotate(
                count=Count("data_id", distinct=True),
            ).order_by("year_month")
            data = [
                {
                    "value": r["count"],
                    "label": format_month_label(
                        r["year_month"]
                    ),
                    "group": r["year_month"],
                }
                for r in results
            ]
        else:
            results = FormData.objects.filter(
                id__in=data_ids,
            ).annotate(
                month=TruncMonth("created"),
            ).values("month").annotate(
                count=Count("id"),
            ).order_by("month")
            data = [
                {
                    "value": r["count"],
                    "label": format_month_label(r["month"]),
                    "group": format_month_group(r["month"]),
                }
                for r in results
            ]
    else:
        if date_qid:
            answer_qs = Answers.objects.filter(
                data__in=qs,
                question_id=date_qid,
                name__isnull=False,
            )
            results = answer_qs.annotate(
                year_month=Substr("name", 1, 7),
            ).values("year_month").annotate(
                count=Count("data_id", distinct=True),
            ).order_by("year_month")
            data = [
                {
                    "value": r["count"],
                    "label": format_month_label(
                        r["year_month"]
                    ),
                    "group": r["year_month"],
                }
                for r in results
            ]
        else:
            results = qs.annotate(
                month=TruncMonth("created"),
            ).values("month").annotate(
                count=Count("id"),
            ).order_by("month")
            data = [
                {
                    "value": r["count"],
                    "label": format_month_label(r["month"]),
                    "group": format_month_group(r["month"]),
                }
                for r in results
            ]

    if _should_fill_gaps(params):
        data = fill_month_gaps(
            data, params["from_date"], params["to_date"]
        )
    labels = [d["label"] for d in data]
    return data, labels


def _count_group_by_parent(qs, is_latest):
    """Count grouped by parent_id."""
    if is_latest:
        data = [
            {
                "value": 1,
                "label": p.name,
                "group": str(p.id),
            }
            for p in qs.only("id", "name")
        ]
    else:
        results = qs.filter(
            parent__isnull=False,
        ).values(
            "parent_id",
            parent_name=F("parent__name"),
        ).annotate(
            count=Count("id"),
        ).order_by("parent_name")
        data = [
            {
                "value": r["count"],
                "label": r["parent_name"],
                "group": str(r["parent_id"]),
            }
            for r in results
        ]
    labels = [d["label"] for d in data]
    return data, labels


def _count_group_by_id(qs, is_latest):
    """Count grouped by individual record id (value=1 per row)."""
    if is_latest:
        data = [
            {
                "value": 1,
                "label": p.name,
                "group": str(p.latest_id),
            }
            for p in qs.only("id", "name")
        ]
    else:
        data = [
            {
                "value": 1,
                "label": r.name,
                "group": str(r.id),
            }
            for r in qs.only("id", "name").order_by("id")
        ]
    labels = [d["label"] for d in data]
    return data, labels


def _count_group_by_date(qs, is_latest, params):
    """Count grouped by individual date (not month bucket)."""
    date_qid = params.get("date_question_id")
    data_ids = get_monitoring_data_ids(qs, is_latest)

    if date_qid:
        results = Answers.objects.filter(
            data_id__in=data_ids,
            question_id=date_qid,
            name__isnull=False,
        ).annotate(
            day=Substr("name", 1, 10),
        ).values("day").annotate(
            count=Count("data_id", distinct=True),
        ).order_by("day")
        data = [
            {
                "value": r["count"],
                "label": r["day"],
                "group": r["day"],
            }
            for r in results
        ]
    else:
        results = FormData.objects.filter(
            id__in=data_ids,
        ).values(
            day=F("created__date"),
        ).annotate(
            count=Count("id"),
        ).order_by("day")
        data = [
            {
                "value": r["count"],
                "label": format_date_group(r["day"]),
                "group": format_date_group(r["day"]),
            }
            for r in results
        ]
    if _should_fill_gaps(params):
        data = fill_date_gaps(
            data, params["from_date"], params["to_date"]
        )
    labels = [d["label"] for d in data]
    return data, labels


# -- Option question handler --

def handle_option_question(form, question, params):
    """Handle option/multiple_option questions."""
    form_id = form.id
    group_by = params.get("group_by")
    option_value = params.get("option_value")
    sum_by = params.get("sum_by")
    value_type = params.get("value_type", "number")
    stack_by = params.get("stack_by")

    qs, is_latest, _ = get_base_monitoring_qs(
        form, form_id, params
    )
    data_ids = get_monitoring_data_ids(qs, is_latest)

    options = QuestionOptions.objects.filter(
        question=question,
    ).order_by("order")

    if option_value and group_by == "month":
        return _option_value_group_by_month(
            question, data_ids, option_value, sum_by, params
        )

    if option_value:
        return _option_value_filter(
            question, data_ids, qs, is_latest,
            option_value, sum_by, value_type
        )

    if stack_by == "option" and group_by:
        return handle_stack_by_option(
            question, options, data_ids,
            qs, is_latest, params
        )

    if group_by == "option":
        restricted = _extract_criteria_option_values(
            params, question.id
        )
        return _option_group_by_option(
            question, options, data_ids, qs,
            is_latest, value_type, restricted
        )

    return [], []


def _option_value_filter(
    question, data_ids, qs, is_latest,
    option_value, sum_by, value_type
):
    """Filter by specific option value and count."""
    count = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        options__contains=[option_value],
    )
    if sum_by == "parent_id":
        count = count.values(
            "data__parent_id"
        ).distinct().count()
    else:
        count = count.count()

    if value_type == "percentage":
        total = qs.count() if is_latest else len(data_ids)
        value = round(
            (count / total * 100), 2
        ) if total > 0 else 0
    else:
        value = count

    return (
        [{"value": value, "label": option_value}],
        [option_value],
    )


def _option_value_group_by_month(
    question, data_ids, option_value, sum_by, params
):
    """Filter by option_value, then bucket by month.

    Used by charts like "Proposed completion date": filter to
    incomplete projects (option_value='no') and bucket the count
    by a date question (e.g. project deadline). When `sum_by` is
    `parent_id`, counts distinct parents per month.
    """
    date_qid = params.get("date_question_id")

    matching_ids = list(Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        options__contains=[option_value],
    ).values_list("data_id", flat=True))

    if not matching_ids:
        data = []
    elif date_qid:
        answer_qs = Answers.objects.filter(
            data_id__in=matching_ids,
            question_id=date_qid,
            name__isnull=False,
        )
        if sum_by == "parent_id":
            answer_qs = answer_qs.annotate(
                year_month=Substr("name", 1, 7),
            ).values("year_month").annotate(
                count=Count(
                    "data__parent_id", distinct=True
                ),
            ).order_by("year_month")
        else:
            answer_qs = answer_qs.annotate(
                year_month=Substr("name", 1, 7),
            ).values("year_month").annotate(
                count=Count("data_id", distinct=True),
            ).order_by("year_month")
        data = [
            {
                "value": r["count"],
                "label": format_month_label(
                    r["year_month"]
                ),
                "group": r["year_month"],
            }
            for r in answer_qs
        ]
    else:
        fd_qs = FormData.objects.filter(
            id__in=matching_ids,
        ).annotate(
            month=TruncMonth("created"),
        ).values("month")
        if sum_by == "parent_id":
            fd_qs = fd_qs.annotate(
                count=Count("parent_id", distinct=True),
            ).order_by("month")
        else:
            fd_qs = fd_qs.annotate(
                count=Count("id"),
            ).order_by("month")
        data = [
            {
                "value": r["count"],
                "label": format_month_label(r["month"]),
                "group": format_month_group(r["month"]),
            }
            for r in fd_qs
        ]

    if _should_fill_gaps(params):
        data = fill_month_gaps(
            data, params["from_date"], params["to_date"]
        )
    labels = [d["label"] for d in data]
    return data, labels


def _extract_criteria_option_values(params, question_id):
    """Extract option values that criteria restricts for a given qid.

    When criteria includes option_equals/option_contains/option_in
    targeting the same question_id as the donut chart, the tally
    should only count those specific values — not every value in
    a multiple_option answer array. Returns None if no restriction.
    """
    all_criteria = list(params.get("criteria") or [])
    all_criteria.extend(params.get("parent_criteria") or [])
    values = set()
    for c in all_criteria:
        ctype = c["type"]
        parts = c["parts"]
        if parts[0] != question_id:
            continue
        if ctype in ("option_equals", "option_contains"):
            values.add(parts[1])
        elif ctype == "option_in":
            values.update(parts[1])
    return values or None


def _option_group_by_option(
    question, options, data_ids, qs,
    is_latest, value_type, restricted_values=None
):
    """Group by option values (donut chart).

    Returns a row for every defined option — including zero-count
    options — so pie/doughnut charts have stable legends and colors
    across refreshes and filter changes.

    When `restricted_values` is set (from a criteria filter on the
    same question), only those values are tallied — so a
    multiple_option record ["a", "b"] filtered by "a" counts only
    for "a", not "b".
    """
    option_values = {o.value for o in options}
    tally_values = (
        option_values & restricted_values
        if restricted_values else option_values
    )
    tallies = defaultdict(int)
    rows = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        options__isnull=False,
    ).values_list("options", flat=True)
    for opts in rows:
        for v in (opts or []):
            if v in tally_values:
                tallies[v] += 1

    counts = [tallies.get(opt.value, 0) for opt in options]
    total_for_pct = sum(counts)
    data = []
    for opt, count in zip(options, counts):
        if value_type == "percentage":
            val = round(
                (count / total_for_pct * 100), 2
            ) if total_for_pct > 0 else 0.0
        else:
            val = count
        data.append({
            "value": val,
            "label": opt.label,
            "group": opt.value,
            "color": opt.color,
        })
    labels = [d["label"] for d in data]
    return data, labels


# -- Number question handler --

def handle_number_question(form, question, params):
    """Handle number questions."""
    form_id = form.id
    group_by = params.get("group_by")
    repeat_agg = params.get("repeat_agg", "average")
    value_type = params.get("value_type", "number")
    stack_by = params.get("stack_by")

    qs, is_latest, _ = get_base_monitoring_qs(
        form, form_id, params
    )
    data_ids = get_monitoring_data_ids(qs, is_latest)
    agg_func = AGG_FUNCS.get(repeat_agg, Avg)

    if stack_by == "parent_id":
        return handle_stack_by_parent(
            question, qs, is_latest,
            data_ids, params
        )

    if group_by == "parent_id":
        return _number_group_by_parent(
            question, data_ids, agg_func, value_type
        )

    if group_by == "date":
        return _number_group_by_date(
            question, data_ids, params
        )

    if group_by == "month":
        return _number_group_by_month(
            question, data_ids, agg_func, value_type, params
        )

    result = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        value__isnull=False,
    ).aggregate(agg_value=agg_func("value"))

    value = (
        round(result["agg_value"], 2)
        if result["agg_value"] else 0
    )
    return [{"value": value, "label": "Total"}], ["Total"]


def _number_group_by_parent(
    question, data_ids, agg_func, value_type
):
    """Number question grouped by parent_id."""
    results = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        value__isnull=False,
    ).values(
        parent_name=F("data__parent__name"),
        parent_id=F("data__parent_id"),
    ).annotate(
        agg_value=agg_func("value"),
    ).order_by("parent_name")

    data = [
        {
            "value": round(r["agg_value"], 2),
            "label": r["parent_name"],
            "group": str(r["parent_id"]),
        }
        for r in results
    ]

    if value_type == "percentage":
        total = sum(d["value"] for d in data)
        if total > 0:
            for d in data:
                d["value"] = round(
                    d["value"] / total * 100, 2
                )

    labels = [d["label"] for d in data]
    return data, labels


def _number_group_by_date(question, data_ids, params):
    """Number question grouped by date."""
    repeat_agg = params.get("repeat_agg", "average")
    agg_func = AGG_FUNCS.get(repeat_agg, Avg)
    date_qid = params.get("date_question_id")

    if date_qid:
        data = []
        for data_id in data_ids:
            date_answer = Answers.objects.filter(
                data_id=data_id,
                question_id=date_qid,
            ).first()
            if not date_answer or not date_answer.name:
                continue
            val_result = Answers.objects.filter(
                data_id=data_id,
                question_id=question.id,
                value__isnull=False,
            ).aggregate(agg_value=agg_func("value"))
            if val_result["agg_value"] is not None:
                date_str = format_date_group(
                    date_answer.name
                )
                data.append({
                    "value": round(
                        val_result["agg_value"], 2
                    ),
                    "label": date_str,
                    "group": date_str,
                })
    else:
        results = Answers.objects.filter(
            data_id__in=data_ids,
            question_id=question.id,
            value__isnull=False,
        ).values(
            date=F("data__created__date"),
        ).annotate(
            agg_value=agg_func("value"),
        ).order_by("date")
        data = [
            {
                "value": round(r["agg_value"], 2),
                "label": format_date_group(r["date"]),
                "group": format_date_group(r["date"]),
            }
            for r in results
        ]

    data.sort(key=lambda x: x["group"])
    if _should_fill_gaps(params):
        data = fill_date_gaps(
            data, params["from_date"], params["to_date"]
        )
    labels = [d["label"] for d in data]
    return data, labels


def _number_group_by_month(
    question, data_ids, agg_func, value_type, params
):
    """Number question grouped by month.

    When date_question_id is provided, bucket by the month of that
    date answer (via a Subquery) instead of FormData.created so the
    x-axis aligns with the filter's date dimension.
    """
    date_qid = params.get("date_question_id")

    base = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        value__isnull=False,
    )

    if date_qid:
        date_sq = Answers.objects.filter(
            data_id=OuterRef("data_id"),
            question_id=date_qid,
            name__isnull=False,
        ).values("name")[:1]
        results = base.annotate(
            date_name=Subquery(date_sq),
        ).filter(
            date_name__isnull=False,
        ).annotate(
            month_key=Substr("date_name", 1, 7),
        ).values("month_key").annotate(
            agg_value=agg_func("value"),
        ).order_by("month_key")
        data = [
            {
                "value": round(r["agg_value"], 2),
                "label": format_month_label(r["month_key"]),
                "group": r["month_key"],
            }
            for r in results if r["agg_value"] is not None
        ]
    else:
        results = base.annotate(
            month=TruncMonth("data__created"),
        ).values("month").annotate(
            agg_value=agg_func("value"),
        ).order_by("month")
        data = [
            {
                "value": round(r["agg_value"], 2),
                "label": format_month_label(r["month"]),
                "group": format_month_group(r["month"]),
            }
            for r in results
        ]

    if value_type == "percentage":
        total = sum(d["value"] for d in data)
        if total > 0:
            for d in data:
                d["value"] = round(
                    d["value"] / total * 100, 2
                )

    if _should_fill_gaps(params):
        data = fill_month_gaps(
            data, params["from_date"], params["to_date"]
        )

    labels = [d["label"] for d in data]
    return data, labels


# -- Stack handlers --

def handle_stack_by_option(
    question, options, data_ids,
    qs, is_latest, params
):
    """Handle stack_by=option: stacked bar charts."""
    group_by = params.get("group_by")
    value_type = params.get("value_type", "number")

    opt_labels = [o.label for o in options]
    opt_colors = [o.color for o in options]

    if group_by == "month":
        return _stack_option_by_month(
            question, options, data_ids,
            opt_labels, opt_colors, value_type, params
        )

    if group_by == "parent_id":
        return _stack_option_by_parent(
            question, options, data_ids,
            qs, is_latest, opt_labels, opt_colors
        )

    return {
        "data": [], "labels": [],
        "stack_labels": [], "colors": [],
    }


def _stack_option_by_month(
    question, options, data_ids,
    opt_labels, opt_colors, value_type, params
):
    """Stack by option, grouped by month.

    Fetches answers once and buckets in Python — O(N) instead of
    O(months × options) queries. Honors date_question_id when
    provided so the month bucket aligns with the filter dimension.
    """
    date_qid = params.get("date_question_id")
    option_values = {o.value for o in options}

    base = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
    )

    if date_qid:
        date_sq = Answers.objects.filter(
            data_id=OuterRef("data_id"),
            question_id=date_qid,
            name__isnull=False,
        ).values("name")[:1]
        rows = base.annotate(
            date_name=Subquery(date_sq),
        ).filter(
            date_name__isnull=False,
        ).annotate(
            month_key=Substr("date_name", 1, 7),
        ).values("month_key", "options")
        get_key = lambda r: r["month_key"]  # noqa: E731
        get_label = lambda k: format_month_label(k)  # noqa: E731
    else:
        rows = base.annotate(
            month=TruncMonth("data__created"),
        ).values("month", "options")
        get_key = lambda r: format_month_group(r["month"])  # noqa: E731
        get_label = lambda k: format_month_label(k)  # noqa: E731

    buckets = defaultdict(lambda: defaultdict(int))
    for r in rows:
        key = get_key(r)
        if not key:
            continue
        for v in (r["options"] or []):
            if v in option_values:
                buckets[key][v] += 1

    data = []
    for key in sorted(buckets.keys()):
        row = {"group": key, "label": get_label(key)}
        total_in_month = 0
        for opt in options:
            count = buckets[key].get(opt.value, 0)
            row[opt.label] = count
            total_in_month += count
        if value_type == "percentage" and total_in_month > 0:
            for opt in options:
                row[opt.label] = round(
                    row[opt.label] / total_in_month * 100, 2,
                )
        data.append(row)

    labels = [d["label"] for d in data]
    return {
        "data": data,
        "labels": labels,
        "stack_labels": opt_labels,
        "colors": opt_colors,
    }


def _stack_option_by_parent(
    question, options, data_ids,
    qs, is_latest, opt_labels, opt_colors
):
    """Stack by option, grouped by parent_id."""
    if is_latest:
        parents = qs
    else:
        parent_ids = FormData.objects.filter(
            id__in=data_ids,
            parent__isnull=False,
        ).values_list(
            "parent_id", flat=True
        ).distinct()
        parents = FormData.objects.filter(
            id__in=parent_ids,
        )

    data = []
    for parent in parents:
        if is_latest:
            p_data_ids = [parent.latest_id]
            p_name = parent.name
        else:
            p_data_ids = list(FormData.objects.filter(
                id__in=data_ids,
                parent_id=parent.id,
            ).values_list("id", flat=True))
            p_name = parent.name

        row = {"label": p_name}
        for opt in options:
            count = Answers.objects.filter(
                data_id__in=p_data_ids,
                question_id=question.id,
                options__contains=[opt.value],
            ).count()
            row[opt.label] = count
        data.append(row)

    labels = [d["label"] for d in data]
    return {
        "data": data,
        "labels": labels,
        "stack_labels": opt_labels,
        "colors": opt_colors,
    }


def handle_stack_by_parent(
    question, qs, is_latest, data_ids, params
):
    """Handle stack_by=parent_id: multi-line charts."""
    group_by = params.get("group_by")
    repeat_agg = params.get("repeat_agg", "average")
    agg_func = AGG_FUNCS.get(repeat_agg, Avg)

    if is_latest:
        parents = list(
            qs.values("id", "name", "latest_id")
        )
    else:
        parent_ids = FormData.objects.filter(
            id__in=data_ids,
            parent__isnull=False,
        ).values_list(
            "parent_id", flat=True
        ).distinct()
        parent_data = FormData.objects.filter(
            id__in=parent_ids,
        ).values("id", "name")
        parents = [
            {
                "id": p["id"],
                "name": p["name"],
                "data_ids": list(
                    FormData.objects.filter(
                        id__in=data_ids,
                        parent_id=p["id"],
                    ).values_list("id", flat=True)
                ),
            }
            for p in parent_data
        ]

    parent_names = [p["name"] for p in parents]

    if group_by == "date":
        return _stack_parent_by_date(
            question, parents, is_latest,
            parent_names, agg_func, params
        )

    if group_by == "month":
        return _stack_parent_by_month(
            question, parents, is_latest,
            parent_names, agg_func, params
        )

    return {"data": [], "labels": [], "stack_labels": []}


def _stack_parent_by_date(
    question, parents, is_latest,
    parent_names, agg_func, params
):
    """Stack by parent_id, grouped by date.

    Prefetches date keys and aggregated values per data_id in two
    bulk queries instead of N+1 per-point queries.
    """
    date_qid = params.get("date_question_id")

    all_data_ids = []
    for p in parents:
        if is_latest:
            all_data_ids.append(p["latest_id"])
        else:
            all_data_ids.extend(p["data_ids"])

    if date_qid:
        date_rows = Answers.objects.filter(
            data_id__in=all_data_ids,
            question_id=date_qid,
            name__isnull=False,
        ).values("data_id", "name")
        date_map = {
            r["data_id"]: format_date_group(r["name"])
            for r in date_rows
        }
    else:
        fd_rows = FormData.objects.filter(
            id__in=all_data_ids,
        ).values("id", "created")
        date_map = {
            r["id"]: format_date_group(r["created"])
            for r in fd_rows
        }

    val_rows = Answers.objects.filter(
        data_id__in=all_data_ids,
        question_id=question.id,
        value__isnull=False,
    ).values("data_id").annotate(
        agg_value=agg_func("value"),
    )
    val_map = {
        r["data_id"]: r["agg_value"]
        for r in val_rows
        if r["agg_value"] is not None
    }

    all_rows = {}
    for p in parents:
        p_ids = (
            [p["latest_id"]] if is_latest
            else p["data_ids"]
        )
        for data_id in p_ids:
            date_key = date_map.get(data_id)
            agg_val = val_map.get(data_id)
            if not date_key or agg_val is None:
                continue
            if date_key not in all_rows:
                all_rows[date_key] = {"date": date_key}
            all_rows[date_key][p["name"]] = round(agg_val, 2)

    data = [all_rows[k] for k in sorted(all_rows.keys())]
    labels = sorted(all_rows.keys())
    return {
        "data": data,
        "labels": labels,
        "stack_labels": parent_names,
    }


def _stack_parent_by_month(
    question, parents, is_latest,
    parent_names, agg_func, params
):
    """Stack by parent_id, grouped by month.

    When date_question_id is provided, buckets by the month of that
    date answer (via Subquery) instead of FormData.created.
    """
    date_qid = params.get("date_question_id")
    all_rows = {}

    for p in parents:
        p_ids = (
            [p["latest_id"]] if is_latest
            else p["data_ids"]
        )

        base = Answers.objects.filter(
            data_id__in=p_ids,
            question_id=question.id,
            value__isnull=False,
        )

        if date_qid:
            date_sq = Answers.objects.filter(
                data_id=OuterRef("data_id"),
                question_id=date_qid,
                name__isnull=False,
            ).values("name")[:1]
            results = base.annotate(
                date_name=Subquery(date_sq),
            ).filter(
                date_name__isnull=False,
            ).annotate(
                month_key=Substr("date_name", 1, 7),
            ).values("month_key").annotate(
                agg_value=agg_func("value"),
            ).order_by("month_key")
            for r in results:
                if r["agg_value"] is None:
                    continue
                month_key = r["month_key"]
                if month_key not in all_rows:
                    all_rows[month_key] = {
                        "month": format_month_label(month_key),
                    }
                all_rows[month_key][p["name"]] = round(
                    r["agg_value"], 2,
                )
        else:
            results = base.annotate(
                month=TruncMonth("data__created"),
            ).values("month").annotate(
                agg_value=agg_func("value"),
            ).order_by("month")
            for r in results:
                month_key = format_month_group(r["month"])
                if month_key not in all_rows:
                    all_rows[month_key] = {
                        "month": format_month_label(
                            r["month"]
                        ),
                    }
                all_rows[month_key][p["name"]] = round(
                    r["agg_value"], 2,
                )

    data = [all_rows[k] for k in sorted(all_rows.keys())]
    labels = [d["month"] for d in data]
    return {
        "data": data,
        "labels": labels,
        "stack_labels": parent_names,
    }
