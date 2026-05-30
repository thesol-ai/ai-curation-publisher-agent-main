import type { TelegramClient } from "@curator/telegram";
import { getEffectiveEnv } from "../admin-config/service";
import { runTelegramReviewDryRun, type TelegramReviewDryRunInput } from "../operations/telegram-review-dry-run";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { badRequest, methodNotAllowed, parseJsonBody, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

export async function handleInternalTelegramReviewDryRun(
  request: Request,
  env: Env,
  rateLimitGuard: RateLimitGuard = new NoopRateLimitGuard(),
  client?: TelegramClient
): Promise<Response> {
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

  const parsed = await parseJsonBody<TelegramReviewDryRunInput>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  if (typeof parsed.value.text !== "string" || parsed.value.text.trim().length === 0) {
    return badRequest("missing_text", "Request body must include review text.", request);
  }

  if (parsed.value.sourceUrl !== undefined) {
    try {
      const parsedUrl = new URL(parsed.value.sourceUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return badRequest("invalid_source_url", "sourceUrl must use http or https.", request);
      }
    } catch {
      return badRequest("invalid_source_url", "sourceUrl must be a valid URL.", request);
    }
  }

  const effectiveEnv = await getEffectiveEnv(env);
  const result = await runTelegramReviewDryRun({
    env: effectiveEnv,
    input: {
      text: parsed.value.text,
      ...(parsed.value.sourceUrl === undefined ? {} : { sourceUrl: parsed.value.sourceUrl })
    },
    ...(client === undefined ? {} : { client })
  });

  return jsonResponse(result, { status: result.ok ? 200 : 409 });
}
