#!/usr/bin/env bash
set -exuo pipefail

# Skip on tag builds (production deploy not yet configured for iwsims).
tag_pattern="^[0-9]+\.[0-9]+\.[0-9]+$"
if [[ "${CI_BRANCH}" =~ $tag_pattern || "${CI_TAG:=}" =~ $tag_pattern ]]; then
    echo "Tag build detected. Production deploy not yet configured for iwsims. Skip deploy."
    exit 0
fi

[[ "${CI_BRANCH}" != "main" ]] && { echo "Branch is not main. Skip deploy."; exit 0; }
[[ "${CI_PULL_REQUEST}" == "true" ]] && { echo "Pull request. Skip deploy."; exit 0; }

NAMESPACE="iwsims-namespace"
DEPLOYMENT="iwsims"
IMAGE_PREFIX="eu.gcr.io/akvo-lumen/iwsims"

auth () {
    gcloud auth activate-service-account --key-file=/home/runner/work/iwsims/credentials/gcp.json
    gcloud config set project akvo-lumen
    gcloud config set container/cluster europe-west1-d
    gcloud config set compute/zone europe-west1-d
    gcloud config set container/use_client_certificate False
    gcloud auth configure-docker "eu.gcr.io"
    gcloud container clusters get-credentials test
}

push_image () {
    docker push "${IMAGE_PREFIX}/${1}:latest-test"
    docker push "${IMAGE_PREFIX}/${1}:${CI_COMMIT}"
}

auth

push_image backend
push_image worker
push_image frontend

kubectl -n "${NAMESPACE}" rollout restart deployment/"${DEPLOYMENT}"
kubectl -n "${NAMESPACE}" rollout status deployment/"${DEPLOYMENT}" --timeout=5m
