#!/bin/sh
set -eu
bundle=/run/secrets/neander_environment
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    DATABASE_URL=*) export DATABASE_URL="${line#*=}" ;;
    APP_ORIGIN=*) export APP_ORIGIN="${line#*=}" ;;
    OWNER_PASSWORD=*) export OWNER_PASSWORD="${line#*=}" ;;
    SESSION_SECRET=*) export SESSION_SECRET="${line#*=}" ;;
    '') ;;
    *) echo "unexpected environment entry" >&2; exit 1 ;;
  esac
done < "$bundle"
exec "$@"
