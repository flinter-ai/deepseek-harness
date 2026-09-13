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
readonly ARTIFACT_URI="${DSH_RUNTIME_ARTIFACT_URI:-}"
readonly ARTIFACT_SHA256_URI="${DSH_RUNTIME_ARTIFACT_SHA256_URI:-}"
readonly RELEASE_ROOT="${DSH_RUNTIME_RELEASE_ROOT:-/opt/dsh-phase2/releases}"
readonly CURRENT_RELEASE="${DSH_RUNTIME_CURRENT_RELEASE:-$RELEASE_ROOT/current}"
readonly PUBLIC_HOST='dsh-web.useflinter.com'
readonly PUBLIC_TUNNEL_SERVICE='dsh-ec2-phase2-named-tunnel.service'
readonly PUBLIC_TUNNEL_CONFIG='/etc/cloudflared/dsh-ec2-phase2.yml'
readonly PUBLIC_TUNNEL_CREDENTIAL='/etc/cloudflared/dsh-ec2-phase2.json'
readonly PUBLIC_TUNNEL_BINARY="${DSH_CLOUDFLARED_BIN:-/home/ubuntu/bin/cloudflared}"
readonly PUBLIC_TUNNEL_CONFIG_SOURCE='deploy/dsh-ec2/cloudflared/dsh-ec2-phase2.yml'
readonly PUBLIC_TUNNEL_UNIT_SOURCE='deploy/dsh-ec2/cloudflared/dsh-ec2-phase2-named-tunnel.service'
readonly PUBLIC_HOST_DROPIN_SOURCE='deploy/dsh-ec2/systemd/10-dsh-web-public-host.conf'

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
  local bundle_patch="${BUNDLE_PATCH_FILE:-$REPOSITORY_ROOT/packages/flinter/dsh-aws-worker-profile/cordis.patch.yml}"
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

git_blob_matches_live_file() {
  local source_path="$1"
  local live_path="$2"
  local expected_mode="$3"
  local expected_owner="$4"
  git -C "$REPOSITORY_ROOT" cat-file -e "$DEPLOY_SHA:$source_path" \
    || die "the deployment revision is missing the protected ingress file: $source_path"
  [[ -f "$live_path" ]] || die "the protected ingress file is missing: $live_path"
  cmp -s "$live_path" <(git -C "$REPOSITORY_ROOT" show "$DEPLOY_SHA:$source_path") \
    || die "the live protected ingress file differs from the deployment revision: $live_path"
  [[ "$(stat -c '%a' "$live_path")" == "$expected_mode" ]] \
    || die "the protected ingress file has the wrong mode: $live_path"
  [[ "$(stat -c '%U:%G' "$live_path")" == "$expected_owner" ]] \
    || die "the protected ingress file has the wrong owner: $live_path"
}

verify_public_ingress() {
  local service_definition
  [[ -x "$PUBLIC_TUNNEL_BINARY" ]] || die "cloudflared binary is missing: $PUBLIC_TUNNEL_BINARY"
  [[ -f "$PUBLIC_TUNNEL_CREDENTIAL" ]] || die "named-tunnel credential is missing: $PUBLIC_TUNNEL_CREDENTIAL"
  [[ "$(stat -c '%a' "$PUBLIC_TUNNEL_CREDENTIAL")" == 600 ]] \
    || die 'named-tunnel credential must have mode 600'
  [[ "$(stat -c '%U:%G' "$PUBLIC_TUNNEL_CREDENTIAL")" == 'ubuntu:ubuntu' ]] \
    || die 'named-tunnel credential must be owned by ubuntu:ubuntu'

  git_blob_matches_live_file "$PUBLIC_TUNNEL_CONFIG_SOURCE" "$PUBLIC_TUNNEL_CONFIG" 600 'ubuntu:ubuntu'
  git_blob_matches_live_file "$PUBLIC_TUNNEL_UNIT_SOURCE" \
    "/etc/systemd/system/$PUBLIC_TUNNEL_SERVICE" 644 'root:root'

  service_definition=$(systemctl cat "$SERVICE_NAME")
  grep -Fq -- "--trusted-host $PUBLIC_HOST" \
    <<<"$service_definition" \
    || die "the DSH service does not trust the stable public hostname: $PUBLIC_HOST"
  systemctl is-enabled --quiet "$PUBLIC_TUNNEL_SERVICE" \
    || die "the stable DSH tunnel is not enabled: $PUBLIC_TUNNEL_SERVICE"
  systemctl is-active --quiet "$PUBLIC_TUNNEL_SERVICE" \
    || die "the stable DSH tunnel is not active: $PUBLIC_TUNNEL_SERVICE"
  "$PUBLIC_TUNNEL_BINARY" --no-autoupdate --config "$PUBLIC_TUNNEL_CONFIG" tunnel ingress validate \
    >/dev/null 2>&1 \
    || die 'the stable DSH tunnel configuration failed cloudflared validation'
  printf 'dsh-ec2-deploy: ingress=verified host=%s tunnel-service=%s\n' \
    "$PUBLIC_HOST" "$PUBLIC_TUNNEL_SERVICE"
}

install_target_public_host_dropin() {
  local target='/etc/systemd/system/dsh.service.d/10-dsh-web-public-host.conf'
  local temporary
  git -C "$REPOSITORY_ROOT" cat-file -e "$DEPLOY_SHA:$PUBLIC_HOST_DROPIN_SOURCE" \
    || die "the deployment revision is missing the protected ingress file: $PUBLIC_HOST_DROPIN_SOURCE"
  mkdir -p "$(dirname "$target")" "$BACKUP_DIR/ingress"
  if [[ -e "$target" ]]; then
    [[ -f "$target" ]] || die "the protected host drop-in is not a regular file: $target"
    cp -a "$target" "$BACKUP_DIR/ingress/10-dsh-web-public-host.conf"
    INGRESS_DROPIN_WAS_PRESENT=1
  else
    INGRESS_DROPIN_WAS_PRESENT=0
  fi
  temporary=$(mktemp "$BACKUP_DIR/ingress/.10-dsh-web-public-host.XXXXXX")
  git -C "$REPOSITORY_ROOT" show "$DEPLOY_SHA:$PUBLIC_HOST_DROPIN_SOURCE" >"$temporary"
  install -o root -g root -m 644 "$temporary" "$target"
  rm -f "$temporary"
  systemctl daemon-reload
  printf 'dsh-ec2-deploy: public-host-dropin=installed\n'
}

verify_target_public_host_dropin() {
  local service_definition
  git_blob_matches_live_file "$PUBLIC_HOST_DROPIN_SOURCE" \
    '/etc/systemd/system/dsh.service.d/10-dsh-web-public-host.conf' 644 'root:root'
  service_definition=$(systemctl cat "$SERVICE_NAME")
  grep -Fq -- "$CURRENT_RELEASE/launch.sh --trusted-host $PUBLIC_HOST" \
    <<<"$service_definition" \
    || die "the DSH service does not point at the immutable current release: $CURRENT_RELEASE"
}

restore_target_public_host_dropin() {
  local target='/etc/systemd/system/dsh.service.d/10-dsh-web-public-host.conf'
  if [[ "${INGRESS_DROPIN_WAS_PRESENT:-0}" == 1 ]]; then
    cp -a "$BACKUP_DIR/ingress/10-dsh-web-public-host.conf" "$target"
  else
    rm -f "$target"
  fi
  systemctl daemon-reload >/dev/null 2>&1 || true
}

copy_artifact_source() {
  local source="$1"
  local destination="$2"
  case "$source" in
    s3://*) aws s3 cp --only-show-errors "$source" "$destination" ;;
    file://*) cp -f -- "${source#file://}" "$destination" ;;
    *) die "runtime artifact source must be an s3:// or file:// URI" ;;
  esac
}

verify_artifact_manifest() {
  local root="$1"
  python3 - "$root/artifact-manifest.json" "$DEPLOY_SHA" "$root" <<'PY'
import hashlib
import json
import os
import pathlib
import sys

manifest_path, expected_sha, root = sys.argv[1:]
with open(manifest_path, encoding="utf-8") as stream:
    manifest = json.load(stream)
if manifest.get("schemaVersion") != 1:
    raise SystemExit("runtime artifact manifest schema is unsupported")
if manifest.get("sourceSha") != expected_sha:
    raise SystemExit("runtime artifact source SHA does not match the requested deployment SHA")
target = manifest.get("target")
if target != {"platform": "linux", "arch": "arm64"}:
    raise SystemExit(f"runtime artifact target is not linux/arm64: {target!r}")
files = manifest.get("files")
if not isinstance(files, list) or not files:
    raise SystemExit("runtime artifact manifest has no file records")
root_path = pathlib.Path(root).resolve()
for record in files:
    relative = record.get("path")
    if not isinstance(relative, str) or not relative or pathlib.PurePosixPath(relative).is_absolute():
        raise SystemExit("runtime artifact contains an invalid manifest path")
    path = (root_path / pathlib.Path(relative)).resolve()
    if os.path.commonpath((str(root_path), str(path))) != str(root_path):
        raise SystemExit("runtime artifact manifest escapes its release directory")
    if not path.is_file():
        raise SystemExit(f"runtime artifact manifest file is missing: {relative}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.stat().st_size != record.get("bytes") or digest != record.get("sha256"):
        raise SystemExit(f"runtime artifact manifest checksum mismatch: {relative}")
PY
  [[ -x "$root/launch.sh" ]] || die "runtime artifact launcher is missing"
  [[ -f "$root/runtime-bootstrap.mjs" ]] || die "runtime artifact bootstrap is missing"
}

prepare_runtime_release() {
  local artifact_name checksum_uri checksum_file archive_file staging release
  [[ -n "$ARTIFACT_URI" ]] || die 'DSH_RUNTIME_ARTIFACT_URI is required; EC2 does not build the DSH runtime'
  [[ "$ARTIFACT_URI" == *.tar.gz ]] || die 'DSH_RUNTIME_ARTIFACT_URI must name a .tar.gz artifact'
  mkdir -p "$RELEASE_ROOT"
  ARTIFACT_TMP_DIR=$(mktemp -d "$RELEASE_ROOT/.artifact-download.XXXXXX")
  artifact_name=$(basename "$ARTIFACT_URI")
  checksum_uri="${ARTIFACT_SHA256_URI:-$ARTIFACT_URI.sha256}"
  archive_file="$ARTIFACT_TMP_DIR/$artifact_name"
  checksum_file="$ARTIFACT_TMP_DIR/$artifact_name.sha256"
  copy_artifact_source "$ARTIFACT_URI" "$archive_file"
  copy_artifact_source "$checksum_uri" "$checksum_file"
  grep -Eq "^[0-9a-f]{64}[[:space:]]{2}${artifact_name//./\\.}$" "$checksum_file" \
    || die 'runtime artifact checksum file has an unexpected format'
  (cd "$ARTIFACT_TMP_DIR" && sha256sum -c "$artifact_name.sha256") \
    || die 'runtime artifact checksum verification failed'

  while IFS= read -r entry; do
    case "$entry" in
      /*|../*|*/../*|*/..)
        die "runtime artifact contains an unsafe archive path: $entry"
        ;;
    esac
  done < <(tar -tzf "$archive_file")

  TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
  staging="$RELEASE_ROOT/.staging-$DEPLOY_SHA-$TIMESTAMP"
  release="$RELEASE_ROOT/$DEPLOY_SHA"
  [[ ! -e "$staging" ]] || die "runtime staging path already exists: $staging"
  mkdir -p "$staging"
  tar --no-same-owner --no-same-permissions -xzf "$archive_file" -C "$staging"
  verify_artifact_manifest "$staging"
  if [[ -e "$release" ]]; then
    [[ -d "$release" ]] || die "runtime release path is not a directory: $release"
    verify_artifact_manifest "$release"
    rm -rf "$staging"
  else
    mv "$staging" "$release"
  fi
  RELEASE_DIR="$release"
  printf 'dsh-ec2-deploy: artifact=verified sha=%s release=%s\n' "$DEPLOY_SHA" "$RELEASE_DIR"
}

switch_runtime_release() {
  local temporary
  if [[ -L "$CURRENT_RELEASE" ]]; then
    PREVIOUS_RELEASE_TARGET=$(readlink -f "$CURRENT_RELEASE")
  elif [[ -e "$CURRENT_RELEASE" ]]; then
    die "runtime current path is not a symlink: $CURRENT_RELEASE"
  else
    PREVIOUS_RELEASE_TARGET=''
  fi
  temporary="${CURRENT_RELEASE}.next.$$"
  ln -s "$RELEASE_DIR" "$temporary"
  mv -Tf "$temporary" "$CURRENT_RELEASE"
  switched=1
  printf 'dsh-ec2-deploy: release=current sha=%s\n' "$DEPLOY_SHA"
}

completed=0
rollback_ready=0
switched=0
INGRESS_DROPIN_WAS_PRESENT=''
PREVIOUS_RELEASE_TARGET=''
ARTIFACT_TMP_DIR=''
rollback() {
  local status=$?
  if (( completed == 1 || rollback_ready == 0 )); then
    return "$status"
  fi

  set +e
  printf 'dsh-ec2-deploy: rollback=started\n' >&2
  if (( switched == 1 )); then
    if [[ -n "$ARTIFACT_URI" ]]; then
      if [[ -n "$PREVIOUS_RELEASE_TARGET" ]]; then
        local temporary="${CURRENT_RELEASE}.rollback.$$"
        ln -s "$PREVIOUS_RELEASE_TARGET" "$temporary"
        mv -Tf "$temporary" "$CURRENT_RELEASE"
      else
        rm -f "$CURRENT_RELEASE"
      fi
    else
      git -C "$REPOSITORY_ROOT" checkout --detach "$PREVIOUS_SHA" >/dev/null 2>&1
    fi
  fi
  if [[ -n "$INGRESS_DROPIN_WAS_PRESENT" ]]; then
    restore_target_public_host_dropin
  fi
  restore_profile
  if (( SERVICE_WAS_ACTIVE == 1 )); then
    systemctl restart "$SERVICE_NAME" >/dev/null 2>&1
  fi
  if [[ -n "$ARTIFACT_TMP_DIR" ]]; then
    rm -rf "$ARTIFACT_TMP_DIR"
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
verify_public_ingress

PREVIOUS_SHA=$(git -C "$REPOSITORY_ROOT" rev-parse HEAD)
SERVICE_WAS_ACTIVE=1
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP-$PREVIOUS_SHA"
PROFILE_FILES=(package.json pnpm-lock.yaml pnpm-workspace.yaml cordis.patch.yml)
declare -A PROFILE_FILE_PRESENT=()
MIGRATOR_PATH="$BACKUP_DIR/migrate-settings.py"
BUNDLE_PATCH_FILE="$BACKUP_DIR/aws-worker-cordis.patch.yml"
mkdir -p "$BACKUP_DIR/profile"
cp -a "$SETTINGS_FILE" "$BACKUP_DIR/settings.yaml"
git -C "$REPOSITORY_ROOT" show "$DEPLOY_SHA:deploy/dsh-ec2/migrate-settings.py" >"$MIGRATOR_PATH" \
  || die 'the deployment revision is missing the settings migrator'
git -C "$REPOSITORY_ROOT" show "$DEPLOY_SHA:packages/flinter/dsh-aws-worker-profile/cordis.patch.yml" >"$BUNDLE_PATCH_FILE" \
  || die 'the deployment revision is missing the AWS worker patch'
chmod 700 "$MIGRATOR_PATH"
chmod 600 "$BUNDLE_PATCH_FILE"
for file in "${PROFILE_FILES[@]}"; do
  if [[ -e "$PROFILE_DIR/$file" ]]; then
    cp -a "$PROFILE_DIR/$file" "$BACKUP_DIR/profile/$file"
    PROFILE_FILE_PRESENT["$file"]=1
  else
    PROFILE_FILE_PRESENT["$file"]=0
  fi
done
rollback_ready=1

prepare_runtime_release
systemctl stop "$SERVICE_NAME"
printf 'dsh-ec2-deploy: service=stopped\n'
run_logged settings-compat python3 "$MIGRATOR_PATH" "$SETTINGS_FILE"
migrate_legacy_worker_overlay
install_target_public_host_dropin
switch_runtime_release
run_logged dump-config env DSH_HOME="$HOME_ROOT" DSH_ROOT="$CURRENT_RELEASE" DSH_COMPUTE_BACKEND=ec2 \
  node "$CURRENT_RELEASE/runtime-bootstrap.mjs" \
  --profile "$PROFILE_NAME" --patch "$CURRENT_RELEASE/runtime-support/aws-worker.patch.yml" --dump-config
run_logged settings-compat-check python3 "$MIGRATOR_PATH" --check "$SETTINGS_FILE"

grep -q 'credentials-aws-secrets-manager' "$BACKUP_DIR/dump-config.log" \
  || die 'the AWS credential provider is absent from the composed profile'
grep -q 'ARK_PLAN_API_KEY: flinter/dsh-ark-agent-plan' "$BACKUP_DIR/dump-config.log" \
  || die 'the Ark secret mapping is absent from the composed profile'
grep -q 'allowWrites: false' "$BACKUP_DIR/dump-config.log" \
  || die 'the AWS credential provider is not read-only'
if ! (
  cd "$CURRENT_RELEASE"
    DSH_DEPLOY_AWS_REGION="$DEPLOY_REGION" \
    node --input-type=module <<'NODE'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AwsSecretsManagerCredentialProvider } from '@deepseek-ai/dsh-credentials-aws-secrets-manager'

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

verify_target_public_host_dropin
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
rm -rf "$ARTIFACT_TMP_DIR"
ARTIFACT_TMP_DIR=''
completed=1
printf 'dsh-ec2-deploy: deployment=success sha=%s http=%s restarts=%s backup=%s\n' \
  "$DEPLOY_SHA" "$HTTP_STATUS" "$RESTART_COUNT" "$BACKUP_DIR"
