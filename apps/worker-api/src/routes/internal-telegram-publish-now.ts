import { TelegramPublishQueueRepository } from "@curator/db";
import { jsonResponse } from "../http/json";
import { getEffectiveEnv } from "../admin-config/service";
import { verifyInternalRequest } from "../security/internal-auth";
import { publishTelegramQueueItem } from "../telegram-topic-workflow/publish-runner";
import { buildPublishPreviewForQueueItem } from "../telegram-topic-workflow/publish-inspector";
import { badRequest, methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type PublishNowBody = {
  queueId?: unknown;
  generatedOutputId?: unknown;
};

type EnvWithFinalPublish = Env & {
  TELEGRAM_FINAL_PUBLISH_ENABLED?: string;
};

const MANUAL_PUBLISH_STATUSES = new Set(["pending", "scheduled", "failed"]);

export async function handleInternalTelegramPublishNow(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], request);
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return unauthorized(auth.error, "Internal API authorization failed.", request);
  }

  const parsed = await parseJsonBody<PublishNowBody>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const queueId = readNonEmptyString(parsed.value.queueId);
  const generatedOutputId = readNonEmptyString(parsed.value.generatedOutputId);
  if (!queueId && !generatedOutputId) {
    return badRequest("missing_publish_job", "Provide queueId or generatedOutputId.", request);
  }

  const effectiveEnv = await getEffectiveEnv(env);
  const repository = new TelegramPublishQueueRepository(effectiveEnv.DB);
  const queueItem = queueId
    ? await repository.findById(queueId)
    : await repository.findByGeneratedOutputId(generatedOutputId ?? "");

  if (!queueItem) {
    return badRequest("publish_job_not_found", "No Telegram publish queue row matched the request.", request);
  }

  if (!MANUAL_PUBLISH_STATUSES.has(queueItem.status)) {
    return badRequest(
      "publish_job_not_actionable",
      "Only pending, scheduled, or failed Telegram publish jobs can be published manually.",
      request
    );
  }

  const preview = await buildPublishPreviewForQueueItem(effectiveEnv, queueItem);

  if ((effectiveEnv as EnvWithFinalPublish).TELEGRAM_FINAL_PUBLISH_ENABLED !== "true") {
    return jsonResponse({
      ok: true,
      outcome: "skipped",
      reason: "final_publishing_disabled",
      queueId: queueItem.id,
      generatedOutputId: queueItem.generatedOutputId,
      status: queueItem.status,
      preview
    });
  }

  if (!preview.canPublishNow) {
    return jsonResponse({ ok: false, outcome: "blocked", reason: "publish_preview_blocked", queueId: queueItem.id, generatedOutputId: queueItem.generatedOutputId, status: queueItem.status, preview }, { status: 409 });
  }

  try {
    const result = await publishTelegramQueueItem({ env: effectiveEnv, queueItem });
    return jsonResponse(
      {
        ...result,
        ok: result.ok,
        outcome: result.status,
        manual: true,
        preview
      },
      { status: result.ok ? 200 : 500 }
    );
  } catch (error) {
    return serverError("telegram_publish_now_failed", error instanceof Error ? error.message : "Telegram publish now failed.", request);
  }
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
