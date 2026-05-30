import { GeminiGenerateContentProvider, MockAIProvider, OpenAIChatCompletionsProvider, CustomJsonAIProvider } from "@curator/ai";
import { getEffectiveEnv } from "../admin-config/service";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type AiTestBody = { provider?: unknown; model?: unknown; prompt?: unknown; runReal?: unknown };
type ProviderTestBody = { provider?: unknown; runNetwork?: unknown; url?: unknown };
type TelegramTestBody = { kind?: unknown; chatId?: unknown; threadId?: unknown };

type EnvWithTests = Env & Record<string, string | undefined>;

export async function handleInternalAdminTests(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);
  if (request.method !== "POST") return methodNotAllowed(["POST"], request);

  const url = new URL(request.url);
  if (url.pathname === "/internal/admin/ai/test") return handleAiTest(request, env);
  if (url.pathname === "/internal/admin/providers/test") return handleProviderTest(request, env);
  if (url.pathname === "/internal/admin/telegram/test") return handleTelegramTest(request, env);
  return methodNotAllowed(["POST"], request);
}

async function handleAiTest(request: Request, env: Env): Promise<Response> {
  const parsed = await parseJsonBody<AiTestBody>(request);
  if (!parsed.ok) return parsed.response;
  const effectiveEnv = await getEffectiveEnv(env) as EnvWithTests;
  const providerId = readString(parsed.value.provider) ?? effectiveEnv.AI_PROVIDER ?? "mock";
  const model = readString(parsed.value.model) ?? effectiveEnv.AI_MODEL ?? (providerId === "gemini" ? "gemini-2.0-flash" : providerId === "openai" ? "gpt-4o-mini" : "mock");
  const prompt = readString(parsed.value.prompt) ?? "Return JSON with ok=true and message='سلام'.";
  const runReal = parsed.value.runReal === true;

  if (providerId === "mock") {
    const provider = new MockAIProvider();
    const response = await provider.generate({ promptId: "admin_ai_test", promptVersion: "1", target: "telegram", model: "mock", messages: [{ role: "system", content: "Return a safe mock Telegram JSON object." }, { role: "user", content: prompt }], temperature: 0.2, maxTokens: 300, outputSchemaRef: "telegram_structured_output_v1" });
    return jsonResponse({ ok: true, provider: "mock", model: response.model, mode: "mock", message: "Mock AI test completed without external calls.", sample: safeText(response.rawText) });
  }

  const credential = providerId === "openai"
    ? effectiveEnv.OPENAI_API_KEY ?? effectiveEnv.AI_API_KEY
    : providerId === "gemini"
      ? effectiveEnv.GEMINI_API_KEY ?? effectiveEnv.AI_API_KEY
      : providerId === "custom"
        ? effectiveEnv.CUSTOM_AI_API_KEY ?? effectiveEnv.AI_API_KEY
        : undefined;

  if (!credential) {
    return jsonResponse({ ok: false, provider: providerId, model, configured: false, message: `${providerId} credential is missing. Save the provider API key before running a live test.` }, { status: 400 });
  }

  if (!runReal) {
    return jsonResponse({ ok: true, provider: providerId, model, configured: true, liveCallSkipped: true, message: "Credential is configured. Set runReal=true to perform a live provider call." });
  }

  try {
    const provider = providerId === "openai"
      ? new OpenAIChatCompletionsProvider({ apiKey: credential, model })
      : providerId === "gemini"
        ? new GeminiGenerateContentProvider({ apiKey: credential, model })
        : new CustomJsonAIProvider({ apiKey: credential, model });
    const response = await provider.generate({ promptId: "admin_ai_test", promptVersion: "1", target: "telegram", model, messages: [{ role: "system", content: "Return a compact JSON object. Do not include secrets." }, { role: "user", content: prompt }], temperature: 0.2, maxTokens: 300, outputSchemaRef: "json_object" });
    return jsonResponse({ ok: true, provider: providerId, model: response.model, liveCall: true, inputTokens: response.inputTokens, outputTokens: response.outputTokens, sample: safeText(response.rawText) });
  } catch (error) {
    return jsonResponse({ ok: false, provider: providerId, model, liveCall: true, message: safeError(error) }, { status: 502 });
  }
}

async function handleProviderTest(request: Request, env: Env): Promise<Response> {
  const parsed = await parseJsonBody<ProviderTestBody>(request);
  if (!parsed.ok) return parsed.response;
  const effectiveEnv = await getEffectiveEnv(env) as EnvWithTests;
  const provider = readString(parsed.value.provider);
  if (!provider) return badRequest("provider_missing", "Provide provider: firecrawl, apify, getxapi, or mock.", request);

  if (provider === "mock") return jsonResponse({ ok: true, provider, mode: "mock", message: "Mock provider is always available for safe tests." });

  const credentialKey = provider === "firecrawl" ? "FIRECRAWL_API_KEY" : provider === "apify" ? "APIFY_TOKEN" : provider === "getxapi" ? "GETXAPI_KEY" : undefined;
  if (!credentialKey) return badRequest("unknown_provider", "Supported providers are firecrawl, apify, getxapi, and mock.", request);
  const configured = Boolean(effectiveEnv[credentialKey]);
  if (!configured) return jsonResponse({ ok: false, provider, configured: false, credentialKey, message: `${credentialKey} is missing.` }, { status: 400 });

  if (parsed.value.runNetwork !== true) {
    return jsonResponse({ ok: true, provider, configured: true, credentialKey, liveCallSkipped: true, message: "Credential is configured. Set runNetwork=true for a provider-specific live test where supported." });
  }

  if (provider === "firecrawl") {
    const targetUrl = readString(parsed.value.url) ?? "https://example.com";
    try {
      const endpoint = effectiveEnv.FIRECRAWL_BASE_URL ?? "https://api.firecrawl.dev/v1/scrape";
      const response = await fetch(endpoint, { method: "POST", headers: { "authorization": `Bearer ${effectiveEnv.FIRECRAWL_API_KEY ?? ""}`, "content-type": "application/json" }, body: JSON.stringify({ url: targetUrl, formats: ["markdown"], onlyMainContent: true }) });
      const text = await response.text().catch(() => "");
      return jsonResponse({ ok: response.ok, provider, configured: true, status: response.status, sample: safeText(text), message: response.ok ? "Firecrawl live test completed." : "Firecrawl live test failed." }, { status: response.ok ? 200 : 502 });
    } catch (error) {
      return serverError("provider_test_failed", safeError(error), request);
    }
  }

  const explicitUrl = readString(parsed.value.url);
  if (!explicitUrl) {
    return jsonResponse({ ok: true, provider, configured: true, credentialKey, liveCallSkipped: true, message: "Credential readiness passed. Provide url in the request body to run a provider-specific live HTTP probe for this provider." });
  }

  try {
    const token = effectiveEnv[credentialKey] ?? "";
    const response = await fetch(explicitUrl, { method: "GET", headers: { "authorization": `Bearer ${token}`, "accept": "application/json" } });
    const text = await response.text().catch(() => "");
    return jsonResponse({ ok: response.ok, provider, configured: true, credentialKey, status: response.status, sample: safeText(text), message: response.ok ? `${provider} live HTTP probe completed.` : `${provider} live HTTP probe failed.` }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return serverError("provider_test_failed", safeError(error), request);
  }
}

async function handleTelegramTest(request: Request, env: Env): Promise<Response> {
  const parsed = await parseJsonBody<TelegramTestBody>(request);
  if (!parsed.ok) return parsed.response;
  const effectiveEnv = await getEffectiveEnv(env) as EnvWithTests;
  const botToken = effectiveEnv.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) return jsonResponse({ ok: false, configured: false, message: "TELEGRAM_BOT_TOKEN is missing." }, { status: 400 });
  const kind = readString(parsed.value.kind) ?? "bot";

  try {
    if (kind === "bot") {
      const payload = await callTelegram(botToken, "getMe", {});
      return jsonResponse({ ok: true, kind, result: sanitizeTelegramResult(payload), message: "Telegram bot token is valid." });
    }
    if (kind === "chat_action") {
      const chatId = readString(parsed.value.chatId);
      if (!chatId) return badRequest("chat_id_missing", "Provide chatId for chat_action test.", request);
      const threadId = readInteger(parsed.value.threadId);
      const payload = await callTelegram(botToken, "sendChatAction", { chat_id: chatId, action: "typing", ...(threadId === undefined ? {} : { message_thread_id: threadId }) });
      return jsonResponse({ ok: true, kind, chatId, threadId, result: sanitizeTelegramResult(payload), message: "Telegram chat action succeeded. The bot can reach this chat/topic." });
    }
    return badRequest("unknown_telegram_test", "Supported Telegram tests are bot and chat_action.", request);
  } catch (error) {
    return jsonResponse({ ok: false, kind, message: safeError(error) }, { status: 502 });
  }
}

async function callTelegram(botToken: string, method: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as { ok?: unknown; result?: unknown; description?: unknown } | null;
  if (!response.ok || payload?.ok !== true) throw new Error(typeof payload?.description === "string" ? payload.description : `Telegram API failed with HTTP ${response.status}.`);
  return payload.result;
}

function sanitizeTelegramResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const copy = { ...value };
  delete copy.token;
  return copy;
}

function readString(value: unknown): string | undefined { return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined; }
function readInteger(value: unknown): number | undefined { const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN; return Number.isInteger(number) ? number : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeText(value: unknown): string { return (typeof value === "string" ? value : JSON.stringify(value)).replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]").slice(0, 800); }
function safeError(error: unknown): string { return error instanceof Error ? safeText(error.message) : "Test failed."; }
