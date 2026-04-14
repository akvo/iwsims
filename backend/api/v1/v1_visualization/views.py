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
)
from api.v1.v1_visualization.models import ViewDataOptions
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
            if adm.path:
                adm_path = f"{adm.path}{adm.id}."
            queryset = queryset.filter(
                Q(administration=adm) |
                Q(administration__path__startswith=adm_path)
            )
        queryset = queryset.values(
            "id", "name", "geo", "administration_id"
        )
        serializer = GeoLocationListSerializer(queryset, many=True)
        return Response(
            serializer.data,
            status=status.HTTP_200_OK
        )
