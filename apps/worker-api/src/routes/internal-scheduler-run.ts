import { getEffectiveEnv } from "../admin-config/service";
import { runScheduledPollOperation } from "../operations/scheduled-poll";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { methodNotAllowed, parseJsonBody, serverError, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

type InternalSchedulerRunRequestBody = {
  dryRun?: boolean;
  maxSources?: number;
  maxItems?: number;
};

export async function handleInternalSchedulerRun(
  request: Request,
  env: Env,
  rateLimitGuard: RateLimitGuard = new NoopRateLimitGuard()
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

  const parsed = await parseJsonBody<InternalSchedulerRunRequestBody>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  try {
    const effectiveEnv = await getEffectiveEnv(env);
    const result = await runScheduledPollOperation(effectiveEnv, {
      mode: "manual",
      respectEnabled: false,
      ...(parsed.value.dryRun === undefined ? {} : { dryRun: parsed.value.dryRun }),
      ...(parsed.value.maxSources === undefined ? {} : { maxSources: parsed.value.maxSources }),
      ...(parsed.value.maxItems === undefined ? {} : { maxItems: parsed.value.maxItems })
    });

    return jsonResponse(result);
  } catch (error) {
    return serverError("scheduler_run_failed", error instanceof Error ? error.message : "Scheduler run failed.", request);
  }
}
