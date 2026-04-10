from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from drf_spectacular.utils import extend_schema, OpenApiParameter
from drf_spectacular.types import OpenApiTypes


@extend_schema(
    description="Generic visualization values endpoint",
    tags=["Visualization"],
    parameters=[
        OpenApiParameter(
            name="form_id",
            required=True,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="question_id",
            required=False,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="monitoring",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["latest", "all"],
        ),
        OpenApiParameter(
            name="group_by",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["date", "month", "id", "parent_id", "option"],
        ),
        OpenApiParameter(
            name="sum_by",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["id", "parent_id"],
        ),
        OpenApiParameter(
            name="value_type",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["number", "percentage"],
        ),
        OpenApiParameter(
            name="repeat_agg",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["average", "sum", "max", "min", "last"],
        ),
        OpenApiParameter(
            name="stack_by",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
            enum=["option", "parent_id"],
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
            name="date_question_id",
            required=False,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="administration_id",
            required=False,
            type=OpenApiTypes.INT,
            location=OpenApiParameter.QUERY,
        ),
        OpenApiParameter(
            name="option_value",
            required=False,
            type=OpenApiTypes.STR,
            location=OpenApiParameter.QUERY,
        ),
    ],
)
@api_view(["GET"])
def visualization_values(request, version):
    raise NotImplementedError("visualization_values not implemented")


@extend_schema(
    description="Config-driven escalation table",
    tags=["Visualization"],
)
@api_view(["GET"])
def visualization_escalation(request, form_id, version):
    raise NotImplementedError("visualization_escalation not implemented")


@extend_schema(
    description="Config-driven progress computation",
    tags=["Visualization"],
)
@api_view(["GET"])
def visualization_progress(request, form_id, version):
    raise NotImplementedError("visualization_progress not implemented")
