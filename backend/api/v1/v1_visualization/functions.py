import logging
from collections import defaultdict

from django.db import connection
from django.db.models import (
    Avg, Count, Q, Subquery, OuterRef, Exists,
)
from django.db.models.functions import Substr
from datetime import datetime as dt_datetime, timedelta, date
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Questions, QuestionOptions
from api.v1.v1_forms.constants import QuestionTypes
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
    include_unanswered = params.get("include_unanswered", False)
    include_empty = params.get("include_empty", False)
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

    # For a date question (e.g. inspection_date), recency/window filters
    # must compare the latest *answer* date, not the submission timestamp —
    # "COUNT plants with latest inspection_date >= today - N". Detect the
    # type up front so _apply_qname_date_filter can switch fields.
    qtype = qs.values_list("question_type", flat=True).first()
    qs = _apply_qname_date_filter(
        qs, rolling_months, from_date, to_date,
        date_answer=(qtype == QuestionTypes.date),
    )

    # Registration fallback: mv_cross_form_latest holds monitoring answers
    # only (parent_id NOT NULL). A registration-form attribute (e.g. a
    # plant's design capacity) therefore has no rows here. When the query
    # is scoped to a family (parent_form_id) and that registration form
    # actually carries the question, read the registrations' own answers
    # from mv_answer_denormalized instead. The Questions guard ensures we
    # only fall back for a genuine registration attribute, never masking a
    # legitimately-empty monitoring question.
    if (
        qtype is None
        and parent_form_id
        and Questions.objects.filter(
            form_id=parent_form_id, name=question_name
        ).exists()
    ):
        return _registration_values_by_qname(question_name, params)

    # Card / count mode: a single parent count, optionally narrowed to a
    # specific option value. Triggered by sum_by=parent_id or option_value
    # so the number/option aggregation defaults below stay unchanged.
    if sum_by == "parent_id" or option_value:
        return _count_parents_by_qname(
            qs, option_value, value_type, params=params,
            include_unanswered=include_unanswered,
            include_empty=include_empty,
        )

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
        return _values_by_qname_option(
            qs, question_name, group_by, value_type, params
        )
    return _values_by_qname_text(qs)


def _apply_qname_date_filter(
    qs, rolling_months, from_date, to_date, date_answer=False
):
    """Filter a cross-form queryset by recency / date window.

    - rolling_months: keep rows within the last N months (~N*30 days).
    - from_date / to_date: inclusive bounds.

    By default the bounds compare the submission timestamp
    (``latest_created``). When ``date_answer`` is set (the question is
    itself a date, e.g. inspection_date), the bounds compare the latest
    answer's date prefix (``YYYY-MM-DD`` of ``latest_text_value``)
    instead. That prefix is the date as entered in the field's locale,
    so a record captured "today" is not pushed to "tomorrow" by a UTC
    conversion of its submission timestamp.
    """
    def _iso(d):
        return d.isoformat() if hasattr(d, "isoformat") else str(d)

    if date_answer:
        qs = qs.annotate(_ans_date=Substr("latest_text_value", 1, 10))
        if rolling_months:
            cutoff = (
                timezone.now() - timedelta(days=30 * rolling_months)
            ).date()
            qs = qs.filter(_ans_date__gte=_iso(cutoff))
        if from_date:
            qs = qs.filter(_ans_date__gte=_iso(from_date))
        if to_date:
            qs = qs.filter(_ans_date__lte=_iso(to_date))
        return qs

    if rolling_months:
        cutoff = timezone.now() - timedelta(days=30 * rolling_months)
        qs = qs.filter(latest_created__gte=cutoff)
    if from_date:
        qs = qs.filter(latest_created__date__gte=from_date)
    if to_date:
        qs = qs.filter(latest_created__date__lte=to_date)
    return qs


def _registration_parent_qs(qs, params):
    """Registration datapoints in the same family/admin scope as a
    cross-form queryset — the universe used to add coverage/answer gaps."""
    parent_qs = FormData.objects.filter(
        parent__isnull=True, is_pending=False, is_draft=False,
    )
    parent_form_id = params.get("parent_form_id")
    if parent_form_id:
        parent_qs = parent_qs.filter(form_id=parent_form_id)
    else:
        parent_form_ids = list(
            qs.values_list("parent_form_id", flat=True).distinct()
        )
        parent_qs = parent_qs.filter(form_id__in=parent_form_ids)
    administration_id = params.get("administration_id")
    if administration_id:
        parent_qs = apply_administration_filter(parent_qs, administration_id)
    return parent_qs


def _registration_values_by_qname(question_name, params):
    """Aggregate a registration-form question from the registrations' own
    answers (``mv_answer_denormalized`` rows with ``parent_id IS NULL``).

    Scoped to a single registration form via ``parent_form_id`` so a
    registration attribute (e.g. ``designed_capacity_megalitres``) yields
    one value per plant (the registration datapoint *is* the plant). Used
    as the fallback when ``mv_cross_form_latest`` — monitoring-only — has
    no rows for the question. Mirrors the response shape of the cross-form
    helpers: ``([{value, label, group}], [labels])``.

    Supports number aggregation (``group_by=parent_id`` → per plant, else a
    single total) honouring ``repeat_agg`` (sum/avg/max/min), plus a basic
    distinct-datapoint count for card / option_value modes. Dates are
    ignored: a registration attribute has no monitoring timeline.
    """
    parent_form_id = params.get("parent_form_id")
    group_by = params.get("group_by")
    repeat_agg = params.get("repeat_agg", "average")
    option_value = params.get("option_value")
    sum_by = params.get("sum_by")

    rows = MVAnswerDenormalized.objects.filter(
        form_id=parent_form_id,
        parent_id__isnull=True,
        question_name=question_name,
    )
    administration_id = params.get("administration_id")
    if administration_id:
        rows = apply_administration_filter_mv(
            rows, administration_id, field="administration_id",
        )

    # Card / count mode: distinct registrations, optionally option-matched.
    if sum_by == "parent_id" or option_value:
        base = rows
        if option_value:
            base = base.filter(answer_options__contains=[option_value])
        count = base.values("data_id").distinct().count()
        label = option_value or "Total"
        return (
            [{"value": count, "label": label,
              "group": option_value or "total"}],
            [label],
        )

    qtype = rows.values_list("question_type", flat=True).first()
    stack_by = params.get("stack_by")

    # Option / multiple_option grouped per registration datapoint.
    if group_by == "parent_id" and qtype in (5, 6):
        selected = {}
        for r in rows.filter(answer_options__isnull=False).values(
            "data_id", "answer_options",
        ):
            selected.setdefault(r["data_id"], []).extend(
                r["answer_options"] or []
            )
        if not selected:
            return [], []
        name_map = dict(
            FormData.objects.filter(id__in=list(selected.keys()))
            .values_list("id", "name")
        )

        # stack_by=option → option-as-columns shape with an INT group, so
        # cross_tab can join it against the form-pinned category response
        # (mirrors _stack_option_by_parent_from_mv). Otherwise → one value
        # array per datapoint (mirrors _values_by_qname_option), as the map
        # marker / chip consumers expect.
        if stack_by == "option":
            opts = list(
                QuestionOptions.objects.filter(
                    question__name=question_name,
                    question__form_id=parent_form_id,
                    value__isnull=False,
                ).order_by("order", "value").values("value", "label")
            )
            data = []
            for data_id, chosen in selected.items():
                row = {"label": name_map.get(data_id, ""), "group": data_id}
                for opt in opts:
                    row[opt["label"] or opt["value"]] = chosen.count(
                        opt["value"]
                    )
                data.append(row)
            return data, [d["label"] for d in data]

        data = [
            {
                "value": sorted(set(chosen)),
                "label": name_map.get(data_id, str(data_id)),
                "group": str(data_id),
            }
            for data_id, chosen in selected.items()
        ]
        return data, [d["label"] for d in data]

    # Number aggregation. Collapse repeats per registration datapoint.
    per = {}
    for r in rows.filter(answer_value__isnull=False).values(
        "data_id", "answer_value",
    ):
        per.setdefault(r["data_id"], []).append(r["answer_value"])
    if not per:
        return [], []

    def _agg(values):
        if repeat_agg == "sum":
            return sum(values)
        if repeat_agg == "max":
            return max(values)
        if repeat_agg == "min":
            return min(values)
        return sum(values) / len(values)

    if group_by == "parent_id":
        name_map = dict(
            FormData.objects.filter(id__in=list(per.keys()))
            .values_list("id", "name")
        )
        data = [
            {
                "value": round(_agg(vals), 2),
                "label": name_map.get(data_id, str(data_id)),
                "group": str(data_id),
            }
            for data_id, vals in per.items()
        ]
        return data, [d["label"] for d in data]

    all_values = [v for vals in per.values() for v in vals]
    total = (
        sum(all_values)
        if repeat_agg == "sum"
        else sum(all_values) / len(all_values)
    )
    return (
        [{"value": round(total, 2), "label": "Total", "group": "total"}],
        ["Total"],
    )


def _count_parents_by_qname(
    qs, option_value, value_type, params=None,
    include_unanswered=False, include_empty=False,
):
    """Count distinct parents for a question_name (card / KPI mode).

    When option_value is given, count only parents whose latest option
    values contain it. With value_type=percentage, return that count as a
    share of the relevant universe.

    Two optional "gap" inclusions (matching the form-scoped path):

    - include_unanswered: also count registrations with no latest answer
      for this question — whether monitored-but-skipped-it OR never
      monitored (total - parents who answered this question). Used for
      e.g. "No sample taken" = every plant that did not record a sample.
    - include_empty: also count only registrations that were never
      monitored at all (total - parents with any monitoring submission).

    include_unanswered is the broader set and takes precedence when both
    are set.
    """
    params = params or {}
    answered = qs.values("parent_id").distinct().count()
    if option_value:
        matched = (
            qs.filter(latest_option_values__contains=[option_value])
            .values("parent_id")
            .distinct()
            .count()
        )
    else:
        matched = answered

    extra = 0
    denominator = answered
    if include_unanswered or include_empty:
        parent_qs = _registration_parent_qs(qs, params)
        denominator = parent_qs.values("id").distinct().count()
        if include_unanswered:
            # No latest answer for this question (monitored-skipped +
            # never-monitored).
            extra = max(0, denominator - answered)
        else:
            # Coverage gap only: registrations with zero monitoring.
            child = FormData.objects.filter(
                parent_id=OuterRef("id"),
                is_pending=False, is_draft=False,
            )
            monitored = parent_qs.filter(Exists(child)).count()
            extra = max(0, denominator - monitored)

    if value_type == "percentage":
        value = round(
            (matched + extra) / denominator * 100, 2
        ) if denominator else 0
    else:
        value = matched + extra

    label = option_value or "Total"
    group = option_value or "total"
    return [{"value": value, "label": label, "group": group}], [label]


def _qname_combo_label(combo_values, option_labels):
    """Human label for a form-order option-value combo."""
    if len(combo_values) > 1:
        return "Mixed"
    return " + ".join(
        option_labels.get(value, value) for value in combo_values
    )


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


def _values_by_qname_option(
    qs, question_name, group_by, value_type, params=None
):
    """Handle option question aggregation by question_name."""
    params = params or {}
    parent_form_id = params.get("parent_form_id")
    include_unanswered = params.get("include_unanswered", False)

    # Deduplicate options by value. When parent_form_id is provided,
    # scope option metadata to monitoring forms under that registration
    # family; otherwise national/cross-family queries keep the global
    # option union.
    raw_opts = QuestionOptions.objects.filter(
        question__name=question_name,
        value__isnull=False,
    )
    if parent_form_id:
        raw_opts = raw_opts.filter(question__form__parent_id=parent_form_id)
    raw_opts = raw_opts.order_by(
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

    if group_by == "option_combo":
        return _values_by_qname_option_combo(
            qs, options, value_type, include_unanswered, params
        )

    # default: group_by == "option"
    tallies = defaultdict(int)
    answered_parent_ids = set()
    for row in qs.values("parent_id", "latest_option_values"):
        opts = row["latest_option_values"] or []
        for opt_value in opts:
            tallies[opt_value] += 1
        if opts:
            answered_parent_ids.add(row["parent_id"])

    bucket_count = 0
    if include_unanswered:
        parent_qs = FormData.objects.filter(
            parent__isnull=True,
            is_pending=False,
            is_draft=False,
        )
        if parent_form_id:
            parent_qs = parent_qs.filter(form_id=parent_form_id)
        else:
            parent_form_ids = list(
                qs.values_list("parent_form_id", flat=True).distinct()
            )
            parent_qs = parent_qs.filter(form_id__in=parent_form_ids)
        administration_id = params.get("administration_id")
        if administration_id:
            parent_qs = apply_administration_filter(
                parent_qs, administration_id
            )
        bucket_count = max(0, parent_qs.count() - len(answered_parent_ids))

    data = []
    for opt in options:
        count = tallies.get(opt["value"], 0)
        denominator = len(answered_parent_ids) + bucket_count
        if value_type == "percentage" and denominator > 0:
            value = round(count / denominator * 100, 2)
        else:
            value = count
        data.append({
            "value": value,
            "label": opt["label"] or opt["value"],
            "group": opt["value"],
            "color": opt.get("color"),
        })

    if include_unanswered and bucket_count > 0:
        if value_type == "percentage":
            denominator = len(answered_parent_ids) + bucket_count
            value = round(bucket_count / denominator * 100, 2)
        else:
            value = bucket_count
        data.append({
            "value": value,
            "label": "No information available",
            "group": "_no_info",
            "color": "#bfbfbf",
        })

    labels = [d["label"] for d in data]
    return data, labels


def _values_by_qname_option_combo(
    qs, options, value_type, include_unanswered, params
):
    """Handle combo buckets for question_name multiple_option queries."""
    params = params or {}
    parent_form_id = params.get("parent_form_id")
    option_values = {o["value"] for o in options}
    option_labels = {
        o["value"]: o["label"] or o["value"] for o in options
    }
    option_colors = {o["value"]: o.get("color") for o in options}
    option_order = {
        o["value"]: i for i, o in enumerate(options)
    }

    tallies = defaultdict(int)
    answered_parent_ids = set()
    for row in qs.values("parent_id", "latest_option_values"):
        combo_values = sorted(
            (
                value for value in (row["latest_option_values"] or [])
                if value in option_values
            ),
            key=lambda value: option_order.get(value, len(option_order)),
        )
        if not combo_values:
            continue
        combo_key = "|".join(combo_values)
        tallies[combo_key] += 1
        answered_parent_ids.add(row["parent_id"])

    bucket_count = 0
    if include_unanswered:
        parent_qs = FormData.objects.filter(
            parent__isnull=True,
            is_pending=False,
            is_draft=False,
        )
        if parent_form_id:
            parent_qs = parent_qs.filter(form_id=parent_form_id)
        else:
            parent_form_ids = list(
                qs.values_list("parent_form_id", flat=True).distinct()
            )
            parent_qs = parent_qs.filter(form_id__in=parent_form_ids)
        administration_id = params.get("administration_id")
        if administration_id:
            parent_qs = apply_administration_filter(
                parent_qs, administration_id
            )
        bucket_count = max(0, parent_qs.count() - len(answered_parent_ids))

    denominator = sum(tallies.values()) + bucket_count

    ordered_keys = [opt["value"] for opt in options]
    fallback_combo_keys = []
    if len(options) == 2:
        fallback_combo_keys.append(
            "|".join(opt["value"] for opt in options)
        )
    observed_combo_keys = sorted(
        (
            key for key in set(tallies.keys()) | set(fallback_combo_keys)
            if "|" in key
        ),
        key=lambda key: [
            option_order.get(value, len(option_order))
            for value in key.split("|")
        ],
    )
    ordered_keys.extend(observed_combo_keys)

    data = []
    for key in ordered_keys:
        count = tallies.get(key, 0)
        if value_type == "percentage" and denominator > 0:
            value = round(count / denominator * 100, 2)
        else:
            value = count
        combo_values = key.split("|")
        data.append({
            "value": value,
            "label": _qname_combo_label(combo_values, option_labels),
            "group": key,
            "color": option_colors.get(key) if "|" not in key else None,
        })

    if include_unanswered and bucket_count > 0:
        if value_type == "percentage" and denominator > 0:
            value = round(bucket_count / denominator * 100, 2)
        else:
            value = bucket_count
        data.append({
            "value": value,
            "label": "No information available",
            "group": "_no_info",
            "color": "#bfbfbf",
        })

    labels = [d["label"] for d in data]
    return data, labels


def _values_by_qname_text(qs):
    """Handle text/date question by question_name."""
    rows = list(
        qs.filter(latest_text_value__isnull=False)
        .values("parent_id", "latest_text_value")
    )
    parent_ids = [row["parent_id"] for row in rows]
    name_map = dict(
        FormData.objects.filter(id__in=parent_ids)
        .values_list("id", "name")
    )
    data = [
        {
            "value": row["latest_text_value"] or "",
            "label": name_map.get(row["parent_id"], str(row["parent_id"])),
            "group": str(row["parent_id"]),
        }
        for row in rows
    ]
    labels = [d["label"] for d in data]
    return data, labels
