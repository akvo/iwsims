#!/usr/bin/env bash

set -eu

./wait-for-it.sh -h "${DB_HOST}" -p 5432 -- echo "Database is up and running"

echo "Running lint"
flake8

echo "Running tests"
COVERAGE_PROCESS_START=./.coveragerc \
  coverage run --parallel-mode --concurrency=multiprocessing --rcfile=./.coveragerc \
  manage.py test --shuffle --parallel 4

echo "Coverage"
coverage combine --rcfile=./.coveragerc
coverage report -m --rcfile=./.coveragerc

# Reporting coverage is not a quality gate — lint and the test suite above are.
# The upload reaches out to coveralls.io from inside the container, so a blip
# there ("Network is unreachable") would otherwise abort the build after every
# test has already passed, and take the frontend build down with it.
if [[ -n "${COVERALLS_REPO_TOKEN:-}" ]] ; then
  coveralls || echo "WARNING: could not submit coverage to coveralls.io"
fi

echo "Generate Django DBML"
python manage.py dbml > db.dbml

echo "Done"
