import { parseAllowedReviewerIds, parseTelegramUpdate, isReviewerAllowed, MockTelegramClient, RealTelegramClient, type TelegramUpdate, type TelegramWebhookAck } from "@curator/telegram";
import { handleManualIngest, type ManualIngestOptions } from "../handlers/manual-ingest";
import { handleReviewCallback } from "../handlers/review-callback";
import { jsonResponse } from "../http/json";
import { getEffectiveEnv } from "../admin-config/service";
import { handleTelegramOutputCallback } from "../telegram-topic-workflow/callback-orchestrator";
import { resolveTelegramTopicRoute } from "../telegram-topic-workflow/route-resolver";
import { handleTelegramTopicIngest } from "../telegram-topic-workflow/topic-ingest-orchestrator";
import { handleTelegramReviewEditReply } from "../telegram-topic-workflow/review-edit-orchestrator";
import type { Env } from "../types";

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const webhookSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (webhookSecret && request.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return jsonResponse({ ok: false, error: "invalid_webhook_secret" }, { status: 403 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ ok: false, error: "unsupported_media_type" }, { status: 415 });
  }

  const update = await request.json().catch(() => null) as TelegramUpdate | null;
  if (!update || typeof update !== "object") {
    return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseTelegramUpdate(update);
  const updateIdFields = parsed.updateId === undefined ? {} : { receivedUpdateId: parsed.updateId };

  if (parsed.kind === "ignored") {
    return jsonResponse({
      ok: true,
      ...updateIdFields,
      kind: parsed.kind,
      ignoredReason: parsed.reason
    });
  }

  const effectiveEnv = await getEffectiveEnv(env);
  const allowedReviewerIds = parseAllowedReviewerIds(effectiveEnv.TELEGRAM_ALLOWED_REVIEWER_IDS);
  if (!isReviewerAllowed(parsed.reviewerId, allowedReviewerIds)) {
    return jsonResponse({
      ok: false,
      error: "unauthorized_reviewer",
      ...updateIdFields
    }, { status: 403 });
  }

  if (parsed.kind === "output_callback") {
    const callbackResult = await handleTelegramOutputCallback(parsed, effectiveEnv, createCallbackAnswerClient(effectiveEnv));
    return jsonResponse({
      ok: callbackResult.ok,
      ...updateIdFields,
      kind: parsed.kind,
      callbackAction: callbackResult.action,
      generatedOutputId: callbackResult.generatedOutputId,
      callbackResult
    }, { status: callbackResult.ok ? 200 : 404 });
  }

  if (parsed.kind === "manual_message") {
    const editReplyResult = await handleTelegramReviewEditReply({
      env: effectiveEnv,
      parsed,
      telegramClient: createCallbackAnswerClient(effectiveEnv)
    });
    if (editReplyResult !== null) {
      return jsonResponse({
        ok: editReplyResult.ok,
        ...updateIdFields,
        kind: editReplyResult.kind,
        generatedOutputId: editReplyResult.generatedOutputId,
        editReplyResult
      });
    }

    if (parsed.threadId !== undefined) {
      const resolution = await resolveTelegramTopicRoute(effectiveEnv, parsed);
      if (resolution.ok) {
        const topicResult = await handleTelegramTopicIngest({
          env: effectiveEnv,
          parsed,
          route: resolution.routeWithOutputs.route,
          outputs: resolution.routeWithOutputs.outputs
        });
        return jsonResponse({
          ok: true,
          ...updateIdFields,
          kind: parsed.kind,
          itemId: topicResult.itemId,
          topicWorkflow: topicResult
        });
      }

      return jsonResponse({
        ok: true,
        ...updateIdFields,
        kind: "ignored",
        ignoredReason: resolution.reason
      });
    }

    const ingestOptions: ManualIngestOptions = effectiveEnv.TELEGRAM_REVIEW_CHAT_ID === undefined ? {} : {
      reviewChatId: effectiveEnv.TELEGRAM_REVIEW_CHAT_ID
    };
    const result = await handleManualIngest(parsed, effectiveEnv.DB, ingestOptions);

    const body: TelegramWebhookAck & { manualIngest: typeof result } = {
      ok: true,
      ...updateIdFields,
      kind: parsed.kind,
      itemId: result.itemId,
      manualIngest: result
    };

    return jsonResponse(body);
  }

  const callbackResult = await handleReviewCallback(parsed, effectiveEnv.DB);
  const body: TelegramWebhookAck & { callbackResult: typeof callbackResult } = {
    ok: true,
    ...updateIdFields,
    kind: parsed.kind,
    itemId: callbackResult.itemId,
    callbackAction: callbackResult.action,
    callbackResult
  };

  return jsonResponse(body);
}

function createCallbackAnswerClient(env: Env): MockTelegramClient | RealTelegramClient {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (env.TELEGRAM_REAL_REVIEW_ENABLED === "true" && botToken) {
    return new RealTelegramClient({ botToken });
  }
  return new MockTelegramClient();
}
