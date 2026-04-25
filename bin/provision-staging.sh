#!/usr/bin/env bash
# Provision (or refresh) the staging environment for staging.bot.useddevice.ae.
# See docs/STAGING_DEPLOY.md for the full guide.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/staging-common.sh
source "${SCRIPT_DIR}/lib/staging-common.sh"

ROTATE=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [phase] [--rotate]

Phases (default: all):
  preflight   SSH + tooling + production health
  subdomain   Create staging.bot.useddevice.ae if missing
  app         Create Node.js app via cloudlinux-selector if missing
  deploy      Clone/update repo + npm ci
  env         Merge prod .env, filter stateful, override telegram, write
  webhook     Register Telegram webhook
  start       Restart Node.js app
  health      GET /health on staging URL
  all         All of the above (default)

Flags:
  --rotate    Regenerate webhook secret + re-prompt for token
  -h, --help  Show this help

See docs/STAGING_DEPLOY.md for full guide.
EOF
}

# ──────────────────────────────────────────────────────────────────
# Phases
# ──────────────────────────────────────────────────────────────────

phase_preflight() {
  log "Phase: preflight"

  if [[ "$(uname)" != "Darwin" ]]; then
    warn "Not running on macOS (uname=$(uname)) — proceeding anyway."
  fi

  require_cmd ssh
  require_cmd curl
  require_cmd dig
  require_cmd openssl
  require_cmd git

  log "SSH connectivity..."
  if ! remote 'true' >/dev/null 2>&1; then
    err "SSH to ${SSH_TARGET} failed."
    return 1
  fi
  ok "SSH OK"

  log "Server tooling..."
  if ! remote 'command -v cloudlinux-selector && command -v uapi && command -v git' >/dev/null; then
    err "Server is missing one of: cloudlinux-selector, uapi, git"
    return 1
  fi
  ok "cloudlinux-selector / uapi / git present on server"

  log "Production health (informational only)..."
  if curl -sfL -m 5 "https://${PROD_DOMAIN}${HEALTH_PATH}" -o /dev/null; then
    ok "Production health OK"
  else
    warn "Could not reach https://${PROD_DOMAIN}${HEALTH_PATH} — production health unknown. Continuing."
  fi

  log "Staging branch on origin..."
  if ! git ls-remote --exit-code --heads "${REPO_URL}" "${STAGING_BRANCH}" >/dev/null 2>&1; then
    err "Branch '${STAGING_BRANCH}' not found on ${REPO_URL}. Push it first."
    return 1
  fi
  ok "Branch ${STAGING_BRANCH} exists on origin"
}

phase_subdomain() {
  log "Phase: subdomain (${STAGING_SUBDOMAIN})"

  local domains_json
  domains_json=$(remote "uapi --output=json DomainInfo list_domains") \
    || { err "Failed to query DomainInfo"; return 1; }

  if echo "$domains_json" | grep -qF "${STAGING_SUBDOMAIN}"; then
    ok "Subdomain ${STAGING_SUBDOMAIN} already exists, skipping create."
  else
    log "Creating subdomain..."
    remote "mkdir -p '${STAGING_APP_ROOT}/public_html'" || true

    local result
    result=$(remote "uapi --output=json SubDomain addsubdomain \
      domain='${STAGING_SUB_LABEL}' \
      rootdomain='${STAGING_SUB_PARENT}' \
      dir='${STAGING_DOCROOT_REL}'" 2>&1) \
      || { err "$result"; return 1; }

    if ! echo "$result" | grep -q '"status":1'; then
      err "Subdomain create did not return status:1 — output:"
      echo "$result" >&2
      return 1
    fi
    ok "Subdomain created."
  fi

  log "DNS resolution check..."
  for i in 1 2 3 4 5 6; do
    if dig +short +time=2 +tries=1 "${STAGING_SUBDOMAIN}" @1.1.1.1 | grep -qE '^[0-9]'; then
      ok "DNS resolves."
      return 0
    fi
    [[ $i -lt 6 ]] && sleep 5
  done
  warn "DNS not yet propagating for ${STAGING_SUBDOMAIN} — may take a few more minutes. Continuing."
}

phase_app() {
  log "Phase: Node.js app"

  if remote "[ -d /home/${SSH_USER}/nodevenv/$(basename ${STAGING_APP_ROOT}) ]"; then
    ok "Node.js app for ${STAGING_APP_ROOT} already registered, skipping create."
    return 0
  fi

  log "Creating Node.js app (node ${NODE_VERSION}, mode=production)..."
  local out
  out=$(remote "cloudlinux-selector create --json --interpreter nodejs \
    --domain '${STAGING_SUBDOMAIN}' \
    --app-root '${STAGING_APP_ROOT}' \
    --app-uri '/' \
    --version '${NODE_VERSION}' \
    --app-mode production \
    --startup-file 'src/server.js'" 2>&1) \
    || { err "$out"; return 1; }

  if echo "$out" | grep -qE '"result"[[:space:]]*:[[:space:]]*"success"|"success"[[:space:]]*:[[:space:]]*true'; then
    ok "App created."
  else
    err "App create response did not indicate success — output:"
    echo "$out" >&2
    return 1
  fi
}

phase_deploy() {
  log "Phase: deploy code (branch=${STAGING_BRANCH})"

  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" bash -s -- \
      "$STAGING_APP_ROOT" "$REPO_URL" "$STAGING_BRANCH" <<'REMOTE'
set -euo pipefail
APP_ROOT="$1"; REPO_URL="$2"; BRANCH="$3"

[ -d "$APP_ROOT" ] || { echo "App root $APP_ROOT does not exist — run 'app' phase first." >&2; exit 1; }
cd "$APP_ROOT"

if [ ! -d .git ]; then
  echo "[deploy] Initializing git in existing app root (preserves cPanel-generated files)..."
  git init -q
  git remote add origin "$REPO_URL"
  git fetch -q --depth=50 origin "$BRANCH"
  # reset --hard preserves untracked files like public_html/.htaccess (Passenger config)
  # -f overwrites cPanel stubs (src/server.js, index.html) with tracked
  # repo files. public_html/.htaccess is untracked in the repo, not affected.
  git checkout -qf -B "$BRANCH" "origin/$BRANCH"
  git reset -q --hard "origin/$BRANCH"
else
  echo "[deploy] Updating existing checkout..."
  git fetch -q origin
  # -f overwrites cPanel stubs (src/server.js, index.html) with tracked
  # repo files. public_html/.htaccess is untracked in the repo, not affected.
  git checkout -qf -B "$BRANCH" "origin/$BRANCH"
  git reset -q --hard "origin/$BRANCH"
fi

echo "[deploy] HEAD: $(git rev-parse --short HEAD) $(git log -1 --format='%s')"

# Locate venv (version subdir name may differ from requested if cPanel coerced it)
VENV_BIN=$(ls -d "/home/$(whoami)/nodevenv/$(basename "$APP_ROOT")"/*/bin 2>/dev/null | head -1)
if [ -z "$VENV_BIN" ]; then
  echo "[deploy] No nodevenv found for $APP_ROOT — was the 'app' phase run?" >&2
  exit 1
fi
# shellcheck disable=SC1091
set +u  # cloudlinux activate script references unset CL_VIRTUAL_ENV (line 78)
source "$VENV_BIN/activate"
set -u
echo "[deploy] node $(node -v), npm $(npm -v)"
echo "[deploy] Installing dependencies (npm ci)..."
npm ci --no-audit --no-fund
echo "[deploy] Deps installed."
REMOTE
  ok "Code deployed + deps installed."
}

phase_env() {
  log "Phase: .env"

  # Capture existing token/secret (if any) for idempotency
  local existing_env existing_token="" existing_secret=""
  existing_env=$(remote "cat '${STAGING_APP_ROOT}/.env' 2>/dev/null || true")
  if [[ -n "$existing_env" ]]; then
    existing_token=$(printf '%s\n' "$existing_env" | awk -F= '/^TELEGRAM_BOT_TOKEN=/{sub(/^[^=]+=/,""); print; exit}')
    existing_secret=$(printf '%s\n' "$existing_env" | awk -F= '/^TELEGRAM_WEBHOOK_SECRET=/{sub(/^[^=]+=/,""); print; exit}')
  fi

  local token="$existing_token"
  local secret="$existing_secret"

  if [[ "$ROTATE" == "1" || -z "$token" ]]; then
    if [[ "$ROTATE" == "1" ]]; then
      log "Rotating: prompting for new token + regenerating webhook secret"
    else
      log "First run: prompting for staging Telegram bot token"
    fi
    printf 'Paste staging Telegram bot token (input hidden, ENTER when done): ' >&2
    IFS= read -rs token
    printf '\n' >&2
    [[ -z "$token" ]] && { err "Empty token, aborting"; return 1; }
    secret=$(openssl rand -hex 24)
    [[ -z "$secret" ]] && { err "Failed to generate webhook secret"; return 1; }
  else
    ok "Existing TELEGRAM_BOT_TOKEN preserved (use --rotate to regenerate)"
  fi

  log "Reading prod .env..."
  local prod_env
  prod_env=$(remote "cat '${PROD_APP_ROOT}/.env'") || { err "Could not read prod .env"; return 1; }

  log "Building staging .env (filter stateful, substitute domain)..."
  local staging_env
  staging_env=$(_build_staging_env "$prod_env" "$token" "$secret")

  log "Writing staging .env (chmod 600)..."
  printf '%s' "$staging_env" \
    | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
        "umask 077 && cat > '${STAGING_APP_ROOT}/.env' && chmod 600 '${STAGING_APP_ROOT}/.env'"
  ok ".env written."
}

# Build staging .env body. Args: $1=prod_env $2=token $3=secret. Outputs to stdout.
_build_staging_env() {
  local prod_env="$1" token="$2" secret="$3"
  local generated_at; generated_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  local prefixes_csv;  prefixes_csv=$(IFS=,; echo "${ENV_FILTER_PREFIXES[*]}")
  local prefixes_colon; prefixes_colon=$(IFS=:; echo "${ENV_FILTER_PREFIXES[*]}")
  local prod_re; prod_re=$(printf '%s' "$PROD_DOMAIN" | sed 's/[].*+?^${}()|[\\/]/\\&/g')

  cat <<HEADER
# ──────────────────────────────────────────────────────────────────
# STAGING ENVIRONMENT — DO NOT POINT AT PROD DATA
#
# Generated by bin/provision-staging.sh on ${generated_at}
#
# DATABASE_URL and REDIS_URL are intentionally EMPTY:
# the bot falls back to in-memory session store (session loss on restart
# is acceptable for staging). DO NOT set these to prod values.
#
# If staging needs persistent storage in the future, provision separate
# staging instances of Postgres/Redis. Never share with production.
#
# Stateful filter prefixes (blanked in staging):
#   ${prefixes_csv}
# Domain references to ${PROD_DOMAIN} are rewritten to ${STAGING_SUBDOMAIN}.
# ──────────────────────────────────────────────────────────────────

HEADER

  printf '%s\n' "$prod_env" | awk -v prefixes="$prefixes_colon" '
    BEGIN {
      n = split(prefixes, pfx, ":")
      exact["DATABASE_URL"] = 1
      exact["REDIS_URL"] = 1
      exact["TELEGRAM_BOT_TOKEN"] = 1
      exact["TELEGRAM_WEBHOOK_SECRET"] = 1
      exact["NODE_ENV"] = 1
    }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { print; next }
    /^[A-Za-z_][A-Za-z0-9_]*=/ {
      key = $0; sub(/=.*/, "", key)
      val = $0; sub(/^[^=]*=/, "", val)
      if (key in exact) {
        if (key == "DATABASE_URL" || key == "REDIS_URL") print key "="
        next
      }
      for (i = 1; i <= n; i++) {
        if (index(key, pfx[i]) == 1) { print key "="; next }
      }
      print key "=" val
      next
    }
    { print }
  ' | sed -E "s|(^|[^A-Za-z0-9.-])${prod_re}|\\1${STAGING_SUBDOMAIN}|g"

  printf '\n# === Staging overrides (managed by provision-staging.sh) ===\n'
  printf 'NODE_ENV=production\n'
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$token"
  printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$secret"
}

phase_webhook() {
  log "Phase: register Telegram webhook"

  local token secret
  token=$(remote "awk -F= '/^TELEGRAM_BOT_TOKEN=/{sub(/^[^=]+=/,\"\"); print; exit}' '${STAGING_APP_ROOT}/.env'")
  secret=$(remote "awk -F= '/^TELEGRAM_WEBHOOK_SECRET=/{sub(/^[^=]+=/,\"\"); print; exit}' '${STAGING_APP_ROOT}/.env'")

  if [[ -z "$token" || -z "$secret" ]]; then
    err "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in staging .env. Run 'env' phase first."
    return 1
  fi

  local webhook_url="https://${STAGING_SUBDOMAIN}${TELEGRAM_WEBHOOK_PATH_PREFIX}/${secret}"
  log "Setting webhook to https://${STAGING_SUBDOMAIN}${TELEGRAM_WEBHOOK_PATH_PREFIX}/<secret>"

  local response
  response=$(curl -sS -m 10 -X POST "https://api.telegram.org/bot${token}/setWebhook" \
    --data-urlencode "url=${webhook_url}" \
    --data-urlencode "drop_pending_updates=true") \
    || { err "curl to Telegram failed"; return 1; }

  if echo "$response" | grep -q '"ok":true'; then
    ok "Webhook registered."
  else
    err "Webhook registration failed:"
    # Mask the secret in case Telegram echoes our URL back in the error
    echo "$response" | sed "s|${secret}|<secret>|g" >&2
    return 1
  fi
}

phase_start() {
  log "Phase: restart app"
  local out
  out=$(remote "cloudlinux-selector restart --json --interpreter nodejs \
    --user '${SSH_USER}' --app-root '${STAGING_APP_ROOT}'" 2>&1) \
    || { err "$out"; return 1; }
  ok "App restart issued."
  log "Waiting 3s for Passenger spawn..."
  sleep 3
}

phase_health() {
  log "Phase: health check"
  local url="https://${STAGING_SUBDOMAIN}${HEALTH_PATH}"
  local i status
  for i in 1 2 3 4 5; do
    log "Attempt ${i}/5: GET ${url}"
    status=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 "$url" || echo "000")
    if [[ "$status" == "200" ]]; then
      ok "Health check passed (HTTP 200)."
      return 0
    fi
    log "Got HTTP ${status}, retrying in 5s..."
    sleep 5
  done

  err "Health check failed after 5 attempts."
  warn "Recent app logs:"
  remote "tail -50 '${STAGING_APP_ROOT}/logs'/*.log 2>/dev/null; \
          echo '--- stderr.log ---'; \
          tail -50 '${STAGING_APP_ROOT}/stderr.log' 2>/dev/null" || true
  warn "Rollback option: bin/destroy-staging.sh --yes"
  return 1
}

# ──────────────────────────────────────────────────────────────────
# Dispatch
# ──────────────────────────────────────────────────────────────────

main() {
  local cmd=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --rotate)  ROTATE=1 ;;
      -h|--help) usage; exit 0 ;;
      -*)        err "Unknown flag: $1"; exit 1 ;;
      *)
        if [[ -z "$cmd" ]]; then cmd="$1"
        else err "Unexpected arg: $1"; exit 1
        fi
        ;;
    esac
    shift
  done
  cmd="${cmd:-all}"

  case "$cmd" in
    preflight) phase_preflight ;;
    subdomain) phase_preflight; phase_subdomain ;;
    app)       phase_preflight; phase_app ;;
    deploy)    phase_preflight; phase_deploy ;;
    env)       phase_preflight; phase_env ;;
    webhook)   phase_preflight; phase_webhook ;;
    start)     phase_preflight; phase_start ;;
    health)    phase_preflight; phase_health ;;
    all)
      phase_preflight
      phase_subdomain
      phase_app
      phase_deploy
      phase_env
      phase_webhook
      phase_start
      phase_health
      ok "Provisioning complete: https://${STAGING_SUBDOMAIN}${HEALTH_PATH}"
      ;;
    help) usage ;;
    *)    err "Unknown command: $cmd"; usage; exit 1 ;;
  esac
}

main "$@"
