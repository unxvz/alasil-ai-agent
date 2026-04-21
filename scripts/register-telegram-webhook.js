import { config } from '../src/config.js';
import { setWebhook, getMe, buildWebhookUrl } from '../src/channels/telegram.js';
import { logger } from '../src/logger.js';

async function main() {
  const publicUrl = process.argv[2] || config.TELEGRAM_PUBLIC_URL;
  if (!publicUrl) {
    console.error('Usage: node scripts/register-telegram-webhook.js <publicUrl>');
    console.error('   or: set TELEGRAM_PUBLIC_URL in .env');
    process.exit(1);
  }
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    process.exit(1);
  }
  const me = await getMe();
  logger.info({ bot: me?.username, id: me?.id }, 'Bot');
  const webhookUrl = buildWebhookUrl(publicUrl);
  logger.info({ webhookUrl }, 'Registering webhook');
  const result = await setWebhook(publicUrl);
  logger.info({ result }, 'Webhook set');
  console.log('Webhook URL:', webhookUrl);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
