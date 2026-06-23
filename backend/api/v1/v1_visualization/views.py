import json
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from datetime import datetime
from django.db.models import Q
from api.v1.v1_data.models import FormData, Answers
from api.v1.v1_forms.models import Forms, QuestionTypes
from api.v1.v1_visualization.serializers import (
    MonitoringStatSerializer,
    GeoLocationListSerializer,
    GeoLocationFilterSerializer,
    FormDataStatSerializer,
    FormDataStatsFilterSerializer,
    FormulaValuesSerializer,
    DatapointDetailSerializer,
)
from api.v1.v1_visualization.models import (
    ViewDataOptions,
    MVAnswerDenormalized,
    MVCrossFormLatest,
)
from api.v1.v1_visualization.functions import (
    apply_criteria_to_monitoring_qs,
    build_date_filters,
    get_latest_monitoring_subquery,
)
from api.v1.v1_visualization.formula import (
    evaluate as formula_evaluate,
    pick_latest_repeat,
)
from drf_spectacular.utils import extend_schema, OpenApiParameter
from drf_spectacular.types import OpenApiTypes
from rest_framework.generics import get_object_or_404
from rest_framework.views import APIView
# from rest_framework.permissions import IsAuthenticated
from utils.custom_serializer_fields import validate_serializers_message


@extend_schema(
    description=(
        "Get the statistics of form data based on"
        "a specific monitoring form ID and question ID."
    ),
    tags=["Visualization"],
    responses=FormDataStatSerializer(many=True),
    parameters=[
        OpenApiParameter(
            name="question_id",
            required=True,
            type=OpenApiTypes.NUMBER,
            location=OpenApiParameter.QUERY,
            description="The question ID to extract the value from",
        ),
    ],
)
@api_view(["GET"])
def formdata_stats(request, form_id, version):
    form = get_object_or_404(Forms, pk=form_id)
    serializer = FormDataStatsFilterSerializer(
        data=request.GET,
        context={"form": form}
    )
    if not serializer.is_valid():
        return Response(
            {"message": validate_serializers_message(serializer.errors)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    question = serializer.validated_data.get("question_id")
    options = []
    if not form.parent:
        if question.type in [
            QuestionTypes.option,
            QuestionTypes.multiple_option,
        ]:
            options = question.options.all()
        data = []
        for d in form.form_form_data.filter(
            is_pending=False,
            is_draft=False,
        ).all():
            if question.type == QuestionTypes.number:
                data.extend([
                    {
                        "id": d.id,
                        "value": a.value,
                    }
                    for a in d.data_answer.filter(
                        question_id=question.id
                    ).all()
                ])
            if question.type in [
                QuestionTypes.option,
                QuestionTypes.multiple_option,
            ]:
                for a in d.data_answer.filter(
                    question_id=question.id
                ).all():
                    for v in a.options:
                        v_data = question.options.filter(value=v).first()
                        if v_data:
                            data.append({
                                "id": d.id,
                                "value": v_data.id,
                            })
        return Response(
            FormDataStatSerializer(
                instance={
                    "options": options,
                    "data": data,
                }
            ).data,
            status=status.HTTP_200_OK,
        )
    if question.type == QuestionTypes.number:
        parent_form = form.parent
        form_data = parent_form.form_form_data.filter(
            is_pending=False,
            is_draft=False,
        ).all()
        data = [
            {
                "id": fd.id,
                "value": a.value,
            }
            for fd in form_data
            for ld in [fd.children.filter(
                form_id=form_id,
                is_pending=False,
                is_draft=False,
            ).last()] if ld
            for a in ld.data_answer.filter(
                question_id=question.id
            ).all()
        ]
        return Response(
            FormDataStatSerializer(
                instance={
                    "options": options,
                    "data": data,
                }
            ).data,
            status=status.HTTP_200_OK,
        )
    if question.type in [
        QuestionTypes.option,
        QuestionTypes.multiple_option,
    ]:
        options = question.options.all()
    data_options = ViewDataOptions.objects.filter(
        form=form,
    ).all()
    data = [
        {
            "id": do.parent_data_id,
            "value": v,
            "question_id": int(o.split("||")[0]),
        }
        for do in data_options
        for o in do.options
        for v in json.loads(o.split("||")[1])
    ]
    # filter data based on the question_id
    data = list(filter(
        lambda x: x["question_id"] == question.id, data
    ))
    return Response(
        FormDataStatSerializer(
            instance={
                "options": options,
                "data": data,
            }
        ).data,
        status=status.HTTP_200_OK,
    )


@extend_schema(
    description="Get the statistic of on monitoring data",
    tags=["Visualization"],
    responses=MonitoringStatSerializer(many=True),
    parameters=[
        OpenApiParameter(
            name="parent_id",
            required=True,
            type=OpenApiTypes.NUMBER,
            location=OpenApiParameter.QUERY,
            description="The parent ID to filter FormData",
        ),
        OpenApiParameter(
            name="question_id",
            required=True,
            type=OpenApiTypes.NUMBER,
            location=OpenApiParameter.QUERY,
            description="The question ID to extract the value from",
        ),
        OpenApiParameter(
            name="question_date",
            required=False,
            type=OpenApiTypes.NUMBER,
            location=OpenApiParameter.QUERY,
            description="the question to extract the date from (optional)",
        ),
    ],
)
@api_view(["GET"])
def monitoring_stats(request, version):
    parent_id = request.query_params.get("parent_id")
    question_id = request.query_params.get("question_id")
    question_date_key = request.query_params.get("question_date")

    if not parent_id or not question_id:
        return Response(
            {"detail": "Missing required parameters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        formdata_qs = FormData.objects.filter(parent_id=parent_id)
        stats = []

        for formdata in formdata_qs:
            answer = Answers.objects.filter(
                data=formdata, question_id=question_id
            ).first()
            if not answer:
                continue

            # Default date
            date = formdata.created

            # Optional override from another question
            if question_date_key:
                date_answer = Answers.objects.filter(
                    data=formdata, question_id=question_date_key
                ).first()
                if date_answer and date_answer.name:
                    parsed_date = datetime.strptime(
                        date_answer.name, "%Y-%m-%dT%H:%M:%S.%fZ"
                    )
                    if parsed_date:
                        date = parsed_date

            stats.append(
                {
                    "date": date.date(),
                    "value": answer.name or answer.value or answer.options,
                }
            )

        serializer = MonitoringStatSerializer(stats, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    except Exception as e:
        return Response(
            {"detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


class GeolocationListView(APIView):
    # permission_classes = [IsAuthenticated]

    @extend_schema(
        responses=GeoLocationListSerializer,
        parameters=[
            OpenApiParameter(
                name="administration",
                required=False,
                type=OpenApiTypes.NUMBER,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="criteria",
                required=False,
                type=OpenApiTypes.STR,
                location=OpenApiParameter.QUERY,
                description=(
                    "AND-joined multi-criteria filter "
                    "(same grammar as /values)."
                ),
            ),
            OpenApiParameter(
                name="from_date",
                required=False,
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="to_date",
                required=False,
                type=OpenApiTypes.DATE,
                location=OpenApiParameter.QUERY,
            ),
            OpenApiParameter(
                name="include_monitoring",
                required=False,
                type=OpenApiTypes.BOOL,
                location=OpenApiParameter.QUERY,
                description=(
                    "When true, from_date / to_date filter by the "
                    "datapoint's monitoring children's created date "
                    "instead of the datapoint's own created date."
                ),
            ),
            OpenApiParameter(
                name="monitoring_form_id",
                required=False,
                type=OpenApiTypes.NUMBER,
                location=OpenApiParameter.QUERY,
                description=(
                    "When include_monitoring=true, restrict the "
                    "children join to this form ID so that unrelated "
                    "child forms do not satisfy the date window."
                ),
            ),
        ],
        tags=["Maps"],
        summary="To get list of geolocations for a form",
    )
    def get(self, request, form_id, version):
        serializer = GeoLocationFilterSerializer(
            data=request.GET, context={"form_id": form_id}
        )
        if not serializer.is_valid():
            # Return empty list if serializer is not valid
            return Response(
                data=[],
                status=status.HTTP_200_OK,
            )
        form = get_object_or_404(Forms, pk=form_id)
        queryset = form.form_form_data.filter(
            is_pending=False,
            is_draft=False,
            geo__isnull=False
        )
        criteria = serializer.validated_data.get("criteria")
        if criteria:
            queryset = apply_criteria_to_monitoring_qs(
                queryset, False, criteria,
            )

        from_date = serializer.validated_data.get("from_date")
        to_date = serializer.validated_data.get("to_date")
        include_monitoring = serializer.validated_data.get(
            "include_monitoring", False
        )

        monitoring_form_id = serializer.validated_data.get(
            "monitoring_form_id"
        )
        if include_monitoring and (from_date or to_date):
            child_q = Q()
            if from_date:
                child_q &= Q(children__created__date__gte=from_date)
            if to_date:
                child_q &= Q(children__created__date__lte=to_date)
            child_filter = {
                "children__is_pending": False,
                "children__is_draft": False,
            }
            if monitoring_form_id:
                child_filter["children__form_id"] = monitoring_form_id
            queryset = queryset.filter(
                child_q, **child_filter
            ).distinct()
        else:
            if from_date:
                queryset = queryset.filter(created__date__gte=from_date)
            if to_date:
                queryset = queryset.filter(created__date__lte=to_date)

        if serializer.validated_data.get("administration"):
            adm = serializer.validated_data.get("administration")
            adm_path = f"{adm.id}."
            if adm.path:
                adm_path = f"{adm.path}{adm.id}."
            queryset = queryset.filter(
                Q(administration=adm) |
                Q(administration__path__startswith=adm_path)
            )
        if (
            request.user.is_authenticated and
            not request.user.is_superuser and
            not serializer.validated_data.get("administration")
        ):
            user_role = request.user.user_user_role.order_by(
                "administration__level__level"
            ).first()
            adm = user_role.administration if user_role else None
            if not adm:
                return Response(
                    data=[],
                    status=status.HTTP_200_OK,
                )
            adm_path = f"{adm.id}."
            if adm.path:
                adm_path = f"{adm.path}{adm.id}."
            queryset = queryset.filter(
                Q(administration=adm) |
                Q(administration__path__startswith=adm_path)
            )
        rows = list(
            queryset.values("id", "name", "geo", "administration_id")
        )
        serializer = GeoLocationListSerializer(rows, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class DatapointDetailView(APIView):
    # permission_classes = [IsAuthenticated]
    # public, same as GeolocationListView

    @extend_schema(
        responses=DatapointDetailSerializer,
        tags=["Maps"],
        summary="Lightweight datapoint metadata for the map popup",
        description=(
            "Returns name, administration_full_name, and updated for "
            "a single registration datapoint. Fetched on demand when "
            "the user clicks a map marker; results are cached client-side."
        ),
    )
    def get(self, request, data_id, version):
        point = get_object_or_404(
            FormData, pk=data_id,
            is_pending=False, is_draft=False, parent__isnull=True
        )
        return Response(
            DatapointDetailSerializer(instance=point).data,
            status=status.HTTP_200_OK,
        )


@extend_schema(
    description=(
        "Evaluate a formula against the latest answer for each "
        "registration datapoint in a family, taken across ALL of its "
        "monitoring forms (mv_cross_form_latest) and falling back to "
        "the registration's own answer for questions that only exist "
        "on the registration form. Groups the resulting bucket value "
        "by parent_id. Same response shape as /visualization/values."
    ),
    tags=["Visualization"],
    parameters=[
        OpenApiParameter(
            name="parent_form_id", required=True,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
            description=(
                "The registration (parent) form id. Scopes the "
                "cross-form latest lookup to this registration family."
            ),
        ),
        OpenApiParameter(
            name="group_by", required=True,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["parent_id"],
        ),
        OpenApiParameter(
            name="monitoring", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["latest"],
        ),
        OpenApiParameter(
            name="formula", required=True,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            description=(
                "URL-encoded JSON formula. See "
                "doc/claude/filters-dashboard-mapview/design.md §1.2."
            ),
        ),
        OpenApiParameter(
            name="from_date", required=False,
            type=OpenApiTypes.DATE,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="to_date", required=False,
            type=OpenApiTypes.DATE,
            location=OpenApiParameter.QUERY,
        ),
    ],
)
@api_view(["GET"])
def visualization_values_formula(request, version):
    """Evaluate a formula per registration datapoint, cross-form.

    Scope is the registration family identified by ``parent_form_id``.
    For each registration datapoint (the ``group`` in the response) the
    formula is evaluated against a single answer map built in two layers:

    1. The registration datapoint's own answers (fallback layer). This
       is the only source for questions that live solely on the
       registration form (e.g. ``water_committee``).
    2. The latest value per ``question_name`` taken across ALL of the
       family's monitoring forms (``mv_cross_form_latest``). This layer
       overlays the fallback so a monitoring answer always wins over a
       registration answer for the same question_name.

    This produces {group: parent_id, label: bucket_value}, matching the
    frontend's byParent[point.id] lookup. Question names that exist on
    neither layer simply fail their bucket conditions and fall through
    to the formula's ``default`` bucket.
    """
    serializer = FormulaValuesSerializer(data=request.query_params)
    if not serializer.is_valid():
        return Response(
            {"message": validate_serializers_message(serializer.errors)},
            status=status.HTTP_400_BAD_REQUEST,
        )

    validated = serializer.validated_data
    parent_form_id = validated["parent_form_id"]
    form_id = validated.get("form_id")
    formula = validated["formula"]
    from_date = validated.get("from_date")
    to_date = validated.get("to_date")

    if form_id:
        date_params = {
            "from_date": from_date,
            "to_date": to_date,
        }
        date_filters = build_date_filters(date_params)
        parents = FormData.objects.filter(
            form_id=parent_form_id,
            parent__isnull=True,
            is_pending=False,
            is_draft=False,
        ).annotate(
            latest_id=get_latest_monitoring_subquery(
                form_id, date_filters or None,
            ),
        )
        answers_by_parent = {
            parent_id: {}
            for parent_id in parents.values_list("id", flat=True)
        }
        latest = {
            parent_id: latest_id
            for parent_id, latest_id in parents.exclude(
                latest_id__isnull=True,
            ).values_list("id", "latest_id")
        }
        rows = MVAnswerDenormalized.objects.filter(
            data_id__in=latest.values(),
        ).values(
            "parent_id", "question_name", "answer_value",
            "answer_options",
        )
        numeric = {}
        option_values = {}
        for row in rows:
            key = (row["parent_id"], row["question_name"])
            if row["answer_value"] is not None:
                numeric.setdefault(key, []).append(row["answer_value"])
            if row["answer_options"] is not None:
                option_values.setdefault(key, set()).update(
                    row["answer_options"] or []
                )
        for (parent_id, question_name), values in numeric.items():
            answers_by_parent[parent_id][question_name] = {
                "question_name": question_name,
                "value": sum(values) / len(values),
                "options": None,
                "index": 0,
            }
        for (parent_id, question_name), values in option_values.items():
            answers_by_parent[parent_id][question_name] = {
                "question_name": question_name,
                "value": None,
                "options": sorted(values),
                "index": 0,
            }

        data = [
            {
                "group": parent_id,
                "label": formula_evaluate(formula, per_question),
            }
            for parent_id, per_question in answers_by_parent.items()
        ]
        return Response({"data": data}, status=status.HTTP_200_OK)

    # Layer 1: registration datapoints' own answers. parent_id is NULL
    # for registrations in the denormalized MV; data_id is the
    # registration datapoint id, which is also the group key the map
    # uses (point.id). Collect per datapoint so repeat groups resolve to
    # their latest index via pick_latest_repeat.
    reg_answers = MVAnswerDenormalized.objects.filter(
        form_id=parent_form_id,
        parent_id__isnull=True,
    ).values(
        "data_id", "question_name",
        "answer_value", "answer_options", "answer_index",
    )
    reg_lists = {}
    for ans in reg_answers:
        reg_lists.setdefault(ans["data_id"], []).append({
            "question_name": ans["question_name"],
            "value": ans["answer_value"],
            "options": ans["answer_options"],
            "index": ans["answer_index"],
        })
    answers_by_parent = {
        data_id: pick_latest_repeat(rows)
        for data_id, rows in reg_lists.items()
    }

    # Layer 2: latest monitoring answer per (parent_id, question_name)
    # across ALL of the family's monitoring forms. Overlays the
    # registration fallback so a monitoring answer wins over a
    # registration answer for the same question_name.
    if from_date or to_date:
        # Date-bounded: mv_cross_form_latest is pre-collapsed to each
        # question's absolute latest, so a window can only include or
        # exclude it — it cannot reveal an earlier in-range value.
        # Recompute the latest-in-range from the denormalized MV instead,
        # mirroring mv_cross_form_latest's tiebreak (created, data_id,
        # answer_id all DESC → newest submission, latest repeat).
        family_form_ids = list(
            Forms.objects.filter(parent_id=parent_form_id)
            .values_list("id", flat=True)
        )
        mon = MVAnswerDenormalized.objects.filter(
            form_id__in=family_form_ids,
            parent_id__isnull=False,
        )
        if from_date:
            mon = mon.filter(data_created__date__gte=from_date)
        if to_date:
            mon = mon.filter(data_created__date__lte=to_date)
        mon_rows = mon.order_by(
            "parent_id", "question_name",
            "-data_created", "-data_id", "-answer_id",
        ).values(
            "parent_id", "question_name",
            "answer_value", "answer_options",
        )
        seen = set()
        for row in mon_rows:
            key = (row["parent_id"], row["question_name"])
            if key in seen:
                continue
            seen.add(key)
            per_question = answers_by_parent.setdefault(row["parent_id"], {})
            per_question[row["question_name"]] = {
                "question_name": row["question_name"],
                "value": row["answer_value"],
                "options": row["answer_options"],
                "index": 0,
            }
    else:
        # No window: the pre-aggregated cross-form view is the fast path.
        cross_rows = MVCrossFormLatest.objects.filter(
            parent_form_id=parent_form_id,
        ).values(
            "parent_id", "question_name",
            "latest_numeric_value", "latest_option_values",
        )
        for row in cross_rows:
            per_question = answers_by_parent.setdefault(row["parent_id"], {})
            per_question[row["question_name"]] = {
                "question_name": row["question_name"],
                "value": row["latest_numeric_value"],
                "options": row["latest_option_values"],
                "index": 0,
            }

    data = [
        {"group": parent_id, "label": formula_evaluate(formula, per_question)}
        for parent_id, per_question in answers_by_parent.items()
    ]

    return Response({"data": data}, status=status.HTTP_200_OK)
