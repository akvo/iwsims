import json
import os

from django.utils import timezone
from api.v1.v1_data.models import Answers, AnswerHistory
from api.v1.v1_forms.constants import QuestionTypes
from api.v1.v1_profile.models import Administration


def atomic_write(path: str, content: str) -> None:
    """Write content to path atomically via tmp+rename.

    Prevents concurrent readers from seeing a zero-byte file during the
    truncate/write window of `open(path, "w")`.
    """
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        f.write(content)
    os.replace(tmp, path)


def atomic_write_json(path: str, obj) -> None:
    atomic_write(path, json.dumps(obj, indent=2))


def update_date_time_format(date):
    if date:
        # date = timezone.datetime.strptime(date, "%Y-%m-%d").date()
        if not timezone.is_naive(date):
            return timezone.localtime(date).strftime("%Y-%m-%d %I:%M %p")
        return date.strftime("%Y-%m-%d %I:%M %p")
    return None


def _typed_value(question_type, options, value, name):
    """Shared typed extraction for get_answer_value / get_answer_history.

    Handles the branches both functions agree on: geo / option /
    multiple_option return the options list, number returns the numeric
    value, everything else (text, date, cascade, …) returns the name.
    The administration type is handled by the callers, which differ on
    webform expansion and None handling.
    """
    if question_type in (
        QuestionTypes.geo,
        QuestionTypes.option,
        QuestionTypes.multiple_option,
    ):
        return options
    if question_type == QuestionTypes.number:
        return value
    return name


def get_answer_value(answer: Answers, webform: bool = False):
    if answer.question.type == QuestionTypes.administration:
        if webform:
            adm = Administration.objects.filter(id=answer.value).first()
            if adm:
                return [
                    a.id
                    for a in adm.ancestors.exclude(parent__isnull=True).all()
                ] + [adm.id]
            return answer.value
        return int(float(answer.value)) if answer.value else None
    return _typed_value(
        answer.question.type, answer.options, answer.value, answer.name
    )


def get_answer_history(answer_history: AnswerHistory):
    created = update_date_time_format(answer_history.created)
    created_by = answer_history.created_by.get_full_name()
    if answer_history.question.type == QuestionTypes.administration:
        value = int(float(answer_history.value))
    else:
        value = _typed_value(
            answer_history.question.type,
            answer_history.options,
            answer_history.value,
            answer_history.name,
        )
    return {"value": value, "created": created, "created_by": created_by}
