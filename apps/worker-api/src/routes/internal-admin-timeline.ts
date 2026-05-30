import { getEffectiveEnv } from "../admin-config/service";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { buildItemTimeline } from "../telegram-topic-workflow/publish-inspector";
import { badRequest, methodNotAllowed, unauthorized } from "./response";
import type { Env } from "../types";

export async function handleInternalAdminTimeline(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"], request);
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  const url = new URL(request.url);
  const itemId = readString(url.searchParams.get("itemId"));
  const generatedOutputId = readString(url.searchParams.get("generatedOutputId"));
  const queueId = readString(url.searchParams.get("queueId"));
  const sourceUrl = readString(url.searchParams.get("sourceUrl"));
  if (!itemId && !generatedOutputId && !queueId && !sourceUrl) return badRequest("timeline_target_missing", "Provide itemId, generatedOutputId, queueId, or sourceUrl.", request);
  const effectiveEnv = await getEffectiveEnv(env);
  const timeline = await buildItemTimeline(effectiveEnv, { ...(itemId === undefined ? {} : { itemId }), ...(generatedOutputId === undefined ? {} : { generatedOutputId }), ...(queueId === undefined ? {} : { queueId }), ...(sourceUrl === undefined ? {} : { sourceUrl }) });
  return jsonResponse(timeline);
}

function readString(value: string | null): string | undefined {
  return value !== null && value.trim().length > 0 ? value.trim() : undefined;
}
