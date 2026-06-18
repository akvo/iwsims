import logging
from collections import defaultdict

from django.db import connection
from django.db.models import (
    Avg, Count, Q, Subquery, OuterRef,
)
from datetime import datetime as dt_datetime, timedelta, date
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Questions, QuestionOptions
from api.v1.v1_profile.models import Administration
from api.v1.v1_visualization.constants import MATERIALIZED_VIEWS
from api.v1.v1_visualization.models import (
    MVAnswerDenormalized,
    MVCrossFormLatest,
    MVLatestMonitoring,
)


logger = logging.getLogger(__name__)


def validate_qname(token):
    """Normalize a question token to a question_name string.

    Dashboard endpoints are question_name-only. A digits-only token is a
    legacy question_id and is rejected with a 400 so a stray id is never
    silently treated as a literal name that matches nothing.
    """
    if token is None:
        return None
    name = str(token)
    if name.isdigit():
        raise ValidationError(
            f"Expected a question_name, got a numeric id '{name}'. "
            "Dashboard endpoints are question_name-only."
        )
    return name


def refresh_materialized_data(views=None, concurrent=False):
    """Refresh materialized views.

    Args:
        views: List of view names to refresh. Defaults to all views.
        concurrent: Use REFRESH CONCURRENTLY (non-blocking, requires
                    unique index). Falls back to regular refresh on error.

    Note: Not wrapped in @transaction.atomic — REFRESH CONCURRENTLY
    cannot run inside a transaction. Django's default autocommit mode
    makes each cursor context an independent transaction.
    """
    views_to_refresh = views or MATERIALIZED_VIEWS

    for view in views_to_refresh:
        # REFRESH CONCURRENTLY cannot run inside a transaction block.
        # Django's TestCase wraps tests in a transaction, so downgrade
        # to a regular refresh when in_atomic_block is True.
        use_concurrent = concurrent and not connection.in_atomic_block

        if use_concurrent:
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view};"
                    )
                logger.info(f"Refreshed materialized view: {view}")
            except Exception as e:
                logger.warning(
                    f"Concurrent refresh failed for {view}: {e} — "
                    f"falling back to regular refresh"
                )
                try:
                    with connection.cursor() as cursor:
                        cursor.execute(
                            f"REFRESH MATERIALIZED VIEW {view};"
                        )
                    logger.info(
                        f"Refreshed {view} (fallback to non-concurrent)"
                    )
                except Exception as e2:
                    logger.error(
                        f"Fallback refresh also failed for {view}: {e2}"
                    )
                    raise
        else:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"REFRESH MATERIALIZED VIEW {view};"
                )
            logger.info(f"Refreshed materialized view: {view}")


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


def apply_administration_filter_mv(
    qs, administration_id, field='parent_administration_id'
):
    """Filter MV queryset by administration hierarchy.

    Like apply_administration_filter but works with MV models that store
    administration IDs as plain integers rather than FK fields.

    Args:
        qs: QuerySet of an MV model
        administration_id: Target administration ID to filter on
        field: Name of the integer administration field to filter against
    """
    try:
        adm = Administration.objects.get(pk=administration_id)
    except Administration.DoesNotExist:
        return qs.none()

    adm_path = (
        f"{adm.path}{adm.id}." if adm.path
        else f"{adm.id}."
    )
    child_admin_ids = list(
        Administration.objects.filter(
            Q(pk=administration_id)
            | Q(path__startswith=adm_path)
        ).values_list('pk', flat=True)
    )
    return qs.filter(**{f'{field}__in': child_admin_ids})


def get_latest_monitoring_from_mv(
    form_id, administration_id=None, date_filters=None
):
    """Get latest monitoring rows using mv_latest_monitoring.

    Replaces the correlated subquery in latest_monitoring_subquery().
    Returns a QuerySet of MVLatestMonitoring rows.

    Args:
        form_id: Monitoring form ID
        administration_id: Optional administration filter
        date_filters: Optional dict with from_date, to_date, date_question_id
    """
    qs = MVLatestMonitoring.objects.filter(form_id=form_id)

    if administration_id:
        qs = apply_administration_filter_mv(
            qs, administration_id, 'parent_administration_id'
        )

    if date_filters:
        from_date = date_filters.get("from_date")
        to_date = date_filters.get("to_date")
        date_qname = date_filters.get("date_question_name")

        if date_qname:
            matching = MVAnswerDenormalized.objects.filter(
                question_name=date_qname,
                answer_name__isnull=False,
            )
            if from_date:
                matching = matching.filter(answer_name__gte=str(from_date))
            if to_date:
                matching = matching.filter(
                    answer_name__lte=_to_date_upper_bound(to_date)
                )
            qs = qs.filter(latest_data_id__in=matching.values("data_id"))
        else:
            if from_date:
                qs = qs.filter(created__date__gte=from_date)
            if to_date:
                qs = qs.filter(created__date__lte=to_date)

    return qs


def get_latest_data_ids_from_mv(
    form_id, administration_id=None, date_filters=None
):
    """Return latest monitoring data IDs from mv_latest_monitoring.

    Convenience wrapper around get_latest_monitoring_from_mv() that returns
    a flat list of IDs for use in Answers queries.
    """
    qs = get_latest_monitoring_from_mv(
        form_id, administration_id, date_filters
    )
    return list(qs.values_list('latest_data_id', flat=True))


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
    if root is None:
        raise ValidationError(
            "No root administration configured; "
            "administration_id is required."
        )
    return root


def build_date_filters(params):
    """Collect from_date/to_date/date_question_id into a dict.

    Returns an empty dict when no date filter is set, so callers can
    pass `date_filters or None` to subqueries that treat falsy as
    'no filter'.
    """
    date_filters = {}
    if params.get("from_date"):
        date_filters["from_date"] = params["from_date"]
    if params.get("to_date"):
        date_filters["to_date"] = params["to_date"]
    if params.get("date_question_name"):
        date_filters["date_question_name"] = params["date_question_name"]
    return date_filters


def _to_date_upper_bound(value):
    """Produce an inclusive upper bound for an ISO date-time string.

    `Answers.name` stores dates as ISO-8601 with time (e.g.
    '2025-01-20T00:00:00.000Z'), so a plain `name__lte='2025-01-20'`
    excludes same-day records lexically. Appending the latest time
    makes `<=` work as an inclusive day boundary.
    """
    return f"{value}T23:59:59.999Z"


def get_latest_monitoring_subquery(form_id, date_filters=None):
    """Return the right subquery for latest monitoring ID per parent.

    Uses mv_latest_monitoring (indexed lookup on (parent_id, form_id))
    when safe. Falls back to the correlated subquery otherwise.

    MV is skipped when:
    - date_filters is set: MV stores the absolute latest, not the most
      recent within a date range, so date-filtered queries need the
      data table scan to find the latest WITHIN range.
    - connection.in_atomic_block: TestCase wraps tests in a transaction
      so the MV is never refreshed after test data is created.

    Drop-in replacement for latest_monitoring_subquery() in any
    .annotate(latest_id=...) call.
    """
    if not date_filters and not connection.in_atomic_block:
        return Subquery(
            MVLatestMonitoring.objects.filter(
                parent_id=OuterRef('pk'),
                form_id=form_id,
            ).values('latest_data_id')[:1]
        )
    return latest_monitoring_subquery(form_id, date_filters)


def latest_monitoring_subquery(form_id, date_filters=None):
    """Subquery: latest monitoring FormData ID per parent."""
    qs = FormData.objects.filter(
        parent=OuterRef("pk"),
        form_id=form_id,
        is_pending=False,
        is_draft=False,
    )
    if date_filters:
        date_qname = date_filters.get("date_question_name")
        if date_qname:
            sub = Answers.objects.filter(
                data=OuterRef("pk"),
                question__name=date_qname,
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


def parse_criteria_string(value, allowed_types):
    """Parse a `criteria=type:qid:value,...` query string.

    Returns a list of {"type", "parts"} dicts. For option_in the
    value is split on `|` into a list; for other option operators
    the value is passed through as a string; thresholds are coerced
    to float. Raises ValueError with a user-visible message on any
    malformed fragment so callers can surface a 400.
    """
    parsed = []
    for item in value.split(","):
        parts = item.strip().split(":")
        if len(parts) < 3:
            raise ValueError(
                f"Invalid criteria format: '{item}'."
                " Expected type:qid:value"
            )
        ctype = parts[0]
        if ctype not in allowed_types:
            raise ValueError(
                f"Invalid criteria type: '{ctype}'."
                f" Options: {sorted(allowed_types)}"
            )
        try:
            if ctype in ("option_equals", "option_contains"):
                qname = validate_qname(parts[1])
                normalized = [qname, parts[2]]
            elif ctype == "option_in":
                qname = validate_qname(parts[1])
                values = [
                    v for v in parts[2].split("|") if v
                ]
                if not values:
                    raise ValueError(
                        "option_in requires at least one value:"
                        f" '{item}'"
                    )
                normalized = [qname, values]
            elif ctype in ("threshold_gt", "threshold_lt"):
                qname = validate_qname(parts[1])
                threshold = float(parts[2])
                normalized = [qname, threshold]
            elif ctype == "overdue":
                completion_qname = validate_qname(parts[1])
                deadline_qname = validate_qname(parts[2])
                normalized = [completion_qname, deadline_qname]
            else:
                normalized = parts[1:]
        except ValueError as e:
            # Re-raise our own messages; wrap numeric parse failures
            if "criteria" in str(e) or "option_in" in str(e):
                raise
            raise ValueError(
                f"Invalid numeric value in criteria: '{item}'."
            )
        parsed.append({"type": ctype, "parts": normalized})
    return parsed


def _criterion_matching_ids(data_ids, criterion):
    """Return iterable of data_ids matching a single criterion.

    Matches over mv_answer_denormalized by question_name (indexed by
    idx_mv_answer_question_name) rather than the base Answers table —
    Questions.name is unindexed, so a question__name join would seq-scan.
    The MV is form-scoped by data_id__in, so results are identical to the
    old question_id filter.
    """
    ctype = criterion["type"]
    parts = criterion["parts"]
    if ctype in ("option_equals", "option_contains"):
        qname, value = parts
        return MVAnswerDenormalized.objects.filter(
            data_id__in=data_ids,
            question_name=qname,
            answer_options__contains=[value],
        ).values_list("data_id", flat=True)
    if ctype == "option_in":
        qname, values = parts
        or_q = Q()
        for v in values:
            or_q |= Q(answer_options__contains=[v])
        return MVAnswerDenormalized.objects.filter(
            or_q,
            data_id__in=data_ids,
            question_name=qname,
        ).values_list("data_id", flat=True)
    if ctype == "threshold_gt":
        qname, threshold = parts
        return MVAnswerDenormalized.objects.filter(
            data_id__in=data_ids,
            question_name=qname,
            answer_value__gt=threshold,
        ).values_list("data_id", flat=True)
    if ctype == "threshold_lt":
        qname, threshold = parts
        return MVAnswerDenormalized.objects.filter(
            data_id__in=data_ids,
            question_name=qname,
            answer_value__lt=threshold,
        ).values_list("data_id", flat=True)
    return []


def narrow_data_ids_by_criteria(data_ids, criteria):
    """Return subset of data_ids where ALL criteria match (AND).

    Each criterion is evaluated as a separate Answers query over the
    current candidate set; the intersection shrinks monotonically so
    criteria that narrow heavily short-circuit the remaining work.
    """
    if not criteria:
        return list(data_ids)
    matching = set(data_ids)
    for criterion in criteria:
        if not matching:
            break
        ids = set(
            _criterion_matching_ids(list(matching), criterion)
        )
        matching &= ids
    return [i for i in data_ids if i in matching]


def apply_parent_criteria_to_qs(qs, is_latest, parent_criteria):
    """Narrow by criteria on the PARENT (registration) form's answers.

    In latest mode `qs` rows are parent FormData (with `latest_id`),
    so we match directly against `qs.id`. In non-latest mode `qs`
    rows are monitoring FormData, so we match against `qs.parent_id`.
    """
    if not parent_criteria:
        return qs
    if is_latest:
        parent_ids = list(qs.values_list("id", flat=True))
        narrowed = narrow_data_ids_by_criteria(
            parent_ids, parent_criteria,
        )
        return qs.filter(id__in=narrowed)
    parent_ids = list(
        qs.values_list("parent_id", flat=True).distinct()
    )
    narrowed = narrow_data_ids_by_criteria(
        parent_ids, parent_criteria,
    )
    return qs.filter(parent_id__in=narrowed)


def apply_criteria_to_monitoring_qs(qs, is_latest, criteria):
    """Narrow a base monitoring queryset by multi-criteria filter.

    Fetches the current data_ids from `qs` (either `latest_id` or
    `id` depending on the mode), intersects them against each
    criterion's matching set, then re-filters `qs` so downstream
    callers see a consistent narrowed view.
    """
    if not criteria:
        return qs
    if is_latest:
        ids = list(qs.values_list("latest_id", flat=True))
        narrowed = narrow_data_ids_by_criteria(ids, criteria)
        return qs.filter(latest_id__in=narrowed)
    ids = list(qs.values_list("id", flat=True))
    narrowed = narrow_data_ids_by_criteria(ids, criteria)
    return qs.filter(id__in=narrowed)


def split_criteria_by_form(criteria, form_id, parent_form_id):
    """Split parsed criteria list into same-form and parent-form."""
    if not criteria:
        return None, None
    qnames = {c["parts"][0] for c in criteria}
    on_form = set(
        Questions.objects.filter(
            name__in=qnames, form_id=form_id,
        ).values_list("name", flat=True)
    )
    on_parent = set()
    if parent_form_id:
        remaining = qnames - on_form
        if remaining:
            on_parent = set(
                Questions.objects.filter(
                    name__in=remaining,
                    form_id=parent_form_id,
                ).values_list("name", flat=True)
            )
    same = [c for c in criteria if c["parts"][0] in on_form]
    parent = [c for c in criteria if c["parts"][0] in on_parent]
    return same or None, parent or None


def get_base_monitoring_qs(form, monitoring_form_id, params):
    """Build base queryset for monitoring data.

    Returns:
        Tuple of (queryset, is_monitoring_form, date_filters)
    """
    monitoring = params.get("monitoring", "latest")
    from_date = params.get("from_date")
    to_date = params.get("to_date")
    date_question_name = params.get("date_question_name")
    administration_id = params.get("administration_id")

    date_filters = build_date_filters(params)

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
            latest_id=get_latest_monitoring_subquery(
                monitoring_form_id,
                date_filters or None,
            ),
        ).filter(latest_id__isnull=False)

        if administration_id:
            qs = apply_administration_filter(
                qs, administration_id
            )
        qs = apply_criteria_to_monitoring_qs(
            qs, True, params.get("criteria"),
        )
        qs = apply_parent_criteria_to_qs(
            qs, True, params.get("parent_criteria"),
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
        if date_question_name:
            matching_ids = Answers.objects.filter(
                data__form_id=monitoring_form_id,
                question__name=date_question_name,
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

    qs = apply_criteria_to_monitoring_qs(
        qs, False, params.get("criteria"),
    )
    qs = apply_parent_criteria_to_qs(
        qs, False, params.get("parent_criteria"),
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


# -- question_name cross-form helpers --

def get_values_by_question_name(question_name, params):
    """Get visualization values by question_name across all monitoring forms.

    Uses mv_cross_form_latest to find the latest value for each parent,
    regardless of which monitoring form the answer came from.

    Args:
        question_name: Question name/identifier (e.g., "ph", "status").
        params: Dict with administration_id, group_by, value_type, and
            optionally sum_by, option_value, rolling_months, from_date,
            to_date.

    Returns:
        Tuple of (data, labels) matching existing API response format.
    """
    administration_id = params.get("administration_id")
    group_by = params.get("group_by")
    value_type = params.get("value_type", "number")
    sum_by = params.get("sum_by")
    option_value = params.get("option_value")
    rolling_months = params.get("rolling_months")
    from_date = params.get("from_date")
    to_date = params.get("to_date")

    qs = MVCrossFormLatest.objects.filter(question_name=question_name)

    # Optional: scope to a single registration family. Omitted → national
    # (cross-family) overview. mv_cross_form_latest carries parent_form_id
    # (the parent's registration form) + an index on
    # (parent_form_id, question_name).
    parent_form_id = params.get("parent_form_id")
    if parent_form_id:
        qs = qs.filter(parent_form_id=parent_form_id)

    if administration_id:
        qs = apply_administration_filter_mv(
            qs, administration_id, field='administration_id'
        )

    # Recency / date-window filter on the latest submission timestamp.
    qs = _apply_qname_date_filter(
        qs, rolling_months, from_date, to_date
    )

    # Card / count mode: a single parent count, optionally narrowed to a
    # specific option value. Triggered by sum_by=parent_id or option_value
    # so the number/option aggregation defaults below stay unchanged.
    if sum_by == "parent_id" or option_value:
        return _count_parents_by_qname(qs, option_value, value_type)

    # Pick the most common question_type across all rows (mode).
    # A well-formed dataset has one type per question_name; when forms
    # disagree (rare), the majority wins with question_type as tiebreak.
    type_row = (
        qs.values("question_type")
        .annotate(cnt=Count("id"))
        .order_by("-cnt", "question_type")
        .first()
    )
    if not type_row:
        return [], []

    question_type = type_row["question_type"]

    if question_type == 4:  # number
        return _values_by_qname_number(qs, group_by, value_type)
    if question_type in (5, 6):  # option, multiple_option
        return _values_by_qname_option(qs, question_name, group_by, value_type)
    return _values_by_qname_text(qs)


def _apply_qname_date_filter(qs, rolling_months, from_date, to_date):
    """Filter a cross-form queryset by submission recency / date window.

    - rolling_months: keep rows whose latest answer is within the last N
      months (approximated as N * 30 days from now).
    - from_date / to_date: inclusive bounds on the latest answer date.
    """
    if rolling_months:
        cutoff = timezone.now() - timedelta(days=30 * rolling_months)
        qs = qs.filter(latest_created__gte=cutoff)
    if from_date:
        qs = qs.filter(latest_created__date__gte=from_date)
    if to_date:
        qs = qs.filter(latest_created__date__lte=to_date)
    return qs


def _count_parents_by_qname(qs, option_value, value_type):
    """Count distinct parents for a question_name (card / KPI mode).

    When option_value is given, count only parents whose latest option
    values contain it. With value_type=percentage, return that count as a
    share of all parents that answered the question.
    """
    total = qs.values("parent_id").distinct().count()
    if option_value:
        matched = (
            qs.filter(latest_option_values__contains=[option_value])
            .values("parent_id")
            .distinct()
            .count()
        )
    else:
        matched = total

    if value_type == "percentage":
        value = round(matched / total * 100, 2) if total else 0
    else:
        value = matched

    label = option_value or "Total"
    group = option_value or "total"
    return [{"value": value, "label": label, "group": group}], [label]


def _values_by_qname_number(qs, group_by, value_type):
    """Handle number question aggregation by question_name."""
    if group_by == "parent_id":
        rows = list(
            qs.filter(latest_numeric_value__isnull=False)
            .values("parent_id", "latest_numeric_value")
        )
        if not rows:
            return [], []
        parent_ids = [r["parent_id"] for r in rows]
        name_map = dict(
            FormData.objects.filter(id__in=parent_ids)
            .values_list("id", "name")
        )
        data = [
            {
                "value": round(r["latest_numeric_value"], 2),
                "label": name_map.get(r["parent_id"], str(r["parent_id"])),
                "group": str(r["parent_id"]),
            }
            for r in rows
        ]
    else:
        result = qs.filter(latest_numeric_value__isnull=False).aggregate(
            avg_value=Avg("latest_numeric_value"),
            total=Count("id"),
        )
        avg = (
            round(result["avg_value"], 2)
            if result["avg_value"] is not None else 0
        )
        data = [{"value": avg, "label": "Total", "group": "total"}]

    if value_type == "percentage" and data:
        total = sum(
            d["value"] for d in data
            if isinstance(d["value"], (int, float))
        )
        if total > 0:
            data = [
                {**d, "value": round(d["value"] / total * 100, 2)}
                for d in data
            ]

    labels = [d["label"] for d in data]
    return data, labels


def _values_by_qname_option(qs, question_name, group_by, value_type):
    """Handle option question aggregation by question_name."""
    # Deduplicate options by value. Order by (order, value, question_id)
    # so the tiebreak between forms sharing the same option value is
    # deterministic (lowest question_id wins).
    raw_opts = QuestionOptions.objects.filter(
        question__name=question_name,
        value__isnull=False,
    ).order_by(
        "order", "value", "question_id",
    ).values("value", "label", "color")
    seen = set()
    options = []
    for opt in raw_opts:
        if opt["value"] not in seen:
            seen.add(opt["value"])
            options.append(opt)

    if group_by == "parent_id":
        rows = list(qs.values("parent_id", "latest_option_values"))
        if not rows:
            return [], []
        parent_ids = [r["parent_id"] for r in rows]
        name_map = dict(
            FormData.objects.filter(id__in=parent_ids)
            .values_list("id", "name")
        )
        data = [
            {
                "value": row["latest_option_values"] or [],
                "label": name_map.get(
                    row["parent_id"], str(row["parent_id"])
                ),
                "group": str(row["parent_id"]),
            }
            for row in rows
        ]
        labels = [d["label"] for d in data]
        return data, labels

    # default: group_by == "option"
    tallies = defaultdict(int)
    total_parents = 0
    for row in qs.values("latest_option_values"):
        opts = row["latest_option_values"] or []
        for opt_value in opts:
            tallies[opt_value] += 1
        if opts:
            total_parents += 1

    data = []
    for opt in options:
        count = tallies.get(opt["value"], 0)
        if value_type == "percentage" and total_parents > 0:
            value = round(count / total_parents * 100, 2)
        else:
            value = count
        data.append({
            "value": value,
            "label": opt["label"] or opt["value"],
            "group": opt["value"],
            "color": opt.get("color"),
        })

    labels = [d["label"] for d in data]
    return data, labels


def _values_by_qname_text(qs):
    """Handle text/date question by question_name."""
    data = [
        {
            "value": row["latest_text_value"] or "",
            "label": str(row["parent_id"]),
            "group": str(row["parent_id"]),
        }
        for row in qs.filter(
            latest_text_value__isnull=False
        ).values("parent_id", "latest_text_value")
    ]
    labels = [d["label"] for d in data]
    return data, labels
