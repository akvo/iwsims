#!/usr/bin/env bash

ROOT_DIR=$(git rev-parse --show-toplevel)

if ! dbdocs -v dbdocs > /dev/null
then
    echo "Please install dbdocs CLI! https://dbdocs.io/docs"
    exit
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
docker-compose exec backend python manage.py dbml > "$ROOT_DIR"/backend/db.dbml
dbdocs build "$ROOT_DIR"/backend/db.dbml --project "iwsims-$BRANCH"
