from rest_framework import serializers
from api.v1.v1_visualization.constants import (
    VALID_GROUP_BY,
    VALID_MONITORING,
    VALID_VALUE_TYPE,
    VALID_REPEAT_AGG,
    VALID_STACK_BY,
    VALID_CRITERIA_TYPES,
    VALID_COLUMN_SOURCES,
    VALID_PROGRESS_FORMULAS,
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


class EscalationFilterSerializer(serializers.Serializer):
    """Validates query parameters for /visualization/escalation.

    Criteria format: comma-separated, colon-delimited.
      option_equals:{qid}:{value}
      threshold_gt:{qid}:{value}
      threshold_lt:{qid}:{value}
      overdue:{completion_qid}:{deadline_qid}

    Columns format: comma-separated, colon-delimited.
      {key}:parent_name
      {key}:administration
      {key}:answer:{qid}
      {key}:latest_date:{date_qid}
    """

    monitoring_form_id = serializers.IntegerField(required=True)
    criteria = serializers.CharField(required=True)
    columns = serializers.CharField(required=True)
    page = serializers.IntegerField(default=1, min_value=1)
    page_size = serializers.IntegerField(
        default=20, min_value=1, max_value=100,
    )
    from_date = serializers.DateField(required=False)
    to_date = serializers.DateField(required=False)
    date_question_id = serializers.IntegerField(required=False)
    administration_id = serializers.IntegerField(required=False)

    def validate_criteria(self, value):
        """Parse and validate criteria string."""
        parsed = []
        for item in value.split(","):
            parts = item.strip().split(":")
            if len(parts) < 3:
                raise serializers.ValidationError(
                    f"Invalid criteria format: '{item}'."
                    " Expected type:qid:value"
                )
            ctype = parts[0]
            if ctype not in VALID_CRITERIA_TYPES:
                raise serializers.ValidationError(
                    f"Invalid criteria type: '{ctype}'."
                    f" Options: {VALID_CRITERIA_TYPES}"
                )

            try:
                if ctype == "option_equals":
                    qid = int(parts[1])
                    normalized = [qid, parts[2]]
                elif ctype in ("threshold_gt", "threshold_lt"):
                    qid = int(parts[1])
                    threshold = float(parts[2])
                    normalized = [qid, threshold]
                elif ctype == "overdue":
                    completion_qid = int(parts[1])
                    deadline_qid = int(parts[2])
                    normalized = [completion_qid, deadline_qid]
            except ValueError:
                raise serializers.ValidationError(
                    f"Invalid numeric value in criteria: '{item}'."
                )

            parsed.append({
                "type": ctype,
                "parts": normalized,
            })
        return parsed

    def validate_columns(self, value):
        """Parse and validate columns string."""
        qid_required_sources = {
            "answer", "parent_answer", "latest_date",
        }
        parsed = []
        for item in value.split(","):
            parts = item.strip().split(":")
            if len(parts) < 2:
                raise serializers.ValidationError(
                    f"Invalid column format: '{item}'."
                    " Expected key:source[:qid]"
                )
            key = parts[0]
            source = parts[1]
            if source not in VALID_COLUMN_SOURCES:
                raise serializers.ValidationError(
                    f"Invalid column source: '{source}'."
                    f" Options: {VALID_COLUMN_SOURCES}"
                )
            col = {"key": key, "source": source}
            if source in qid_required_sources and len(parts) < 3:
                raise serializers.ValidationError(
                    f"Column source '{source}' requires a"
                    f" question_id: '{item}'"
                )
            if len(parts) > 2:
                try:
                    col["question_id"] = int(parts[2])
                except ValueError:
                    raise serializers.ValidationError(
                        f"Invalid question_id in column: '{item}'."
                    )
            parsed.append(col)
        return parsed


class ProgressFilterSerializer(serializers.Serializer):
    """Validates query parameters for /visualization/progress.

    Components format: comma-separated, colon-delimited.
      {key}:{formula}:{qid1}:{qid2}:...:{total_items}

    Example:
      base:any_yes:111:222:333,tank:completed_binary:444,
      pipes:ratio:555,security:multi_select_proportion:666:3
    """

    monitoring_form_id = serializers.IntegerField(
        required=True
    )
    components = serializers.CharField(required=True)
    filter_question_id = serializers.IntegerField(
        required=False
    )
    filter_option_value = serializers.CharField(
        required=False
    )
    from_date = serializers.DateField(required=False)
    to_date = serializers.DateField(required=False)
    date_question_id = serializers.IntegerField(
        required=False
    )
    administration_id = serializers.IntegerField(
        required=False
    )

    def validate_components(self, value):
        """Parse and validate components string."""
        parsed = []
        for item in value.split(","):
            parts = item.strip().split(":")
            if len(parts) < 3:
                raise serializers.ValidationError(
                    f"Invalid component format: '{item}'."
                    " Expected key:formula:qid[:qid...]"
                )
            key = parts[0]
            formula = parts[1]
            if formula not in VALID_PROGRESS_FORMULAS:
                raise serializers.ValidationError(
                    f"Invalid formula: '{formula}'."
                    f" Options: {VALID_PROGRESS_FORMULAS}"
                )

            comp = {"key": key, "formula": formula}

            if formula == "multi_select_proportion":
                # Last segment is total_items
                if len(parts) < 4:
                    raise serializers.ValidationError(
                        f"{formula} requires total_items:"
                        f" '{item}'"
                    )
                comp["question_ids"] = [
                    int(q) for q in parts[2:-1]
                ]
                comp["total_items"] = int(parts[-1])
            elif formula == "ratio":
                # ratio requires implemented_qid:planned_qid
                if len(parts) != 4:
                    raise serializers.ValidationError(
                        f"{formula} requires exactly two"
                        " question ids"
                        " (implemented:planned):"
                        f" '{item}'"
                    )
                comp["question_ids"] = [
                    int(parts[2]), int(parts[3]),
                ]
            else:
                comp["question_ids"] = [
                    int(q) for q in parts[2:]
                ]

            parsed.append(comp)
        return parsed
