#!/bin/sh

case "$1" in
  *Username*) printf '%s\n' "${CHUG_WORKER_GIT_CREDENTIAL_USERNAME:?}" ;;
  *) exec sed -e 's/[[:space:]]*$//' "${CHUG_WORKER_GIT_CREDENTIAL_FILE:?}" ;;
esac
