import enum
import pandas as pd


class ODKQuestionType(enum.Enum):
    geo = "geopoint"
    option = "select_one"
    multiple_option = "select_multiple"
    cascade = "text"
    text = "text"
    integer = "integer"
    decimal = "decimal"
    photo = "image"
    video = "video"
    date = "date"
    caddisfly = "caddisfly"
    geoshape = "geoshape"
    signature = "signature"
    scan = "scan"


def replace_name(obj):
    return obj.replace(" ", "_").replace("-", "_").lower()


def get_name(obj):
    if "id" in obj:
        return "q_" + obj["id"]
    if "value" in obj:
        return obj["value"]
    if "heading" in obj:
        return replace_name(obj["heading"])
    return replace_name(obj["text"])


def generate_excel_form(form, res_path):
    writer = pd.ExcelWriter(res_path, engine='xlsxwriter')
    choices = pd.DataFrame(columns=['list name', 'name', 'label'])
    survey = pd.DataFrame(columns=['type', 'name', 'label', 'required'])
    for qg in form["questionGroup"]:
        survey = survey.append(
            {
                "type": "begin group",
                "name": get_name(qg),
                "label": qg["heading"],
                "required": "",
            },
            ignore_index=True)
        for q in qg["question"]:
            qtype = ODKQuestionType[q["type"]]
            qid = q["id"]
            if qtype in [
                    ODKQuestionType.option, ODKQuestionType.multiple_option
            ]:
                qtype = f"{qtype.value} {qid}"
                for o in q["options"]["option"]:
                    choices = choices.append(
                        {
                            "list name": qid,
                            "name": get_name(o),
                            "label": o["text"]
                        },
                        ignore_index=True)
            else:
                qtype = qtype.value
            survey = survey.append(
                {
                    "type": qtype,
                    "name": get_name(q),
                    "label": q["text"],
                    "required": q["mandatory"],
                },
                ignore_index=True)
        survey = survey.append(
            {
                "type": "end group",
                "name": "",
                "label": "",
                "required": "",
            },
            ignore_index=True)
    survey.to_excel(writer, sheet_name="survey", index=False)
    choices.to_excel(writer, sheet_name="choices", index=False)
    writer.save()
    return res_path


def odk(form, res_path):
    for group in form["questionGroup"]:
        for q in group["question"]:
            if q["type"] == "option":
                if q.get("options"):
                    if q.get("options").get("allowMultiple"):
                        q.update({"type": "multiple_option"})
            if q["type"] == "free":
                qtype = "text"
                if "validationRule" in q:
                    if q["validationRule"]["validationType"] == "numeric":
                        qtype = "integer"
                    if q["validationRule"]["allowDecimal"]:
                        qtype = "decimal"
                q.update({"type": qtype})
    return generate_excel_form(form, res_path)
