#!/bin/sh

case "$1" in
  *Username*) printf '%s\n' 'worker' ;;
  *) exec sed -e 's/[[:space:]]*$//' /var/run/chuggy/credentials/chuggy-git-worker ;;
esac
