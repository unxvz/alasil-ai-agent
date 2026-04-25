#!/usr/bin/env bash
# Shared config + helpers for bin/provision-staging.sh and bin/destroy-staging.sh.
# Source-only; do not execute directly.

[[ -n "${_STAGING_COMMON_SOURCED:-}" ]] && return 0
_STAGING_COMMON_SOURCED=1

# ===== Server =====
SSH_USER=useddevi
SSH_HOST=bot.useddevice.ae
SSH_TARGET="${SSH_USER}@${SSH_HOST}"

# ===== Production (read-only reference) =====
PROD_DOMAIN=bot.useddevice.ae
PROD_APP_ROOT=/home/useddevi/alasil-bot

# ===== Staging =====
STAGING_SUBDOMAIN=staging.bot.useddevice.ae
STAGING_SUB_LABEL=staging                            # uapi addsubdomain `domain` arg
STAGING_SUB_PARENT=bot.useddevice.ae                 # uapi addsubdomain `rootdomain` arg
STAGING_APP_ROOT=/home/useddevi/staging-alasil-bot
STAGING_DOCROOT_REL=staging-alasil-bot/public_html   # relative to user home, for `dir` arg
STAGING_BRANCH=staging

# ===== Shared =====
REPO_URL=https://github.com/unxvz/alasil-ai-agent.git
NODE_VERSION=24
HEALTH_PATH=/health
TELEGRAM_WEBHOOK_PATH_PREFIX=/webhook/telegram

# .env filter: keys matching these PREFIXES get blanked in staging .env.
# Documented here for visibility; consumed by phase_env in provision-staging.sh.
ENV_FILTER_PREFIXES=(DATABASE_ DB_ PG_ POSTGRES_ REDIS_ MONGO_ KAFKA_)

# ===== Logging =====
_ts()  { date +'%H:%M:%S'; }
log()  { printf '\033[36m[%s]\033[0m %s\n'      "$(_ts)" "$*" >&2; }
warn() { printf '\033[33m[%s WARN]\033[0m %s\n' "$(_ts)" "$*" >&2; }
err()  { printf '\033[31m[%s ERR ]\033[0m %s\n' "$(_ts)" "$*" >&2; }
ok()   { printf '\033[32m[%s OK  ]\033[0m %s\n' "$(_ts)" "$*" >&2; }

# ===== SSH =====
SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=30)
# NOTE: Callers must NOT pass user-supplied values via string interpolation
# in remote "..." commands. All interpolated args in this codebase are
# hardcoded constants from this file or read-only paths. If user input is
# ever introduced, switch to argv passing via `ssh ... bash -s -- "$arg"`
# heredoc style (see phase_deploy in provision-staging.sh for an example).
remote() {
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$@"
}

# ===== Misc =====
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { err "Required command not in PATH: $1"; return 1; }
}
