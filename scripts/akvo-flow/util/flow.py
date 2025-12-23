import os
import requests as r
import pandas as pd
from collections import defaultdict
from typing import Optional
from pydantic import BaseModel

instance_base = os.environ["MIS_AKVO_FLOW_INSTANCE_BASE_URL"]
auth_domain = os.environ["MIS_AUTH0_DOMAIN"]
client_id = os.environ["MIS_AUTH0_CLIENT_ID"]


class Oauth2Base(BaseModel):
    access_token: str
    refresh_token: str
    id_token: str
    scope: str
    expires_in: int
    token_type: str


def get_token(username: str, password: str) -> Oauth2Base:
    payload = {
        "client_id": client_id,
        "username": username,
        "password": password,
        "grant_type": "password",
        "scope": "offline_access"
    }
    req = r.post(auth_domain, data=payload)
    if req.status_code != 200:
        print("API Error:", req.status_code)
    return req.json()


def get_headers(token: str):
    payload = {
        'client_id': client_id,
        'grant_type': 'refresh_token',
        'refresh_token': token,
        'scope': 'openid email'
    }
    req = r.post(
        auth_domain,
        data=payload
    )
    if req.status_code != 200:
        return False
    return {
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.akvo.flow.v2+json',
        'Authorization': 'Bearer {}'.format(req.json().get('id_token'))
    }


def handle_list(data, target):
    response = []
    for value in data:
        if value.get("code"):
            response.append("{}:{}".format(
                value.get("code", "").strip(),
                value.get(target, "").strip()))
        else:
            if value.get(target):
                response.append(value.get(target, "").strip())
    return "|".join(response)


def data_handler(data, qType):
    if data:
        if qType in [
            'FREE_TEXT',
            'NUMBER',
            'BARCODE',
            'DATE',
            'GEOSHAPE',
            'SCAN',
            'CADDISFLY',
        ]:
            return data
        if qType == 'OPTION':
            return handle_list(data, "text")
        if qType == 'CASCADE':
            return handle_list(data, "name")
        if qType in ['PHOTO', 'VIDEO']:
            return data.get('filename', "")
        if qType == 'VIDEO':
            return data.get('filename', "")
        if qType == 'GEO':
            lat = data.get('long')
            long = data.get('lat')
            if lat and long:
                return f"{lat}|{long}"
        if qType == 'SIGNATURE':
            return data.get("name", "")
    return None


def get_data(uri, auth):
    return r.get(uri, headers=auth).json()


def fetch_all(url, headers, formInstances=[]):
    data = get_data(url, headers)
    next_url = data.get('nextPageUrl')
    data = data.get('formInstances')
    if data:
        for d in data:
            formInstances.append(d)
        if next_url:
            fetch_all(next_url, headers, formInstances)
    return formInstances


def def_value():
    return "Not Present"


def handle_repeat_group(form_definition: dict, collections: list):
    results = defaultdict(def_value)
    results["Raw Data"] = []
    for col in collections:
        meta = {}
        dt = {}
        for c in col:
            if c != "responses":
                if c not in ["dataPointId", "formId", "createdAt"]:
                    dt.update({c: col[c]})
                    meta.update({c: col[c]})
            else:
                for g in form_definition:
                    answers = col.get(c)
                    answers = answers.get(g['id']) if answers else [{}]
                    repeatable = g.get("repeatable")
                    if repeatable:
                        group_name = g.get("name")
                        if group_name not in results:
                            results[group_name] = []
                    if answers:
                        dr = meta
                        for ri, ans in enumerate(answers):
                            dr.update({"repeat": ri + 1})
                            for q in g['questions']:
                                a = ans.get(q['id'])
                                d = data_handler(a, q['type'])
                                n = {"{}|{}".format(q['id'], q['name']): d}
                                if repeatable:
                                    dr.update(n)
                                else:
                                    dt.update(n)
                        if repeatable:
                            results[group_name].append(dr)
        if len(dt) > len(meta):
            results["Raw Data"].append(dt)
    return results


def get_page(
    instance: str,
    survey_id: int,
    form_id: int,
    token: str,
    repeat: bool = False
):
    headers = get_headers(token)
    instance_uri = '{}{}'.format(instance_base, instance)
    form_instance_url = '{}/form_instances?survey_id={}&form_id={}'.format(
        instance_uri, survey_id, form_id
    )
    collections = fetch_all(form_instance_url, headers)
    form_definition = get_data(
        '{}/surveys/{}'.format(instance_uri, survey_id),
        headers
    )
    form_definition = form_definition.get('forms')
    form_definition = list(
        filter(
            lambda x: int(x['id']) == int(form_id),
            form_definition
        )
    )[0].get('questionGroups')
    if repeat:
        return handle_repeat_group(
            form_definition=form_definition,
            collections=collections
        )
    results = []
    for col in collections:
        dt = {}
        for c in col:
            if c != 'responses':
                dt.update({c: col[c]})
            else:
                for g in form_definition:
                    answers = col.get(c)
                    answers = answers.get(g['id']) if answers else [{}]
                    for q in g['questions']:
                        d = None
                        if answers:
                            a = answers[0].get(q['id'])
                            d = data_handler(a, q['type'])
                        n = "{}|{}".format(q['id'], q['name'])
                        dt.update({n: d})
        results.append(dt)
    return results


def export_spreadsheet(
    instance: str,
    survey_id: int,
    form_id: int,
    token: str,
    custom_location: Optional[str] = None
):
    data = get_page(
        instance=instance,
        survey_id=survey_id,
        form_id=form_id,
        token=token,
        repeat=True
    )
    empty = []
    for d in list(data):
        if not data[d]:
            empty.append(d)
    if len(empty) == len(data):
        return None
    file_location = f"./tmp/reports/{instance}-DATA_CLEANING-{form_id}.xlsx"
    if custom_location:
        file_location = custom_location
    metadata = [
        "id",
        "identifier",
        "submissionDate",
        "modifiedAt",
        "submitter",
        "surveyalTime",
        "formVersion",
        "deviceIdentifier",
        "displayName",
    ]
    writter = pd.ExcelWriter(file_location, engine='xlsxwriter')
    for d in list(data):
        if data[d]:
            df = pd.DataFrame(data[d])
            questions = list(
                filter(lambda x: x not in metadata + ["repeat"], list(df)))
            if "repeat" in list(df):
                questions = [
                    "id",
                    "identifier",
                    "displayName",
                    "repeat",
                ] + questions
            else:
                questions = metadata + questions
            df = df[questions]
            df.to_excel(writter, sheet_name=d, index=False)
    writter.save()
    return file_location
