from django.db.models import Count, Avg, F
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
            for p in qs
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
            for p in qs
        ]
    else:
        data = [
            {
                "value": 1,
                "label": r.name,
                "group": str(r.id),
            }
            for r in qs.order_by("id")
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
        return _option_group_by_option(
            question, options, data_ids, qs,
            is_latest, value_type
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


def _option_group_by_option(
    question, options, data_ids, qs,
    is_latest, value_type
):
    """Group by option values (donut chart).

    Returns a row for every defined option — including zero-count
    options — so pie/doughnut charts have stable legends and colors
    across refreshes and filter changes.
    """
    total_for_pct = (
        qs.count() if is_latest else len(data_ids)
    )
    data = []
    for opt in options:
        count = Answers.objects.filter(
            data_id__in=data_ids,
            question_id=question.id,
            options__contains=[opt.value],
        ).count()
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
            question, data_ids, agg_func, value_type
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
    labels = [d["label"] for d in data]
    return data, labels


def _number_group_by_month(
    question, data_ids, agg_func, value_type
):
    """Number question grouped by month."""
    results = Answers.objects.filter(
        data_id__in=data_ids,
        question_id=question.id,
        value__isnull=False,
    ).annotate(
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
            opt_labels, opt_colors, value_type
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
    opt_labels, opt_colors, value_type
):
    """Stack by option, grouped by month."""
    months = FormData.objects.filter(
        id__in=data_ids,
    ).annotate(
        month=TruncMonth("created"),
    ).values("month").distinct().order_by("month")

    data = []
    for month_row in months:
        month = month_row["month"]
        month_data_ids = FormData.objects.filter(
            id__in=data_ids,
            created__year=month.year,
            created__month=month.month,
        ).values_list("id", flat=True)

        row = {
            "group": format_month_group(month),
            "label": format_month_label(month),
        }
        total_in_month = 0
        for opt in options:
            count = Answers.objects.filter(
                data_id__in=month_data_ids,
                question_id=question.id,
                options__contains=[opt.value],
            ).count()
            row[opt.label] = count
            total_in_month += count

        if value_type == "percentage" and total_in_month > 0:
            for opt in options:
                row[opt.label] = round(
                    row[opt.label] / total_in_month * 100,
                    2,
                )

        data.append(row)

    labels = [
        format_month_label(m["month"]) for m in months
    ]
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
            parent_names, agg_func
        )

    return {"data": [], "labels": [], "stack_labels": []}


def _stack_parent_by_date(
    question, parents, is_latest,
    parent_names, agg_func, params
):
    """Stack by parent_id, grouped by date."""
    all_rows = {}
    date_qid = params.get("date_question_id")

    for p in parents:
        p_ids = (
            [p["latest_id"]] if is_latest
            else p["data_ids"]
        )

        for data_id in p_ids:
            if date_qid:
                date_ans = Answers.objects.filter(
                    data_id=data_id,
                    question_id=date_qid,
                ).first()
                date_key = (
                    format_date_group(date_ans.name)
                    if date_ans and date_ans.name
                    else None
                )
            else:
                fd = FormData.objects.filter(
                    id=data_id
                ).values("created").first()
                date_key = (
                    format_date_group(fd["created"])
                    if fd else None
                )

            if not date_key:
                continue

            val_result = Answers.objects.filter(
                data_id=data_id,
                question_id=question.id,
                value__isnull=False,
            ).aggregate(agg_value=agg_func("value"))

            if val_result["agg_value"] is not None:
                if date_key not in all_rows:
                    all_rows[date_key] = {
                        "date": date_key,
                    }
                all_rows[date_key][p["name"]] = round(
                    val_result["agg_value"], 2
                )

    data = [
        all_rows[k] for k in sorted(all_rows.keys())
    ]
    labels = sorted(all_rows.keys())
    return {
        "data": data,
        "labels": labels,
        "stack_labels": parent_names,
    }


def _stack_parent_by_month(
    question, parents, is_latest,
    parent_names, agg_func
):
    """Stack by parent_id, grouped by month."""
    all_rows = {}
    for p in parents:
        p_ids = (
            [p["latest_id"]] if is_latest
            else p["data_ids"]
        )

        results = Answers.objects.filter(
            data_id__in=p_ids,
            question_id=question.id,
            value__isnull=False,
        ).annotate(
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
                r["agg_value"], 2
            )

    data = [
        all_rows[k] for k in sorted(all_rows.keys())
    ]
    labels = [d["month"] for d in data]
    return {
        "data": data,
        "labels": labels,
        "stack_labels": parent_names,
    }
