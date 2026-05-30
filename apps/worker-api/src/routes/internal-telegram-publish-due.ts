import { runTelegramPublishDueOperation } from "../operations/telegram-publish-due";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { getEffectiveEnv } from "../admin-config/service";
import { methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type PublishDueRequest = { limit?: unknown };

export async function handleInternalTelegramPublishDue(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"], request);
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  const parsed = await parseJsonBody<PublishDueRequest>(request);
  if (!parsed.ok) return parsed.response;
  try {
    const limit = typeof parsed.value.limit === "number" && Number.isFinite(parsed.value.limit) ? parsed.value.limit : undefined;
    const effectiveEnv = await getEffectiveEnv(env);
    const result = await runTelegramPublishDueOperation(effectiveEnv, limit === undefined ? {} : { limit });
    return jsonResponse(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return serverError("telegram_publish_due_failed", error instanceof Error ? error.message : "Telegram due publish failed.", request);
  }
}
