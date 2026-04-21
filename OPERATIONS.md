# alAsil Bot — Operations Guide

**Production URL:** https://bot.useddevice.ae
**Server:** useddevi@khaimah (cPanel, 57.129.140.39)
**Repo:** https://github.com/unxvz/alasil-ai-agent
**Telegram bot:** @alasilAi_support_bot
**Webhook:** https://bot.useddevice.ae/webhook/telegram/alasil-2026-xjk82nq4

---

## Dastoorat-e rooz-marreh (daily)

### 1. Bot salamat ast?
```bash
curl -s https://bot.useddevice.ae/health
```
Bayd JSON bedeh ba `"ok":true`. Age hast → bot zende ast.

---

### 2. Restart-e app (har bar taghyir dar code ya .env)

**Rah sade:**
```bash
cd ~/alasil-bot && touch tmp/restart.txt
```

**Ya az cPanel:** Setup Node.js App → alasil-bot → RESTART

---

### 3. Didаn-e log-ha

**Error log (stderr):**
```bash
tail -30 ~/alasil-bot/stderr.log
```

**Passenger log (age error-e jed-i):**
```bash
find ~ -name "*.log" -mmin -60 2>/dev/null
```

---

### 4. Update code az GitHub

Har vaght man code-e jadid push kardam to GitHub:

```bash
cd ~/alasil-bot && git pull
touch ~/alasil-bot/tmp/restart.txt
```

Age `git pull` error dad (conflicting), az `repositories/alasil-bot` sync konid:
```bash
cd ~/repositories/alasil-bot && git pull
rsync -a --exclude=node_modules --exclude=.env ./ ~/alasil-bot/
touch ~/alasil-bot/tmp/restart.txt
```

---

### 5. Npm install (age package.json avaz shod)

```bash
source ~/nodevenv/alasil-bot/24/bin/activate
cd ~/alasil-bot
npm install --omit=dev
touch tmp/restart.txt
```

---

## Telegram webhook

### Check status:
```bash
curl -s "https://api.telegram.org/bot8619733332:AAEcwEzIjK_D-muF4z-DLiPyhSdBcowgzD8/getWebhookInfo"
```

### Reset (age down shod va pending messages sabt shodand):
```bash
curl -s "https://api.telegram.org/bot8619733332:AAEcwEzIjK_D-muF4z-DLiPyhSdBcowgzD8/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://bot.useddevice.ae/webhook/telegram/alasil-2026-xjk82nq4","drop_pending_updates":true}'
```

### Disable (age khasti az ngrok bargardan kon):
```bash
curl -s "https://api.telegram.org/bot8619733332:AAEcwEzIjK_D-muF4z-DLiPyhSdBcowgzD8/deleteWebhook"
```

---

## Control baraye moshtari (dakhele chat)

| Dastoor | Kar |
|---|---|
| `/reset` | Session moshtari paak mishe |
| `/start` | Greeting jadid + reset |
| `/pause` | Bot to oon chat/topic mute beshe |
| `/resume` | Bot dobare javab bedeh |

---

## Env variables (.env file)

Location: `~/alasil-bot/.env`

**Check:**
```bash
cat ~/alasil-bot/.env
```

**Edit:**
```bash
nano ~/alasil-bot/.env
# ya
vim ~/alasil-bot/.env
```

Bad-e edit:
```bash
touch ~/alasil-bot/tmp/restart.txt
```

**Important vars:**
- `OPENAI_API_KEY` — GPT access
- `SHOPIFY_STOREFRONT_TOKEN` — product catalog
- `TELEGRAM_BOT_TOKEN` — bot token
- `TELEGRAM_WEBHOOK_SECRET` — URL secret
- `FEATURE_LIVE_SEARCH=true` — live Shopify search
- `URL_BASE_PATH` — na-lazem age bot roye subdomain-e khodesh-e (bot.useddevice.ae)
- `REDIS_URL` — (optional, session-ha to Redis)

---

## Apple lineup auto-sync

Bot khodesh roozane az apple.com/ae current lineup ra sync mikoneh:
```bash
node ~/alasil-bot/scripts/sync-apple.js
```

File: `~/alasil-bot/config/apple_current_lineup.md`

---

## Redis (optional — age session-ha ra save nakone)

Alan in-memory kar mikoneh (app restart → session paak). Baraye persistence:

1. Signup https://upstash.com (free)
2. Create Redis database
3. Copy URL (e.g., `rediss://default:XYZ@host.upstash.io:6379`)
4. Edit `.env`:
   ```
   REDIS_URL=rediss://default:XYZ@host.upstash.io:6379
   ```
5. Restart app

---

## Emergency commands

### Bot javab nemide:
```bash
curl -s https://bot.useddevice.ae/health  # up?
cat ~/alasil-bot/stderr.log               # errors?
touch ~/alasil-bot/tmp/restart.txt        # force restart
```

### Rollback be version-e ghabli:
```bash
cd ~/alasil-bot
git log --oneline | head -5       # list commits
git checkout v0.1.0-baseline      # bargard
touch tmp/restart.txt
```

### Paak kardan-e hameh session:
```bash
# age Redis nadarid, app-restart kafi e
touch ~/alasil-bot/tmp/restart.txt

# age Redis darid:
redis-cli -u "$REDIS_URL" --scan --pattern "ai-support:session:*" | xargs redis-cli -u "$REDIS_URL" del
```

---

## Deploy taghyirat-e jadid (workflow)

Man roye Mac taghyirat midam → push be GitHub → shoma in dastoor ra bezan:

```bash
cd ~/alasil-bot
git pull
source ~/nodevenv/alasil-bot/24/bin/activate
npm install --omit=dev
touch tmp/restart.txt
sleep 5
curl -s https://bot.useddevice.ae/health
```

Age JSON-e salem dad → update shod. Age na → log ra negah kon.

---

## Zamoone hezyaneh (troubleshoot)

| Moshkel | Hal |
|---|---|
| 503 Service Unavailable | App crashed — `cat ~/alasil-bot/stderr.log` va bezan `touch tmp/restart.txt` |
| "Route not found" from app | Request be app miresad vali route match nashode. URL ra check kon. |
| LiteSpeed 404 | App running nist ya Passenger config kharab ast. cPanel → Node.js App → Restart |
| SSL expired | `uapi SSL start_autossl_check` |
| Telegram webhook 404 | `setWebhook` dobare zan ba URL dorost |
| Shopify search fail | `SHOPIFY_STOREFRONT_TOKEN` check kon |
| OpenAI 401 | `OPENAI_API_KEY` check kon, ya billing limit |

---

## Contact + ownership

- **Owner:** Mohammad (alAsil)
- **Dev:** Claude (via GitHub + chat)
- **Phone (shop):** +971 4 288 5680
- **Emergency:** revoke TELEGRAM_BOT_TOKEN from @BotFather → bot silenced

