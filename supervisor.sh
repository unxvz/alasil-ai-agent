#!/usr/bin/env bash
# Supervisor: watches node server + ngrok, restarts either if it dies.
# Logs to /tmp/supervisor.log. Runs forever; kill with `pkill -f supervisor.sh`.

set -u
cd "$(dirname "$0")"

LOG=/tmp/supervisor.log
SERVER_LOG=/tmp/aisupport.log
NGROK_LOG=/tmp/ngrok.log
NGROK_DOMAIN=overhang-wireless-earthling.ngrok-free.dev
PORT=3000
TELEGRAM_TOKEN=8619733332:AAEcwEzIjK_D-muF4z-DLiPyhSdBcowgzD8
WEBHOOK_SECRET=alasil-2026-xjk82nq4

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

SYNC_LOG=/tmp/apple-sync.log
SYNC_INTERVAL_SEC=86400
LAST_SYNC=0

run_apple_sync() {
  log "apple-sync START"
  if node scripts/sync-apple.js >> "$SYNC_LOG" 2>&1; then
    log "apple-sync OK"
    # Restart server so it reloads the refreshed knowledge file into memory
    if pgrep -f 'node src/server.js' > /dev/null; then
      log "restarting server to pick up fresh lineup"
      pkill -f 'node src/server.js'
      sleep 2
      start_server
      refresh_webhook
    fi
    LAST_SYNC=$(date +%s)
  else
    log "apple-sync FAILED (see $SYNC_LOG)"
  fi
}

start_server() {
  pkill -f 'node src/server.js' 2>/dev/null
  lsof -ti:$PORT 2>/dev/null | xargs kill -9 2>/dev/null
  sleep 1
  nohup node src/server.js >> "$SERVER_LOG" 2>&1 &
  sleep 6
  if curl -fsS --max-time 5 "http://localhost:$PORT/health" > /dev/null 2>&1; then
    log "server STARTED pid=$(lsof -ti:$PORT | head -1)"
  else
    log "server START FAILED"
  fi
}

start_ngrok() {
  pkill -f 'ngrok http' 2>/dev/null
  sleep 1
  nohup ngrok http --domain=$NGROK_DOMAIN $PORT >> "$NGROK_LOG" 2>&1 &
  sleep 5
  if curl -fsS --max-time 5 "https://$NGROK_DOMAIN/health" > /dev/null 2>&1; then
    log "ngrok STARTED"
    refresh_webhook
  else
    log "ngrok START FAILED"
  fi
}

refresh_webhook() {
  local resp
  resp=$(curl -sS --max-time 8 -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/setWebhook" \
    -H 'Content-Type: application/json' \
    -d "{\"url\":\"https://$NGROK_DOMAIN/webhook/telegram/$WEBHOOK_SECRET\",\"drop_pending_updates\":false,\"allowed_updates\":[\"message\",\"edited_message\",\"channel_post\"]}")
  log "webhook reset: $resp"
}

check_server() {
  curl -fsS --max-time 5 "http://localhost:$PORT/health" > /dev/null 2>&1
}

check_ngrok_proc() {
  pgrep -f 'ngrok http' > /dev/null 2>&1
}

check_ngrok_public() {
  curl -fsS --max-time 5 "https://$NGROK_DOMAIN/health" > /dev/null 2>&1
}

log "supervisor START"
run_apple_sync
start_server
start_ngrok

while true; do
  if ! check_server; then
    log "server DOWN, restarting"
    start_server
    refresh_webhook
  fi
  if ! check_ngrok_proc; then
    log "ngrok process missing, restarting"
    start_ngrok
  elif ! check_ngrok_public; then
    log "ngrok public unreachable, restarting"
    start_ngrok
  fi
  NOW=$(date +%s)
  if [ $((NOW - LAST_SYNC)) -ge $SYNC_INTERVAL_SEC ]; then
    run_apple_sync
  fi
  sleep 20
done
