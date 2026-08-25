#!/bin/sh

case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) exec sed -e 's/[[:space:]]*$//' /var/run/chuggy/credentials/chuggy-git ;;
esac
