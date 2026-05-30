import { TelegramPublishQueueRepository } from "@curator/db";
import { jsonResponse } from "../http/json";
import { publishTelegramQueueItem } from "../telegram-topic-workflow/publish-runner";
import { verifyInternalRequest } from "../security/internal-auth";
import { getEffectiveEnv } from "../admin-config/service";
import { badRequest, methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type RetryBody = {
  queueId?: unknown;
  generatedOutputId?: unknown;
};

type EnvWithFinalPublish = Env & {
  TELEGRAM_FINAL_PUBLISH_ENABLED?: string;
};

export async function handleInternalTelegramPublishRetry(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], request);
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return unauthorized(auth.error, "Internal API authorization failed.", request);
  }

  const parsed = await parseJsonBody<RetryBody>(request);
  if (!parsed.ok) {
    return parsed.response;
  }
  const effectiveEnv = await getEffectiveEnv(env);

  const queueId = readNonEmptyString(parsed.value.queueId);
  const generatedOutputId = readNonEmptyString(parsed.value.generatedOutputId);
  if (!queueId && !generatedOutputId) {
    return badRequest("missing_publish_job", "Provide queueId or generatedOutputId.", request);
  }

  const repository = new TelegramPublishQueueRepository(effectiveEnv.DB);
  const queueItem = queueId ? await repository.findById(queueId) : await repository.findByGeneratedOutputId(generatedOutputId ?? "");
  if (!queueItem) {
    return badRequest("publish_job_not_found", "No Telegram publish queue row matched the request.", request);
  }

  if (queueItem.status !== "failed") {
    return badRequest("publish_job_not_retryable", "Only failed Telegram publish jobs can be retried.", request);
  }

  if ((effectiveEnv as EnvWithFinalPublish).TELEGRAM_FINAL_PUBLISH_ENABLED !== "true") {
    return jsonResponse({
      ok: true,
      outcome: "skipped",
      reason: "final_publishing_disabled",
      queueId: queueItem.id,
      generatedOutputId: queueItem.generatedOutputId,
      status: queueItem.status
    });
  }

  try {
    const result = await publishTelegramQueueItem({ env: effectiveEnv, queueItem });
    return jsonResponse({ ...result, ok: result.ok, outcome: result.status }, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return serverError("telegram_retry_failed", error instanceof Error ? error.message : "Telegram retry failed.", request);
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
