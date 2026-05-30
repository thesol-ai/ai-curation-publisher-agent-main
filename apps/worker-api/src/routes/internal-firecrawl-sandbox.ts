import type { ProviderHttpClient } from "@curator/providers";
import { getEffectiveEnv } from "../admin-config/service";
import { runFirecrawlSandboxFetch, type FirecrawlSandboxFetchInput } from "../operations/firecrawl-sandbox";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { badRequest, methodNotAllowed, parseJsonBody, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

export async function handleInternalFirecrawlSandbox(
  request: Request,
  env: Env,
  rateLimitGuard: RateLimitGuard = new NoopRateLimitGuard(),
  httpClient?: ProviderHttpClient
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

  const parsed = await parseJsonBody<FirecrawlSandboxFetchInput>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  if (typeof parsed.value.url !== "string" || parsed.value.url.trim().length === 0) {
    return badRequest("missing_url", "Request body must include a URL string.", request);
  }

  let url: URL;
  try {
    url = new URL(parsed.value.url);
  } catch {
    return badRequest("invalid_url", "Request body URL must be a valid URL.", request);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return badRequest("invalid_url_protocol", "Request body URL must use http or https.", request);
  }

  const effectiveEnv = await getEffectiveEnv(env);
  const result = await runFirecrawlSandboxFetch({
    env: effectiveEnv,
    input: {
      url: url.toString(),
      ...(parsed.value.limit === undefined ? {} : { limit: parsed.value.limit })
    },
    ...(httpClient === undefined ? {} : { httpClient })
  });

  return jsonResponse(result, { status: result.ok ? 200 : 409 });
}
