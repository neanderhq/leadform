#!/bin/sh
set -eu
bundle=/run/secrets/neander_environment
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    DATABASE_URL=*) export DATABASE_URL="${line#*=}" ;;
    APP_ORIGIN=*) export APP_ORIGIN="${line#*=}" ;;
    OWNER_PASSWORD=*) export OWNER_PASSWORD="${line#*=}" ;;
    SESSION_SECRET=*) export SESSION_SECRET="${line#*=}" ;;
    LEADFORM_RESEND_API_KEY=*) export LEADFORM_RESEND_API_KEY="${line#*=}" ;;
    LEADFORM_ALERT_FROM=*) export LEADFORM_ALERT_FROM="${line#*=}" ;;
    LEADFORM_ALERT_TO=*) export LEADFORM_ALERT_TO="${line#*=}" ;;
    '') ;;
    *) echo "unexpected environment entry" >&2; exit 1 ;;
  esac
done < "$bundle"
exec "$@"
