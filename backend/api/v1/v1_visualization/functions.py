from django.db import transaction, connection
from django.db.models import (
    Q, Subquery, OuterRef,
)
from datetime import datetime as dt_datetime, timedelta, date

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_profile.models import Administration


@transaction.atomic
def refresh_materialized_data():
    with connection.cursor() as cursor:
        cursor.execute(
            """
            REFRESH MATERIALIZED VIEW view_data_options;
            """
        )


# -- Shared helpers --

def apply_administration_filter(queryset, administration_id):
    """Filter queryset by administration hierarchy."""
    try:
        adm = Administration.objects.get(
            pk=administration_id
        )
    except Administration.DoesNotExist:
        return queryset.none()
    adm_path = (
        f"{adm.path}{adm.id}." if adm.path
        else f"{adm.id}."
    )
    return queryset.filter(
        Q(administration_id=administration_id)
        | Q(administration__path__startswith=adm_path)
    )


def resolve_default_administration_id(administration_id):
    """Fall back to the root administration (parent IS NULL) when no
    administration_id is provided. These visualization endpoints are
    public, so we scope to the top-level country by default instead of
    leaking data across unrelated administrations."""
    if administration_id:
        return administration_id
    root = Administration.objects.filter(
        parent__isnull=True
    ).values_list("id", flat=True).first()
    return root


def _to_date_upper_bound(value):
    """Produce an inclusive upper bound for an ISO date-time string.

    `Answers.name` stores dates as ISO-8601 with time (e.g.
    '2025-01-20T00:00:00.000Z'), so a plain `name__lte='2025-01-20'`
    excludes same-day records lexically. Appending the latest time
    makes `<=` work as an inclusive day boundary.
    """
    return f"{value}T23:59:59.999Z"


def latest_monitoring_subquery(form_id, date_filters=None):
    """Subquery: latest monitoring FormData ID per parent."""
    qs = FormData.objects.filter(
        parent=OuterRef("pk"),
        form_id=form_id,
        is_pending=False,
        is_draft=False,
    )
    if date_filters:
        date_qid = date_filters.get("date_question_id")
        if date_qid:
            sub = Answers.objects.filter(
                data=OuterRef("pk"),
                question_id=date_qid,
            )
            if date_filters.get("from_date"):
                sub = sub.filter(
                    name__gte=date_filters["from_date"],
                )
            if date_filters.get("to_date"):
                sub = sub.filter(
                    name__lte=_to_date_upper_bound(
                        date_filters["to_date"]
                    ),
                )
            qs = qs.filter(
                pk__in=Subquery(sub.values("data_id"))
            )
        else:
            if date_filters.get("from_date"):
                qs = qs.filter(
                    created__date__gte=(
                        date_filters["from_date"]
                    )
                )
            if date_filters.get("to_date"):
                qs = qs.filter(
                    created__date__lte=(
                        date_filters["to_date"]
                    )
                )
    return Subquery(
        qs.order_by("-created").values("id")[:1]
    )


def get_base_monitoring_qs(form, monitoring_form_id, params):
    """Build base queryset for monitoring data.

    Returns:
        Tuple of (queryset, is_monitoring_form, date_filters)
    """
    monitoring = params.get("monitoring", "latest")
    from_date = params.get("from_date")
    to_date = params.get("to_date")
    date_question_id = params.get("date_question_id")
    administration_id = params.get("administration_id")

    date_filters = {}
    if from_date:
        date_filters["from_date"] = from_date
    if to_date:
        date_filters["to_date"] = to_date
    if date_question_id:
        date_filters["date_question_id"] = (
            date_question_id
        )

    is_monitoring = form.parent is not None
    parent_form = (
        form.parent if is_monitoring else form
    )

    if is_monitoring and monitoring == "latest":
        qs = FormData.objects.filter(
            form=parent_form,
            parent__isnull=True,
            is_pending=False,
            is_draft=False,
        ).annotate(
            latest_id=latest_monitoring_subquery(
                monitoring_form_id,
                date_filters or None,
            ),
        ).filter(latest_id__isnull=False)

        if administration_id:
            qs = apply_administration_filter(
                qs, administration_id
            )
        return qs, True, date_filters

    qs = FormData.objects.filter(
        form_id=monitoring_form_id,
        is_pending=False,
        is_draft=False,
    )
    if administration_id:
        qs = apply_administration_filter(
            qs, administration_id
        )

    if date_filters:
        if date_question_id:
            matching_ids = Answers.objects.filter(
                data__form_id=monitoring_form_id,
                question_id=date_question_id,
                name__isnull=False,
            )
            if from_date:
                matching_ids = matching_ids.filter(
                    name__gte=from_date
                )
            if to_date:
                matching_ids = matching_ids.filter(
                    name__lte=_to_date_upper_bound(to_date)
                )
            qs = qs.filter(
                id__in=matching_ids.values("data_id")
            )
        else:
            if from_date:
                qs = qs.filter(
                    created__date__gte=from_date
                )
            if to_date:
                qs = qs.filter(
                    created__date__lte=to_date
                )

    return qs, False, date_filters


def get_monitoring_data_ids(qs, is_latest_mode):
    """Extract monitoring data IDs from queryset."""
    if is_latest_mode:
        return list(
            qs.values_list("latest_id", flat=True)
        )
    return list(qs.values_list("id", flat=True))


def format_month_label(dt):
    """Format a date/datetime to 'Mon YYYY' label."""
    if hasattr(dt, 'strftime'):
        return dt.strftime("%b %Y")
    try:
        d = dt_datetime.strptime(str(dt)[:7], "%Y-%m")
        return d.strftime("%b %Y")
    except (ValueError, TypeError):
        return str(dt)


def format_month_group(dt):
    """Format to YYYY-MM group key."""
    if hasattr(dt, 'strftime'):
        return dt.strftime("%Y-%m")
    return str(dt)[:7]


def format_date_group(dt):
    """Format to YYYY-MM-DD group key."""
    if hasattr(dt, 'strftime'):
        return dt.strftime("%Y-%m-%d")
    return str(dt)[:10]


def _parse_iso_date(value):
    """Parse YYYY-MM-DD string or pass through date/datetime."""
    if isinstance(value, (dt_datetime, date)):
        return value if isinstance(value, date) else value.date()
    return dt_datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def fill_month_gaps(data, from_date, to_date):
    """Return a new list with zero-filled month rows between bounds.

    Preserves existing rows (by `group` key) and inserts zero rows
    for every month in [from_date, to_date] that is missing. Output
    is sorted chronologically by `group`.
    """
    start = _parse_iso_date(from_date).replace(day=1)
    end = _parse_iso_date(to_date).replace(day=1)
    existing = {row["group"]: row for row in data}

    filled = []
    cursor = start
    while cursor <= end:
        key = cursor.strftime("%Y-%m")
        if key in existing:
            filled.append(existing[key])
        else:
            filled.append({
                "value": 0,
                "label": cursor.strftime("%b %Y"),
                "group": key,
            })
        # advance to first day of next month
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)
    return filled


def fill_date_gaps(data, from_date, to_date):
    """Return a new list with zero-filled day rows between bounds.

    Preserves existing rows (by `group` key) and inserts zero rows
    for every day in [from_date, to_date] that is missing. Output
    is sorted chronologically by `group`.
    """
    start = _parse_iso_date(from_date)
    end = _parse_iso_date(to_date)
    existing = {row["group"]: row for row in data}

    filled = []
    cursor = start
    while cursor <= end:
        key = cursor.strftime("%Y-%m-%d")
        if key in existing:
            filled.append(existing[key])
        else:
            filled.append({
                "value": 0,
                "label": key,
                "group": key,
            })
        cursor = cursor + timedelta(days=1)
    return filled
