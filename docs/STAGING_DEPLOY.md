# Staging Deploy Guide

End-to-end provisioning, redeploys, and teardown for `staging.bot.useddevice.ae`.

All scripts run from this repo (Mac side) and SSH into `useddevi@bot.useddevice.ae`. SSH key auth is required; verify with `ssh useddevi@bot.useddevice.ae 'whoami'` before starting.

## Files

- `bin/provision-staging.sh` — create/refresh staging end-to-end (idempotent)
- `bin/destroy-staging.sh` — stop and remove staging app + code (subdomain preserved)
- `bin/lib/staging-common.sh` — shared config and helpers (sourced; do not run directly)

## Prerequisites

- A staging Telegram bot exists in BotFather and you have its token. (Done.)
- A `staging` branch exists on `origin` (`https://github.com/unxvz/alasil-ai-agent`). Push it before first run.
- Local tools: `ssh`, `curl`, `dig`, `openssl`, `git`. All standard on macOS.
- Server tools: `cloudlinux-selector`, `uapi`, `git` — verified by the script's preflight phase.

## First run

```sh
bin/provision-staging.sh
```

Eight phases run in order:

1. **preflight** — SSH, tooling, prod health, branch existence
2. **subdomain** — create `staging.bot.useddevice.ae` via UAPI if missing
3. **app** — create the Node.js app via `cloudlinux-selector` if missing
4. **deploy** — clone the repo into `/home/useddevi/staging-alasil-bot`, check out `staging`, run `npm ci`
5. **env** — merge prod `.env` with staging-specific overrides; prompt for the bot token (input hidden); generate a webhook secret
6. **webhook** — call Telegram `setWebhook`
7. **start** — `cloudlinux-selector restart`
8. **health** — `GET https://staging.bot.useddevice.ae/health` (5 retries)

When phase 5 prompts for the token, paste it from BotFather and press Enter. Input is not echoed and is never logged.

## Subsequent runs (redeploy)

Re-running the same script is the redeploy flow. It is idempotent:

```sh
bin/provision-staging.sh
```

- **subdomain**: skipped (already exists)
- **app**: skipped (already registered)
- **deploy**: `git fetch` + `reset --hard origin/staging` + `npm ci`
- **env**: `TELEGRAM_BOT_TOKEN` preserved from existing staging `.env`; everything else re-merged from prod (so new prod keys flow through)
- **webhook**: re-registered (idempotent on Telegram's side)
- **start** + **health**: as on first run

## Running individual phases

```sh
bin/provision-staging.sh deploy        # just redeploy code
bin/provision-staging.sh env           # just rebuild .env
bin/provision-staging.sh webhook       # just re-register webhook
bin/provision-staging.sh health        # just verify health
```

Each phase runs preflight first.

## Rotating Telegram credentials

```sh
bin/provision-staging.sh env --rotate
bin/provision-staging.sh webhook
```

`--rotate` discards the existing `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, prompts for a new token, and generates a new secret. Re-run `webhook` to re-register Telegram with the new secret.

## .env policy

The staging `.env` is built by merging prod's `.env` with these rules:

**Blanked** (key preserved, value empty) — staging falls back to in-memory stores:
- `DATABASE_URL`, `REDIS_URL`
- Anything starting with `DATABASE_`, `DB_`, `PG_`, `POSTGRES_`, `REDIS_`, `MONGO_`, `KAFKA_`

**Copied as-is from prod** — stateless API keys and shared dev resources:
- `OPENAI_API_KEY`, `SHOPIFY_*`, anything not matched by the blanklist

**Substituted** — any value containing `bot.useddevice.ae` is rewritten to `staging.bot.useddevice.ae` (whole-host match only, won't double-replace `staging.bot.useddevice.ae`).

**Forced** (appended at end of file, last-wins for dotenv parsers):
- `NODE_ENV=production`
- `TELEGRAM_BOT_TOKEN=<from prompt>`
- `TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 24>`

> ⚠️ **Do not point staging at prod data stores.** The blanklist is intentional — the bot detects empty `DATABASE_URL`/`REDIS_URL` and falls back to in-memory storage. Session loss on staging restart is acceptable.

The blanklist is defined in `bin/lib/staging-common.sh` as `ENV_FILTER_PREFIXES`. Add to it if you introduce a new stateful service.

## Teardown

```sh
bin/destroy-staging.sh
```

Stops and destroys the Node.js app, removes `/home/useddevi/staging-alasil-bot` (code, `.env`, logs). **Subdomain is preserved** so the next provision is one command. Use `--yes` to skip the confirmation prompt.

To remove the subdomain itself, do it from cPanel UI → Domains → Remove (UAPI does not expose `delsubdomain`).

## Troubleshooting

**Health check fails after deploy.** The script tails `logs/*.log` and `stderr.log` from the staging app root. SSH in for a deeper look:
```sh
ssh useddevi@bot.useddevice.ae
cd /home/useddevi/staging-alasil-bot
tail -100 logs/*.log
tail -100 stderr.log    # Passenger error log
```

**Subdomain create fails with "domain already exists".** The DomainInfo check missed it (rare). Re-run the script — the existence check should now succeed.

**`cloudlinux-selector create` fails.** Confirm the subdomain is fully provisioned:
```sh
ssh useddevi@bot.useddevice.ae 'uapi --output=json DomainInfo list_domains'
```

**Webhook registration fails with `chat not found` or 401.** Token is wrong. Re-run with `--rotate` and paste the correct token.

**Staging accidentally hitting prod data.** Inspect the staging `.env`:
```sh
ssh useddevi@bot.useddevice.ae 'grep -E "^(DATABASE_|REDIS_|PG_|POSTGRES_)" /home/useddevi/staging-alasil-bot/.env'
```
All matched lines should have empty values. If any are populated, re-run `bin/provision-staging.sh env`.

## Where to look on the server

- Staging app root: `/home/useddevi/staging-alasil-bot`
- Staging nodevenv: `/home/useddevi/nodevenv/staging-alasil-bot/24/bin/{node,npm,activate}`
- App logs: `/home/useddevi/staging-alasil-bot/logs/`
- Passenger stderr: `/home/useddevi/staging-alasil-bot/stderr.log`
- Subdomain config: cPanel UI → Domains → `staging.bot.useddevice.ae`
