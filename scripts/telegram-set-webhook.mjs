#!/usr/bin/env node
const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.env.WORKER_BASE_URL?.replace(/\/$/, "");
if (!token || !base) {
  console.error("Missing TELEGRAM_BOT_TOKEN or WORKER_BASE_URL.");
  process.exit(1);
}
const webhookUrl = `${base}/telegram/webhook`;
const body = {
  url: webhookUrl,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: process.env.TELEGRAM_DROP_PENDING_UPDATES === "true"
};
if (process.env.TELEGRAM_WEBHOOK_SECRET) {
  body.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
}
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});
const data = await response.json().catch(() => null);
console.log(JSON.stringify({ ok: response.ok && data?.ok === true, webhookUrl, telegram: data }, null, 2));
if (!response.ok || data?.ok !== true) process.exit(1);
