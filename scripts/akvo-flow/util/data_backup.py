import requests as r
import os
from sys import argv
from util.flow import get_token, get_headers
from util.flow import export_spreadsheet
from routes.flow_data import flow_api
from routes.form import download_form
from util.odk import odk

if len(argv) < 4:
    print("wrong input")
    exit(1)

instance_name = argv[3]
login = get_token(username=argv[1], password=argv[2])
refresh_token = login.get("refresh_token")


def file_log(dir_name: str):
    dir_name = dir_name.replace(
        f"./tmp/data_backup/{instance_name}.akvoflow.org", "")
    dir_name = dir_name.replace("//", "/")
    print(f"{dir_name}")


def create_folder(dir: str, dir_name: str):
    if dir_name:
        dir += f"/{dir_name}/"
    else:
        dir += "/untitled/"
    if not os.path.exists(dir):
        os.makedirs(dir)
        file_log(f"CREATED : {dir}")
    else:
        file_log(f"EXISTS  : {dir}")
    return dir


def flow_backup(headers: dict, survey_url: str, folder_url: str, dir: str):
    folders = r.get(folder_url, headers=headers)
    folders = folders.json().get("folders")
    surveys = r.get(survey_url, headers=headers)
    surveys = surveys.json().get("surveys")
    for survey in surveys:
        dir_name = survey.get("name")
        form_url = survey.get("surveyUrl")
        survey_dir = create_folder(dir=dir, dir_name=dir_name)
        req = r.get(form_url, headers=headers)
        if req.status_code == 200:
            forms = req.json().get("forms")
            for form in forms:
                form_id = form.get("id")
                form_name = form.get("name")
                file_name = f"{form_id}-{form_name}"
                data_file = f"{survey_dir}/DATA-{file_name}.xlsx"
                if not os.path.exists(data_file):
                    try:
                        created = export_spreadsheet(
                            instance=instance_name,
                            survey_id=survey.get("id"),
                            form_id=form_id,
                            token=refresh_token,
                            custom_location=data_file)
                        if created:
                            file_log(f"CREATED : {data_file}")
                        else:
                            file_log(f"EMPTY   : {data_file}")
                    except Exception as e:
                        print(f"!!ERROR  : {str(e)}")
                else:
                    file_log(f"EXISTS  : {data_file}")
                form_file = f"{survey_dir}/FORM-{file_name}.xlsx"
                if not os.path.exists(form_file):
                    try:
                        ziploc = f"./static/xml/{instance_name}"
                        res = download_form(ziploc, instance_name, form_id)
                        if res:
                            odk(res, f"{survey_dir}/FORM-{file_name}.xlsx")
                            file_log(f"CREATED : {form_file}")
                        else:
                            file_log(f"!!ERROR : FILE: {form_file}")
                    except Exception as e:
                        print(f"!!ERROR  : {str(e)}")
                else:
                    file_log(f"EXISTS  : {form_file}")
    for folder in folders:
        dir_name = folder.get("name")
        new_dir = create_folder(dir=dir, dir_name=dir_name)
        survey_url = folder.get("surveysUrl")
        folder_url = folder.get("foldersUrl")
        flow_backup(headers=headers,
                    survey_url=folder.get("surveysUrl"),
                    folder_url=folder.get("foldersUrl"),
                    dir=new_dir)


if login:
    url = f"{flow_api}/{instance_name}"
    initial_folder = f"./tmp/data_backup/{instance_name}.akvoflow.org/"
    if not os.path.exists(initial_folder):
        os.makedirs(initial_folder)
    headers = get_headers(token=refresh_token)
    folder_url = f"{url}/folders?parent_id=0"
    survey_url = f"{url}/surveys?folder_id=0"
    flow_backup(headers=headers,
                folder_url=folder_url,
                survey_url=survey_url,
                dir=initial_folder)
else:
    print("You don't have access to this instance")
