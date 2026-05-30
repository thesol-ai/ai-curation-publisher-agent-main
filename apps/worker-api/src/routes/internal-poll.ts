import type { Source } from "@curator/core";
import { runMockPollOperation, type OperationalPollOptions } from "../operations/mock-poll";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { methodNotAllowed, parseJsonBody, serverError, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

type InternalPollRequestBody = {
  sources?: Partial<Source>[];
  options?: OperationalPollOptions;
};

export async function handleInternalPoll(request: Request, env: Env, rateLimitGuard: RateLimitGuard = new NoopRateLimitGuard()): Promise<Response> {
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

  const parsed = await parseJsonBody<InternalPollRequestBody>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const result = await runMockPollOperation({
      env,
      ...(parsed.value.sources === undefined ? {} : { sources: parsed.value.sources }),
      ...(parsed.value.options === undefined ? {} : { options: parsed.value.options })
    });

    return jsonResponse(result);
  } catch (error) {
    return serverError("internal_poll_failed", error instanceof Error ? error.message : "Internal poll failed.", request);
  }
}
