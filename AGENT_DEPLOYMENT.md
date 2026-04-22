# Agent Deployment Guide

Step-by-step to enable the new LLM tool-calling agent on the cPanel server.

## Pre-flight (1 minute)

```bash
# On your Mac — confirm current state is clean
cd ~/Downloads/ai-support-agent
git status        # should be clean after the push
git log -1        # last commit should be the "feat: LLM tool-calling agent"
```

## Step 1 — Push to GitHub (from Mac)

```bash
cd ~/Downloads/ai-support-agent
git add -A
git commit -m "feat: LLM tool-calling agent behind USE_AGENT flag"
git push origin main
```

## Step 2 — Pull on cPanel server (via SSH)

```bash
# SSH into cPanel
ssh useddevi@useddevice.ae
cd ~/repositories/alasil-bot
git pull origin main
npm install        # in case new deps (none expected)
```

## Step 3 — Flip the feature flag

```bash
# Still on cPanel
nano .env
```

Add (or edit):
```
USE_AGENT=true
AGENT_MAX_ITERATIONS=5
# Optional: use a different model for agent only
# AGENT_MODEL=gpt-4o
```

Save & exit.

## Step 4 — Restart

```bash
# On cPanel
cd ~/repositories/alasil-bot
mkdir -p tmp
touch tmp/restart.txt

# If Passenger/LiteSpeed didn't pick it up:
pkill -9 -f "lsnode.*alasil-bot" || true
# Wait a few seconds, then visit https://bot.useddevice.ae to trigger cold start
```

## Step 5 — Verify

```bash
curl -s https://bot.useddevice.ae/health | jq
# Should show: "agent": { "enabled": true, "model": "gpt-4o-mini", "max_iterations": 5 }

curl -s https://bot.useddevice.ae/agent/stats | jq
# Should show counters at zero right after restart
```

## Step 6 — Telegram test

Send these from your Telegram to the bot:
1. `salam, iphone 17 pro max mikham` — should list products with prices
2. `does UAE iphone have FaceTime?` — should start with "No"
3. `apple watch ultra mojoude?` — should list Apple Watch Ultra 3 variants
4. `JBL speaker` — should list JBL speakers in stock
5. `thanks` — short thank-you reply

Each reply should come back within ~8–15 seconds (first message can be slower due to catalog warm-up).

## Revert (if anything breaks)

```bash
# On cPanel
cd ~/repositories/alasil-bot
nano .env
# set USE_AGENT=false
touch tmp/restart.txt
```

Instant rollback to the legacy pipeline. No code changes needed.

## Monitor (daily)

```bash
# On cPanel — get today's stats
cd ~/repositories/alasil-bot
node scripts/agent-stats.js --today

# Last 20 turns with user message, tools, reply
node scripts/agent-stats.js --tail=20

# Top 10 slow/failed turns
node scripts/agent-stats.js --worst=10
```

## Key metrics to watch

- **Error rate** should be < 5%
- **Max-iter rate** should be < 8% (if high, the prompt/tools need tuning)
- **Zero-result rate per tool** should be < 30% (high means search is missing products)
- **p95 latency** should be < 20 seconds

The alert lines in `agent-stats.js` output tell you exactly which threshold tripped.

## Logs

- `logs/agent.jsonl` — one JSON line per turn (user msg, tool calls, reply, latency)
- `logs/feedback.jsonl` — legacy feedback log (still used)

## Cost

Expect roughly:
- `gpt-4o-mini`: ~$0.02–0.05 per conversation (3–5 tool calls per turn)
- 500 chats/month = ~$10–25/month OpenAI budget

Set a daily cap in https://platform.openai.com/account/limits if concerned.
