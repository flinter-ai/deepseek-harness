#!/usr/bin/env bash
set -Eeuo pipefail

# Install the reviewed, loopback-only DSH public ingress on the existing EC2
# host. Tunnel creation, DNS routing, and credential delivery are account-
# owner operations; this script only installs and verifies the checked-in
# service/configuration once the credential already exists on the host.

readonly REPOSITORY_ROOT="${DSH_REPOSITORY_ROOT:-/opt/dsh-phase2}"
readonly CLOUD_FLARED_BINARY="${DSH_CLOUDFLARED_BIN:-/home/ubuntu/bin/cloudflared}"
readonly CONFIG_SOURCE="$REPOSITORY_ROOT/deploy/dsh-ec2/cloudflared/dsh-ec2-phase2.yml"
readonly UNIT_SOURCE="$REPOSITORY_ROOT/deploy/dsh-ec2/cloudflared/dsh-ec2-phase2-named-tunnel.service"
readonly DROPIN_SOURCE="$REPOSITORY_ROOT/deploy/dsh-ec2/systemd/10-dsh-web-public-host.conf"
readonly CONFIG_TARGET='/etc/cloudflared/dsh-ec2-phase2.yml'
readonly CREDENTIAL_TARGET='/etc/cloudflared/dsh-ec2-phase2.json'
readonly UNIT_TARGET='/etc/systemd/system/dsh-ec2-phase2-named-tunnel.service'
readonly DROPIN_TARGET='/etc/systemd/system/dsh.service.d/10-dsh-web-public-host.conf'
readonly TUNNEL_SERVICE='dsh-ec2-phase2-named-tunnel.service'
readonly DSH_SERVICE='dsh.service'
readonly DSH_PORT='3080'
readonly PUBLIC_HOST='dsh-web.useflinter.com'

replace_existing=0
if [[ "${1:-}" == '--replace' ]]; then
  replace_existing=1
  shift
fi
[[ $# == 0 ]] || {
  printf 'dsh-ingress: usage: %s [--replace]\n' "$0" >&2
  exit 2
}

die() {
  printf 'dsh-ingress: error: %s\n' "$*" >&2
  exit 1
}

(( EUID == 0 )) || die 'must run as root'
[[ -x "$CLOUD_FLARED_BINARY" ]] || die "cloudflared binary is missing: $CLOUD_FLARED_BINARY"
[[ -f "$CONFIG_SOURCE" ]] || die "tracked tunnel config is missing: $CONFIG_SOURCE"
[[ -f "$UNIT_SOURCE" ]] || die "tracked tunnel unit is missing: $UNIT_SOURCE"
[[ -f "$DROPIN_SOURCE" ]] || die "tracked DSH drop-in is missing: $DROPIN_SOURCE"
[[ -f "$CREDENTIAL_TARGET" ]] || die "tunnel credential is missing: $CREDENTIAL_TARGET"
[[ "$(stat -c '%a' "$CREDENTIAL_TARGET")" == 600 ]] || die 'tunnel credential must have mode 600'
[[ "$(stat -c '%U:%G' "$CREDENTIAL_TARGET")" == 'ubuntu:ubuntu' ]] \
  || die 'tunnel credential must be owned by ubuntu:ubuntu'
systemctl is-active --quiet "$DSH_SERVICE" || die "DSH service is not active: $DSH_SERVICE"
ss -ltn | grep -qE ":${DSH_PORT}[[:space:]]" || die "DSH service is not listening on port $DSH_PORT"

backup_dir=''
changed=0
backup_existing() {
  local target="$1"
  [[ -n "$backup_dir" ]] || {
    backup_dir="/var/lib/dsh-phase2/deploy-backups/pre-public-ingress-$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 700 "$backup_dir"
  }
  cp -a "$target" "$backup_dir/$(basename "$target").before"
}

install_exact() {
  local source="$1"
  local target="$2"
  local mode="$3"
  local owner="$4"
  local group="$5"
  if [[ -e "$target" ]]; then
    [[ -f "$target" && ! -L "$target" ]] || die "existing target is not a regular file: $target"
    if cmp -s "$source" "$target" \
      && [[ "$(stat -c '%a' "$target")" == "$mode" ]] \
      && [[ "$(stat -c '%U:%G' "$target")" == "$owner:$group" ]]; then
      return
    fi
    (( replace_existing == 1 )) \
      || die "refusing to overwrite differing ingress file: $target (rerun once with --replace after review)"
    backup_existing "$target"
  fi
  install -o "$owner" -g "$group" -m "$mode" "$source" "$target"
  changed=1
}

[[ -d /etc/cloudflared ]] || install -d -o ubuntu -g ubuntu -m 700 /etc/cloudflared
[[ -d /etc/systemd/system/dsh.service.d ]] \
  || install -d -m 755 /etc/systemd/system/dsh.service.d
install_exact "$CONFIG_SOURCE" "$CONFIG_TARGET" 600 ubuntu ubuntu
install_exact "$UNIT_SOURCE" "$UNIT_TARGET" 644 root root
install_exact "$DROPIN_SOURCE" "$DROPIN_TARGET" 644 root root

"$CLOUD_FLARED_BINARY" --no-autoupdate --config "$CONFIG_TARGET" tunnel ingress validate \
  >/dev/null 2>&1 || die 'cloudflared rejected the reviewed ingress configuration'

if (( changed == 1 )); then
  systemctl daemon-reload
  systemctl restart "$DSH_SERVICE"
fi
systemctl enable --now "$TUNNEL_SERVICE"
for _ in {1..30}; do
  if systemctl is-active --quiet "$DSH_SERVICE" \
    && systemctl is-active --quiet "$TUNNEL_SERVICE" \
    && ss -ltn | grep -qE ":${DSH_PORT}[[:space:]]"; then
    break
  fi
  sleep 2
done
systemctl is-active --quiet "$DSH_SERVICE" || die 'DSH service did not become active'
systemctl is-active --quiet "$TUNNEL_SERVICE" || die 'DSH tunnel did not become active'
ss -ltn | grep -qE ":${DSH_PORT}[[:space:]]" || die "DSH service did not listen on port $DSH_PORT"
grep -Fq -- "--trusted-host $PUBLIC_HOST" \
  <(systemctl show "$DSH_SERVICE" -p ExecStart --value) \
  || die "DSH service does not trust the stable hostname: $PUBLIC_HOST"
http_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  "http://127.0.0.1:${DSH_PORT}/" || true)
[[ "$http_status" == 401 ]] || die "DSH health check returned HTTP $http_status"

printf 'dsh-ingress: configured host=%s dsh=%s tunnel=%s backup=%s\n' \
  "$PUBLIC_HOST" "$DSH_SERVICE" "$TUNNEL_SERVICE" "${backup_dir:-none}"
