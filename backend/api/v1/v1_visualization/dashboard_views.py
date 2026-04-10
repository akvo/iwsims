from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from drf_spectacular.utils import extend_schema, OpenApiParameter
from drf_spectacular.types import OpenApiTypes
from rest_framework.generics import get_object_or_404
from api.v1.v1_forms.models import Forms
from api.v1.v1_forms.constants import QuestionTypes
from api.v1.v1_visualization.dashboard_serializers import (
    ValuesFilterSerializer,
)
from api.v1.v1_visualization.functions import (
    handle_count_mode,
    handle_option_question,
    handle_number_question,
)
from utils.custom_serializer_fields import (
    validate_serializers_message,
)


@extend_schema(
    description="Generic visualization values endpoint",
    tags=["Visualization"],
    parameters=[
        OpenApiParameter(
            name="form_id", required=True,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="question_id", required=False,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="monitoring", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["latest", "all"],
        ),
        OpenApiParameter(
            name="group_by", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=[
                "date", "month", "id",
                "parent_id", "option",
            ],
        ),
        OpenApiParameter(
            name="stack_by", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["option", "parent_id"],
        ),
        OpenApiParameter(
            name="sum_by", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["id", "parent_id"],
        ),
        OpenApiParameter(
            name="value_type", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["number", "percentage"],
        ),
        OpenApiParameter(
            name="repeat_agg", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=[
                "average", "sum", "max", "min", "last",
            ],
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
        OpenApiParameter(
            name="date_question_id", required=False,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="administration_id", required=False,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="option_value", required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
        ),
    ],
)
@api_view(["GET"])
def visualization_values(request, version):
    """Generic visualization values endpoint.

    Returns aggregated data for charts, KPIs, and tables.
    All configuration via query parameters.
    """
    serializer = ValuesFilterSerializer(
        data=request.query_params
    )
    if not serializer.is_valid():
        return Response(
            {"message": validate_serializers_message(
                serializer.errors
            )},
            status=status.HTTP_400_BAD_REQUEST,
        )

    validated = serializer.validated_data
    form = get_object_or_404(
        Forms, pk=validated["form_id"]
    )
    question = validated.get("question")

    params = {
        "monitoring": validated.get(
            "monitoring", "latest"
        ),
        "group_by": validated.get("group_by"),
        "stack_by": validated.get("stack_by"),
        "sum_by": validated.get("sum_by"),
        "value_type": validated.get(
            "value_type", "number"
        ),
        "repeat_agg": validated.get(
            "repeat_agg", "average"
        ),
        "from_date": validated.get("from_date"),
        "to_date": validated.get("to_date"),
        "date_question_id": validated.get(
            "date_question_id"
        ),
        "administration_id": validated.get(
            "administration_id"
        ),
        "option_value": validated.get("option_value"),
    }

    # Route to handler
    if not question:
        result = handle_count_mode(form, params)
    elif question.type == QuestionTypes.number:
        result = handle_number_question(
            form, question, params
        )
    elif question.type in [
        QuestionTypes.option,
        QuestionTypes.multiple_option,
    ]:
        result = handle_option_question(
            form, question, params
        )
    else:
        result = handle_count_mode(form, params)

    # Format response
    if isinstance(result, dict):
        return Response(result, status=status.HTTP_200_OK)
    data, labels = result
    return Response(
        {"data": data, "labels": labels},
        status=status.HTTP_200_OK,
    )


@extend_schema(
    description="Config-driven escalation table",
    tags=["Visualization"],
)
@api_view(["GET"])
def visualization_escalation(request, form_id, version):
    raise NotImplementedError(
        "visualization_escalation not implemented"
    )


@extend_schema(
    description="Config-driven progress computation",
    tags=["Visualization"],
)
@api_view(["GET"])
def visualization_progress(request, form_id, version):
    raise NotImplementedError(
        "visualization_progress not implemented"
    )
