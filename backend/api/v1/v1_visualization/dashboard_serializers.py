from rest_framework import serializers
from api.v1.v1_visualization.constants import (
    VALID_GROUP_BY,
    VALID_MONITORING,
    VALID_VALUE_TYPE,
    VALID_REPEAT_AGG,
    VALID_STACK_BY,
    SUPPORTED_QUESTION_TYPES,
)
from api.v1.v1_forms.models import Forms, Questions


class ValuesFilterSerializer(serializers.Serializer):
    """Validates query parameters for /visualization/values endpoint."""

    form_id = serializers.IntegerField(required=True)
    question_id = serializers.IntegerField(required=False)
    monitoring = serializers.ChoiceField(
        choices=list(VALID_MONITORING),
        default="latest",
    )
    group_by = serializers.ChoiceField(
        choices=list(VALID_GROUP_BY),
        required=False,
        allow_null=True,
    )
    stack_by = serializers.ChoiceField(
        choices=list(VALID_STACK_BY),
        required=False,
        allow_null=True,
    )
    sum_by = serializers.ChoiceField(
        choices=["id", "parent_id"],
        required=False,
        allow_null=True,
    )
    value_type = serializers.ChoiceField(
        choices=list(VALID_VALUE_TYPE),
        default="number",
    )
    repeat_agg = serializers.ChoiceField(
        choices=list(VALID_REPEAT_AGG),
        default="average",
    )
    from_date = serializers.DateField(required=False)
    to_date = serializers.DateField(required=False)
    date_question_id = serializers.IntegerField(required=False)
    administration_id = serializers.IntegerField(required=False)
    option_value = serializers.CharField(required=False)

    def validate_form_id(self, value):
        if not Forms.objects.filter(pk=value).exists():
            raise serializers.ValidationError(
                f"Form {value} not found."
            )
        return value

    def validate(self, data):
        form_id = data.get("form_id")
        question_id = data.get("question_id")
        stack_by = data.get("stack_by")
        group_by = data.get("group_by")

        # Validate question belongs to form and is supported type
        if question_id:
            question = Questions.objects.filter(
                pk=question_id,
                form_id=form_id,
            ).first()
            if not question:
                raise serializers.ValidationError({
                    "question_id": (
                        f"Question {question_id} not found"
                        f" on form {form_id}."
                    ),
                })
            if question.type not in SUPPORTED_QUESTION_TYPES:
                raise serializers.ValidationError({
                    "question_id": (
                        f"Question type {question.type}"
                        " is not supported."
                    ),
                })
            data["question"] = question

        # stack_by requires group_by and question_id
        if stack_by:
            if not group_by:
                raise serializers.ValidationError({
                    "stack_by": "stack_by requires group_by.",
                })
            if not question_id:
                raise serializers.ValidationError({
                    "stack_by": "stack_by requires question_id.",
                })

        return data
