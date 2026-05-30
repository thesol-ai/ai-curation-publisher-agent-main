import { runE2EMockPipeline } from "../operations/e2e-mock-pipeline";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { methodNotAllowed, serverError, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

export async function handleInternalE2EMockPipeline(request: Request, env: Env, rateLimitGuard: RateLimitGuard = new NoopRateLimitGuard()): Promise<Response> {
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

  try {
    const result = await runE2EMockPipeline();
    return jsonResponse(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return serverError("e2e_mock_pipeline_failed", error instanceof Error ? error.message : "E2E mock pipeline failed.", request);
  }
}
