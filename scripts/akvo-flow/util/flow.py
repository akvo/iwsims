import os
import requests as r
from pydantic import BaseModel

instance_base = os.environ["AKVO_FLOW_INSTANCE_BASE_URL"]
auth_domain = os.environ["AUTH0_DOMAIN"]
client_id = os.environ["AUTH0_CLIENT_ID"]


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
