import { getEffectiveEnv } from "../admin-config/service";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { buildPublishPreview } from "../telegram-topic-workflow/publish-inspector";
import { badRequest, methodNotAllowed, parseJsonBody, unauthorized } from "./response";
import type { Env } from "../types";

type PublishPreviewBody = {
  queueId?: unknown;
  generatedOutputId?: unknown;
};

export async function handleInternalTelegramPublishPreview(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"], request);
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  const parsed = await parseJsonBody<PublishPreviewBody>(request);
  if (!parsed.ok) return parsed.response;
  const queueId = readString(parsed.value.queueId);
  const generatedOutputId = readString(parsed.value.generatedOutputId);
  if (!queueId && !generatedOutputId) return badRequest("missing_publish_preview_target", "Provide queueId or generatedOutputId.", request);
  const effectiveEnv = await getEffectiveEnv(env);
  const preview = await buildPublishPreview(effectiveEnv, { ...(queueId === undefined ? {} : { queueId }), ...(generatedOutputId === undefined ? {} : { generatedOutputId }) });
  if (!preview) return badRequest("publish_preview_not_found", "No publish queue row matched the request.", request);
  return jsonResponse({ ok: true, preview });
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
