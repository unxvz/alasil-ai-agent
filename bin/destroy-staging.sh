#!/usr/bin/env bash
# Tear down the staging Node.js app and code.
# Preserves the staging.bot.useddevice.ae subdomain for reuse on next provision.
#
# Usage:
#   bin/destroy-staging.sh         # interactive confirmation
#   bin/destroy-staging.sh --yes   # skip prompt
#
# What it does:
#   1. cloudlinux-selector stop
#   2. cloudlinux-selector destroy (removes app entry + nodevenv)
#   3. rm -rf staging-alasil-bot (code + .env + logs)
#
# What it does NOT do:
#   - Delete the subdomain (UAPI doesn't expose delsubdomain — preserved on purpose).
#   - Unregister the Telegram webhook (will 404 until next provision; harmless).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-common.sh
source "${SCRIPT_DIR}/lib/staging-common.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--yes]

Stops and removes the staging Node.js app + code at ${STAGING_APP_ROOT}.
Subdomain ${STAGING_SUBDOMAIN} is preserved for reuse.

Flags:
  -y, --yes   Skip the confirmation prompt
  -h, --help  Show this help
EOF
}

main() {
  local yes=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes)  yes=1 ;;
      -h|--help) usage; exit 0 ;;
      *)         err "Unknown flag: $1"; usage; exit 1 ;;
    esac
    shift
  done

  warn "This will tear down the staging environment:"
  warn "  - Stop and destroy Node.js app at ${STAGING_APP_ROOT}"
  warn "  - Remove ${STAGING_APP_ROOT} (code, .env, logs)"
  warn "  - PRESERVE subdomain ${STAGING_SUBDOMAIN} (reused on next provision)"

  if [[ "$yes" == "0" ]]; then
    printf 'Type "destroy" to confirm: ' >&2
    local answer
    read -r answer
    [[ "$answer" == "destroy" ]] || { err "Not confirmed."; exit 1; }
  fi

  log "Stopping app..."
  remote "cloudlinux-selector stop --json --interpreter nodejs \
    --user '${SSH_USER}' --app-root '${STAGING_APP_ROOT}' 2>&1" \
    || warn "Stop failed (app may not be running)."

  log "Destroying app entry..."
  remote "cloudlinux-selector destroy --json --interpreter nodejs \
    --user '${SSH_USER}' --app-root '${STAGING_APP_ROOT}' 2>&1" \
    || warn "Destroy failed (app may already be removed)."

  log "Removing app root ${STAGING_APP_ROOT}..."
  remote "rm -rf '${STAGING_APP_ROOT}'" || { err "rm -rf failed"; exit 1; }

  ok "Staging torn down."
  log "Subdomain ${STAGING_SUBDOMAIN} preserved for reuse."
  log "To remove the subdomain permanently: cPanel UI → Domains → Remove."
}

main "$@"
