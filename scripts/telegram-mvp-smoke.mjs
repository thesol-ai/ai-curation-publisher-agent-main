#!/usr/bin/env node
const required = ["WORKER_BASE_URL", "INTERNAL_API_SECRET", "TEST_REVIEWER_ID", "SOURCE_CHAT_ID", "SOURCE_THREAD_ID", "REVIEW_CHAT_ID", "REVIEW_THREAD_ID", "FINAL_CHAT_ID"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing env: ${missing.join(", ")}`);
  process.exit(1);
}
const base = process.env.WORKER_BASE_URL.replace(/\/$/, "");
const language = process.env.TEST_LANGUAGE || "fa";
const routeId = process.env.TEST_ROUTE_ID || "crypto";
const category = process.env.TEST_CATEGORY || routeId;
const promptProfile = process.env.TEST_PROMPT_PROFILE || `${category}_editorial`;
const route = [{
  id: routeId,
  category,
  sourceChatId: process.env.SOURCE_CHAT_ID,
  sourceThreadId: Number(process.env.SOURCE_THREAD_ID),
  promptProfile,
  enabled: true,
  outputs: [{
    id: `${routeId}_${language}`,
    language,
    reviewChatId: process.env.REVIEW_CHAT_ID,
    reviewThreadId: Number(process.env.REVIEW_THREAD_ID),
    finalChatId: process.env.FINAL_CHAT_ID,
    publishMode: process.env.TEST_PUBLISH_MODE || "scheduled",
    timezone: process.env.TEST_TIMEZONE || "UTC",
    allowedPublishWindows: (process.env.TEST_WINDOWS || "00:00-23:59").split(","),
    minimumGapMinutes: Number(process.env.TEST_MIN_GAP || 10),
    maxPostsPerHour: Number(process.env.TEST_MAX_PER_HOUR || 4),
    maxPostsPerDay: Number(process.env.TEST_MAX_PER_DAY || 24),
    queuePriority: 0,
    enabled: true,
    publishEnabled: true
  }]
}];

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-api-secret": process.env.INTERNAL_API_SECRET,
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => null);
  console.log(path, response.status, JSON.stringify(data, null, 2));
  if (!response.ok) process.exitCode = 1;
  return data;
}

async function telegramWebhook(update) {
  const headers = { "content-type": "application/json" };
  if (process.env.TELEGRAM_WEBHOOK_SECRET) headers["x-telegram-bot-api-secret-token"] = process.env.TELEGRAM_WEBHOOK_SECRET;
  const response = await fetch(`${base}/telegram/webhook`, { method: "POST", headers, body: JSON.stringify(update) });
  const data = await response.json().catch(() => null);
  console.log("/telegram/webhook", response.status, JSON.stringify(data, null, 2));
  if (!response.ok) process.exitCode = 1;
  return data;
}

await request("/internal/telegram/topic-routes/seed", { method: "POST", body: JSON.stringify({ routes: route }) });
await request("/internal/telegram/topic-routes/validate", { method: "POST", body: JSON.stringify({}) });

const messageId = Math.floor(Date.now() / 1000);
const update = {
  update_id: Date.now(),
  message: {
    message_id: messageId,
    message_thread_id: Number(process.env.SOURCE_THREAD_ID),
    from: { id: Number(process.env.TEST_REVIEWER_ID), is_bot: false, first_name: "MVP" },
    chat: { id: process.env.SOURCE_CHAT_ID, type: "supergroup", is_forum: true },
    date: Math.floor(Date.now() / 1000),
    text: process.env.TEST_SOURCE_TEXT || "MVP source test: https://example.com"
  }
};
await telegramWebhook(update);

const recent = await request("/internal/telegram/outputs/recent?limit=10", { method: "GET" });
const output = Array.isArray(recent?.outputs) ? recent.outputs.find((entry) => entry.language === language && entry.category === category) : undefined;
if (!output?.generatedOutputId) {
  console.error("No generated output found for smoke callback step.");
  process.exit(1);
}

if (process.env.TEST_SEND === "true") {
  await telegramWebhook({
    update_id: Date.now() + 1,
    callback_query: {
      id: `smoke-callback-${Date.now()}`,
      from: { id: Number(process.env.TEST_REVIEWER_ID), is_bot: false, first_name: "MVP" },
      message: {
        message_id: messageId + 1,
        message_thread_id: Number(process.env.REVIEW_THREAD_ID),
        chat: { id: process.env.REVIEW_CHAT_ID, type: "supergroup", is_forum: true },
        date: Math.floor(Date.now() / 1000),
        text: "MVP generated review smoke callback"
      },
      data: `tgout:send:${output.generatedOutputId}`
    }
  });
  await request("/internal/telegram/publish/queue?limit=10", { method: "GET" });
}

if (process.env.TEST_RUN_DUE === "true") {
  await request("/internal/telegram/publish/due", { method: "POST", body: JSON.stringify({ limit: Number(process.env.TEST_DUE_LIMIT || 5) }) });
  await request("/internal/telegram/publish/queue?limit=10", { method: "GET" });
}
