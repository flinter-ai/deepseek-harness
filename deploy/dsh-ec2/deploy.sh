#!/usr/bin/env bash
set -Eeuo pipefail

# This script runs as root through AWS Systems Manager on the existing DSH Web
# host. It accepts only public deployment metadata; model credentials remain
# in the EC2 instance role and are resolved by DSH at request time.

readonly REPOSITORY_ROOT="${DSH_REPOSITORY_ROOT:-/opt/dsh-phase2}"
readonly PROFILE_NAME="${DSH_PROFILE:-tod}"
readonly SERVICE_NAME="${DSH_SERVICE:-dsh.service}"
readonly HOME_ROOT="${DSH_HOME:-/root/.dsh-phase2}"
readonly SETTINGS_FILE="$HOME_ROOT/settings.yaml"
readonly PORT_NUMBER="${DSH_PORT:-3080}"
readonly DEPLOY_SHA="${DSH_DEPLOY_SHA:-}"
readonly EXPECTED_REMOTE="${DSH_DEPLOY_REMOTE:-}"
readonly DEPLOY_REGION="${DSH_DEPLOY_AWS_REGION:-}"
readonly BACKUP_ROOT="${DSH_DEPLOY_BACKUP_ROOT:-/var/lib/dsh-phase2/deploy-backups}"

die() {
  printf 'dsh-ec2-deploy: error: %s\n' "$*" >&2
  exit 1
}

canonical_remote() {
  local value="$1"
  value="${value%.git}"
  value="${value#https://github.com/}"
  value="${value#http://github.com/}"
  value="${value#ssh://git@github.com/}"
  value="${value#git@github.com:}"
  printf '%s' "$value"
}

run_logged() {
  local label="$1"
  shift
  local log_file="$BACKUP_DIR/$label.log"
  if "$@" >"$log_file" 2>&1; then
    printf 'dsh-ec2-deploy: %s=ok\n' "$label"
    return 0
  fi
  printf 'dsh-ec2-deploy: %s=failed; log=%s\n' "$label" "$log_file" >&2
  tail -n 80 "$log_file" >&2 || true
  return 1
}

restore_profile() {
  local file
  for file in "${PROFILE_FILES[@]}"; do
    if [[ "${PROFILE_FILE_PRESENT[$file]:-0}" == 1 ]]; then
      cp -a "$BACKUP_DIR/profile/$file" "$PROFILE_DIR/$file"
    else
      rm -f "$PROFILE_DIR/$file"
    fi
  done
  if [[ -e "$BACKUP_DIR/settings.yaml" ]]; then
    cp -a "$BACKUP_DIR/settings.yaml" "$SETTINGS_FILE"
  fi
}

migrate_legacy_worker_overlay() {
  local patch_file="$PROFILE_DIR/cordis.patch.yml"
  local bundle_patch="$REPOSITORY_ROOT/packages/flinter/dsh-aws-worker-profile/cordis.patch.yml"
  local marker='# Public AWS worker profile overlay.'
  grep -Fqx "$marker" "$patch_file" || return 0

  local marker_count
  marker_count=$(grep -Fxc "$marker" "$patch_file" || true)
  [[ "$marker_count" == 1 ]] || die 'the legacy AWS worker overlay marker is ambiguous'

  local retained_file legacy_file
  retained_file=$(mktemp "$PROFILE_DIR/.cordis.patch.retained.XXXXXX")
  legacy_file=$(mktemp "$PROFILE_DIR/.cordis.patch.legacy.XXXXXX")
  awk -v marker="$marker" -v retained="$retained_file" -v legacy="$legacy_file" '
    $0 == marker { found = 1 }
    found { print > legacy; next }
    { print > retained }
    END { if (!found) exit 1 }
  ' "$patch_file"
  if ! cmp -s "$legacy_file" "$bundle_patch"; then
    rm -f "$retained_file" "$legacy_file"
    die 'the legacy AWS worker overlay differs from the supported bundle'
  fi
  chmod --reference="$patch_file" "$retained_file"
  chown --reference="$patch_file" "$retained_file"
  mv "$retained_file" "$patch_file"
  rm -f "$legacy_file"
  printf 'dsh-ec2-deploy: legacy-worker-overlay=migrated\n'
}

completed=0
rollback_ready=0
switched=0
rollback() {
  local status=$?
  if (( completed == 1 || rollback_ready == 0 )); then
    return "$status"
  fi

  set +e
  printf 'dsh-ec2-deploy: rollback=started\n' >&2
  if (( switched == 1 )); then
    git -C "$REPOSITORY_ROOT" checkout --detach "$PREVIOUS_SHA" >/dev/null 2>&1
  fi
  restore_profile
  if (( SERVICE_WAS_ACTIVE == 1 )); then
    systemctl restart "$SERVICE_NAME" >/dev/null 2>&1
  fi
  printf 'dsh-ec2-deploy: rollback=finished sha=%s\n' "$PREVIOUS_SHA" >&2
  exit "$status"
}
trap rollback EXIT

(( EUID == 0 )) || die 'must run as root'
[[ "$PROFILE_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die 'profile name is invalid'
[[ "$PORT_NUMBER" =~ ^[0-9]+$ ]] || die 'port is invalid'
[[ "$DEPLOY_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'DSH_DEPLOY_SHA must be a 40-character commit SHA'
[[ -n "$EXPECTED_REMOTE" ]] || die 'DSH_DEPLOY_REMOTE is required'

git -C "$REPOSITORY_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "not a Git checkout: $REPOSITORY_ROOT"
PROFILE_DIR="$HOME_ROOT/profiles/$PROFILE_NAME"
[[ -d "$PROFILE_DIR" ]] || die "profile directory is missing: $PROFILE_DIR"
[[ -f "$SETTINGS_FILE" ]] || die "settings file is missing: $SETTINGS_FILE"
ACTUAL_REMOTE=$(git -C "$REPOSITORY_ROOT" remote get-url origin)
[[ "$(canonical_remote "$ACTUAL_REMOTE")" == "$(canonical_remote "$EXPECTED_REMOTE")" ]] \
  || die 'the live checkout origin does not match the workflow repository'

git -C "$REPOSITORY_ROOT" fetch --no-tags --prune origin "$DEPLOY_SHA"
git -C "$REPOSITORY_ROOT" cat-file -e "$DEPLOY_SHA^{commit}" \
  || die "requested commit is unavailable from the live checkout origin: $DEPLOY_SHA"

if ! git -C "$REPOSITORY_ROOT" diff --quiet HEAD -- \
  || ! git -C "$REPOSITORY_ROOT" diff --cached --quiet; then
  printf 'dsh-ec2-deploy: live checkout has tracked drift; refusing to overwrite it\n' >&2
  git -C "$REPOSITORY_ROOT" status --short --untracked-files=no >&2
  die 'reconcile the tracked live checkout before deployment'
fi

UNTRACKED_CONFLICTS=()
while IFS= read -r -d '' file; do
  if git -C "$REPOSITORY_ROOT" cat-file -e "$DEPLOY_SHA:$file" 2>/dev/null; then
    UNTRACKED_CONFLICTS+=("$file")
  fi
done < <(git -C "$REPOSITORY_ROOT" ls-files --others --exclude-standard -z)
if (( ${#UNTRACKED_CONFLICTS[@]} > 0 )); then
  printf 'dsh-ec2-deploy: untracked files collide with the target commit:\n' >&2
  printf '  %s\n' "${UNTRACKED_CONFLICTS[@]}" >&2
  die 'move or remove the colliding local files before deployment'
fi

systemctl cat "$SERVICE_NAME" >/dev/null 2>&1 || die "systemd unit is missing: $SERVICE_NAME"
systemctl is-active --quiet "$SERVICE_NAME" || die "service is not active: $SERVICE_NAME"
ss -ltn | grep -qE ":${PORT_NUMBER}[[:space:]]" || die "service is not listening on port $PORT_NUMBER"

PREVIOUS_SHA=$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)
SERVICE_WAS_ACTIVE=1
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP-$PREVIOUS_SHA"
PROFILE_FILES=(package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml)
declare -A PROFILE_FILE_PRESENT=()
mkdir -p "$BACKUP_DIR/profile"
cp -a "$SETTINGS_FILE" "$BACKUP_DIR/settings.yaml"
for file in "${PROFILE_FILES[@]}"; do
  if [[ -e "$PROFILE_DIR/$file" ]]; then
    cp -a "$PROFILE_DIR/$file" "$BACKUP_DIR/profile/$file"
    PROFILE_FILE_PRESENT["$file"]=1
  else
    PROFILE_FILE_PRESENT["$file"]=0
  fi
done
rollback_ready=1

systemctl stop "$SERVICE_NAME"
switched=1
printf 'dsh-ec2-deploy: service=stopped\n'
run_logged checkout git -C "$REPOSITORY_ROOT" checkout --detach "$DEPLOY_SHA"
run_logged install pnpm -C "$REPOSITORY_ROOT" install --frozen-lockfile
run_logged build-provider pnpm -C "$REPOSITORY_ROOT" --filter @deepseek-ai/dsh-credentials-aws-secrets-manager run build
run_logged build-profile pnpm -C "$REPOSITORY_ROOT" --filter @deepseek-ai/dsh-aws-worker-profile run build
run_logged settings-compat python3 "$REPOSITORY_ROOT/deploy/dsh-ec2/migrate-settings.py" "$SETTINGS_FILE"
migrate_legacy_worker_overlay
run_logged profile-install env DSH_HOME="$HOME_ROOT" DSH_ROOT="$REPOSITORY_ROOT" pnpm -C "$REPOSITORY_ROOT" dsh plugin --profile "$PROFILE_NAME" add --save-exact "$REPOSITORY_ROOT/packages/flinter/dsh-aws-worker-profile"
run_logged dump-config env DSH_HOME="$HOME_ROOT" DSH_ROOT="$REPOSITORY_ROOT" pnpm -C "$REPOSITORY_ROOT" dsh --profile "$PROFILE_NAME" --dump-config
run_logged settings-compat-check python3 "$REPOSITORY_ROOT/deploy/dsh-ec2/migrate-settings.py" --check "$SETTINGS_FILE"

grep -q 'credentials-aws-secrets-manager' "$BACKUP_DIR/dump-config.log" \
  || die 'the AWS credential provider is absent from the composed profile'
grep -q 'ARK_PLAN_API_KEY: flinter/dsh-ark-agent-plan' "$BACKUP_DIR/dump-config.log" \
  || die 'the Ark secret mapping is absent from the composed profile'
grep -q 'allowWrites: false' "$BACKUP_DIR/dump-config.log" \
  || die 'the AWS credential provider is not read-only'
if ! (
  cd "$REPOSITORY_ROOT"
  TSX_TSCONFIG_PATH="$REPOSITORY_ROOT/tsconfig.base.json" \
    DSH_DEPLOY_AWS_REGION="$DEPLOY_REGION" \
    node --import tsx/esm --input-type=module <<'NODE'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AwsSecretsManagerCredentialProvider } from './packages/credentials/dsh-credentials-aws-secrets-manager/src/index.ts'

const ctx = new Context()
const region = process.env.DSH_DEPLOY_AWS_REGION || undefined
const provider = new AwsSecretsManagerCredentialProvider(ctx, {
  ...(region === undefined ? {} : { region }),
  secretNames: { ARK_PLAN_API_KEY: 'flinter/dsh-ark-agent-plan' },
  secretFormat: 'json',
  allowWrites: false,
})
const resolved = await provider.resolve(credentialRef('ARK_PLAN_API_KEY'))
if (resolved?.value === undefined) throw new Error('Ark credential reference is not configured')
console.log(JSON.stringify({ configured: true, source: resolved.source, writable: false }))
NODE
) >"$BACKUP_DIR/provider-resolve.log" 2>&1; then
  printf 'dsh-ec2-deploy: provider-resolve=failed; log=%s\n' "$BACKUP_DIR/provider-resolve.log" >&2
  tail -n 80 "$BACKUP_DIR/provider-resolve.log" >&2 || true
  die 'the deployed provider could not resolve the Ark reference'
fi
grep -q '"configured":true' "$BACKUP_DIR/provider-resolve.log" \
  || die 'the provider probe did not report configured=true'
grep -q '"source":"aws-secrets-manager"' "$BACKUP_DIR/provider-resolve.log" \
  || die 'the provider probe did not use Secrets Manager'
printf 'dsh-ec2-deploy: provider-resolve=ok\n'

systemctl restart "$SERVICE_NAME"
for _ in {1..30}; do
  if systemctl is-active --quiet "$SERVICE_NAME" && ss -ltn | grep -qE ":${PORT_NUMBER}[[:space:]]"; then
    break
  fi
  sleep 2
done
systemctl is-active --quiet "$SERVICE_NAME" || die 'service did not become active after deployment'
ss -ltn | grep -qE ":${PORT_NUMBER}[[:space:]]" || die 'service did not listen after deployment'
sleep 5
systemctl is-active --quiet "$SERVICE_NAME" || die 'service became inactive after the post-start stability window'

HTTP_STATUS=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${PORT_NUMBER}/" || true)
[[ "$HTTP_STATUS" == 401 ]] || die "authenticated Web endpoint health check returned HTTP $HTTP_STATUS"

SYSTEMD_ENV=$(systemctl show "$SERVICE_NAME" -p Environment --value)
if grep -qE '(ARK_PLAN_API_KEY|DEEPSEEK_API_KEY|MODELFLARE_API_KEY|GMI_SERVING_API_KEY)=' <<<"$SYSTEMD_ENV"; then
  die 'a credential value is present in the systemd environment'
fi
SERVICE_PID=$(systemctl show "$SERVICE_NAME" -p MainPID --value)
if [[ "$SERVICE_PID" =~ ^[0-9]+$ ]] && (( SERVICE_PID > 0 )) \
  && tr '\0' '\n' <"/proc/$SERVICE_PID/environ" | grep -qE '^(ARK_PLAN_API_KEY|DEEPSEEK_API_KEY|MODELFLARE_API_KEY|GMI_SERVING_API_KEY)='; then
  die 'a credential value is present in the DSH process environment'
fi

RESTART_COUNT=$(systemctl show "$SERVICE_NAME" -p NRestarts --value)
completed=1
printf 'dsh-ec2-deploy: deployment=success sha=%s http=%s restarts=%s backup=%s\n' \
  "$DEPLOY_SHA" "$HTTP_STATUS" "$RESTART_COUNT" "$BACKUP_DIR"
