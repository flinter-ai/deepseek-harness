#!/usr/bin/env bash
set -Eeuo pipefail

# This controller is deliberately outside the DSH process. It consumes only
# the redacted state written by dsh-host-idle-guard and fails closed on every
# missing, stale, malformed, or concurrent state condition.
readonly STATE_FILE="${DSH_IDLE_STATE_FILE:-/var/lib/dsh-phase2/idle-state.json}"
readonly HOLD_FILE="${DSH_IDLE_STOP_HOLD_FILE:-/var/lib/dsh-phase2/idle-stop.hold}"
readonly LOCK_FILE="${DSH_IDLE_DEPLOY_LOCK_FILE:-/run/lock/dsh-phase2-deploy.lock}"
readonly SERVICE_NAME="${DSH_SERVICE:-dsh.service}"
readonly IDLE_AFTER_SECONDS="${DSH_IDLE_AFTER_SECONDS:-1800}"
readonly STALE_AFTER_SECONDS="${DSH_IDLE_STATE_STALE_SECONDS:-600}"

log() {
  printf 'dsh-idle-stop: %s\n' "$*"
}

if [[ ! "$IDLE_AFTER_SECONDS" =~ ^[1-9][0-9]*$ || ! "$STALE_AFTER_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  log 'policy=invalid'
  exit 0
fi

if [[ -e "$HOLD_FILE" ]]; then
  log 'hold=present'
  exit 0
fi

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  log 'service=inactive'
  exit 0
fi

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log 'lock=busy'
  exit 0
fi

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
  log 'service=inactive-after-lock'
  exit 0
fi

if [[ ! -f "$STATE_FILE" ]]; then
  log 'state=missing'
  exit 0
fi

snapshot=$(python3 - "$STATE_FILE" <<'PY' 2>/dev/null
import json
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as stream:
    state = json.load(stream)
if not isinstance(state, dict) or state.get("schemaVersion") != 2:
    raise SystemExit(1)
ready = state.get("capabilitiesReady")
if type(ready) is not bool:
    raise SystemExit(1)
keys = ("observedAt", "lastActivityAt", "activeHttpRequests", "activeWebSockets", "activeJobs", "activePtys")
values = [state.get(key) for key in keys]
if any(type(value) is not int or value < 0 for value in values):
    raise SystemExit(1)
print("%d %s" % (1 if ready else 0, " ".join(str(value) for value in values)))
PY
) || {
  log 'state=invalid'
  exit 0
}

read -r capabilities_ready observed_at last_activity_at active_http active_websockets active_jobs active_ptys <<<"$snapshot"
# Use the same millisecond clock precision as the JSON writer. A whole-second
# `date` value can lag a freshly written observedAt by up to 999 ms and would
# incorrectly fail closed on every normal observation.
now_ms=$(python3 -c 'import time; print(int(time.time() * 1000))')
stale_ms=$(( STALE_AFTER_SECONDS * 1000 ))
idle_ms=$(( IDLE_AFTER_SECONDS * 1000 ))

if (( observed_at > now_ms || now_ms - observed_at > stale_ms )); then
  log 'state=stale'
  exit 0
fi
if (( last_activity_at > now_ms )); then
  log 'activity=clock-ahead'
  exit 0
fi
if (( capabilities_ready != 1 )); then
  log 'activity=capabilities-incomplete'
  exit 0
fi
if (( active_http != 0 || active_websockets != 0 || active_jobs != 0 || active_ptys != 0 )); then
  log "activity=active http=$active_http websockets=$active_websockets jobs=$active_jobs ptys=$active_ptys"
  exit 0
fi
if (( now_ms - last_activity_at < idle_ms )); then
  log "activity=recent age_seconds=$(( (now_ms - last_activity_at) / 1000 ))"
  exit 0
fi

log "idle=eligible age_seconds=$(( (now_ms - last_activity_at) / 1000 ))"
if [[ "${DSH_IDLE_STOP_DRY_RUN:-0}" == 1 ]]; then
  log 'action=dry-run'
  exit 0
fi

systemctl stop "$SERVICE_NAME"
log "service=stopped name=$SERVICE_NAME"
systemctl poweroff
