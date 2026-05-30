import { ItemsRepository, OutputsRepository, PublishingService, PublishQueueRepository } from "@curator/db";
import { MockTelegramClient } from "@curator/telegram";
import { readOperationalConfig } from "../config";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { methodNotAllowed, parseJsonBody, serverError, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

type InternalTelegramPublishBody = {
  publishNow?: boolean;
};

export async function handleInternalTelegramPublish(request: Request, env: Env, rateLimitGuard: RateLimitGuard = new NoopRateLimitGuard()): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], request);
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return unauthorized(auth.error, "Internal API authorization failed.", request);
  }

  const rateLimit = await rateLimitGuard.check(request);
  if (!rateLimit.allowed) {
    return tooManyRequests(rateLimit.reason, rateLimit.retryAfterSeconds, request);
  }

  const parsed = await parseJsonBody<InternalTelegramPublishBody>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const config = readOperationalConfig(env);
    const publishingService = PublishingService.fromRepositories({
      queueRepository: new PublishQueueRepository(env.DB),
      outputsRepository: new OutputsRepository(env.DB),
      itemsRepository: new ItemsRepository(env.DB),
      telegramPublisher: new MockTelegramClient()
    });

    const result = await publishingService.publishNextTelegram({
      finalChatId: config.telegram.finalChatId,
      publishNow: parsed.value.publishNow ?? true
    });

    if (result.outcome === "published") {
      return jsonResponse({
        ok: true,
        mockMode: true,
        outcome: result.outcome,
        itemId: result.itemId,
        finalMessageId: result.finalMessageId
      });
    }

    if (result.outcome === "none") {
      return jsonResponse({
        ok: true,
        mockMode: true,
        outcome: result.outcome,
        reason: result.reason
      });
    }

    return jsonResponse({
      ok: false,
      mockMode: true,
      outcome: result.outcome,
      itemId: result.itemId,
      error: result.errorMessage
    }, { status: 500 });
  } catch (error) {
    return serverError("internal_publish_failed", error instanceof Error ? error.message : "Internal publish failed.", request);
  }
}
