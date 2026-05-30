import type { ProviderHttpClient } from "@curator/providers";
import type { TelegramClient } from "@curator/telegram";
import type { WordPressClient } from "@curator/wordpress";
import { getEffectiveEnv } from "../admin-config/service";
import { runControlledRealIntegrationsPilot, type ControlledRealIntegrationsPilotInput } from "../operations/controlled-real-integrations-pilot";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { NoopRateLimitGuard, type RateLimitGuard } from "../security/rate-limit";
import { badRequest, methodNotAllowed, parseJsonBody, tooManyRequests, unauthorized } from "./response";
import type { Env } from "../types";

export type InternalRealIntegrationsPilotDependencies = {
  rateLimitGuard?: RateLimitGuard;
  httpClient?: ProviderHttpClient;
  telegramClient?: TelegramClient;
  wordpressClient?: WordPressClient;
};

export async function handleInternalRealIntegrationsPilot(
  request: Request,
  env: Env,
  dependencies: InternalRealIntegrationsPilotDependencies = {}
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], request);
  }

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return unauthorized(auth.error, "Internal API authorization failed.", request);
  }

  const rateLimit = await (dependencies.rateLimitGuard ?? new NoopRateLimitGuard()).check(request);
  if (!rateLimit.allowed) {
    return tooManyRequests(rateLimit.reason, rateLimit.retryAfterSeconds, request);
  }

  const parsed = await parseJsonBody<ControlledRealIntegrationsPilotInput>(request);
  if (!parsed.ok) {
    return parsed.response;
  }

  const validation = validatePilotInput(parsed.value);
  if (!validation.ok) {
    return badRequest(validation.error, validation.message, request);
  }

  const effectiveEnv = await getEffectiveEnv(env);
  const result = await runControlledRealIntegrationsPilot({
    env: effectiveEnv,
    input: parsed.value,
    ...(dependencies.httpClient === undefined ? {} : { httpClient: dependencies.httpClient }),
    ...(dependencies.telegramClient === undefined ? {} : { telegramClient: dependencies.telegramClient }),
    ...(dependencies.wordpressClient === undefined ? {} : { wordpressClient: dependencies.wordpressClient })
  });

  return jsonResponse(result, { status: result.ok ? 200 : 409 });
}

type PilotInputValidationResult =
  | { ok: true }
  | { ok: false; error: string; message: string };

function validatePilotInput(input: ControlledRealIntegrationsPilotInput): PilotInputValidationResult {
  if (input.runFirecrawl === true) {
    if (typeof input.firecrawlUrl !== "string" || input.firecrawlUrl.trim().length === 0) {
      return { ok: false, error: "missing_firecrawl_url", message: "firecrawlUrl is required when runFirecrawl is true." };
    }

    const urlCheck = validateHttpUrl(input.firecrawlUrl);
    if (!urlCheck.ok) {
      return { ok: false, error: "invalid_firecrawl_url", message: urlCheck.message };
    }
  }

  if (input.sourceUrl !== undefined) {
    const urlCheck = validateHttpUrl(input.sourceUrl);
    if (!urlCheck.ok) {
      return { ok: false, error: "invalid_source_url", message: urlCheck.message };
    }
  }

  return { ok: true };
}

function validateHttpUrl(value: string): PilotInputValidationResult {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "invalid_url_protocol", message: "URL must use http or https." };
    }
  } catch {
    return { ok: false, error: "invalid_url", message: "URL must be valid." };
  }

  return { ok: true };
}
