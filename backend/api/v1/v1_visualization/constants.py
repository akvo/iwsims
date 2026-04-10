from django.db.models import Avg, Sum, Max, Min
from api.v1.v1_forms.constants import QuestionTypes

VALID_GROUP_BY = {"date", "month", "id", "parent_id", "option"}
VALID_MONITORING = {"latest", "all"}
VALID_VALUE_TYPE = {"number", "percentage"}
VALID_REPEAT_AGG = {"average", "sum", "max", "min", "last"}
VALID_STACK_BY = {"option", "parent_id"}
SUPPORTED_QUESTION_TYPES = {
    QuestionTypes.number,
    QuestionTypes.option,
    QuestionTypes.multiple_option,
    QuestionTypes.date,
}
AGG_FUNCS = {
    "average": Avg,
    "sum": Sum,
    "max": Max,
    "min": Min,
}

# Escalation criteria types
VALID_CRITERIA_TYPES = {
    "option_equals",
    "threshold_gt",
    "threshold_lt",
    "overdue",
}

# Escalation column source types
VALID_COLUMN_SOURCES = {
    "parent_name",
    "administration",
    "answer",
    "latest_date",
}

# Progress formula types
VALID_PROGRESS_FORMULAS = {
    "any_yes",
    "completed_binary",
    "ratio",
    "multi_select_proportion",
}
