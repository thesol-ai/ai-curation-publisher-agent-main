import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, unauthorized } from "./response";
import type { Env } from "../types";

type GeneratedOutputDebugRow = {
  id: string;
  item_id: string;
  route_id: string;
  route_output_id: string;
  language: string;
  status: string;
  prompt_profile: string | null;
  model: string | null;
  output_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type ItemDebugRow = {
  id: string;
  canonical_url: string;
  text: string | null;
  author_handle: string | null;
  provider: string;
  platform: string;
  source_type: string;
  created_at: string;
  updated_at: string;
};

type PromptRunDebugRow = {
  id: string;
  item_id: string | null;
  generated_output_id: string | null;
  prompt_profile_id: string | null;
  status: string;
  model: string | null;
  error_message: string | null;
  created_at: string;
};

export async function handleInternalTelegramOutputDebug(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"], request);

  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  try {
    const url = new URL(request.url);
    const generatedOutputId = url.searchParams.get("generatedOutputId")?.trim() || url.searchParams.get("id")?.trim();

    if (!generatedOutputId) {
      return badRequest("missing_generated_output_id", "Provide generatedOutputId.", request);
    }

    const outputRow = await env.DB.prepare(
      `SELECT id, item_id, route_id, route_output_id, language, status, prompt_profile, model, output_json, error_message, created_at, updated_at
         FROM telegram_generated_outputs
        WHERE id = ?
        LIMIT 1`
    ).bind(generatedOutputId).first<GeneratedOutputDebugRow>();

    if (!outputRow) {
      return jsonResponse({ ok: false, error: "generated_output_not_found", generatedOutputId }, { status: 404 });
    }

    const itemRow = await env.DB.prepare(
      `SELECT id, canonical_url, text, author_handle, provider, platform, source_type, created_at, updated_at
         FROM items
        WHERE id = ?
        LIMIT 1`
    ).bind(outputRow.item_id).first<ItemDebugRow>();

    const promptRun = await env.DB.prepare(
      `SELECT id, item_id, generated_output_id, prompt_profile_id, status, model, error_message, created_at
         FROM prompt_runs
        WHERE generated_output_id = ? OR item_id = ?
        ORDER BY created_at DESC
        LIMIT 1`
    ).bind(outputRow.id, outputRow.item_id).first<PromptRunDebugRow>();

    const parsedOutput = parseJsonObject(outputRow.output_json);
    const sourceAttributionText = readString(parsedOutput, "sourceAttributionText");
    const parsedSourceAttribution = parseJsonObject(sourceAttributionText ?? "");

    return jsonResponse({
      ok: true,
      generatedOutput: {
        id: outputRow.id,
        itemId: outputRow.item_id,
        routeId: outputRow.route_id,
        routeOutputId: outputRow.route_output_id,
        language: outputRow.language,
        status: outputRow.status,
        promptProfile: outputRow.prompt_profile,
        model: outputRow.model,
        errorMessage: outputRow.error_message,
        createdAt: outputRow.created_at,
        updatedAt: outputRow.updated_at,
        output: parsedOutput,
        outputKeys: Object.keys(parsedOutput),
        caption: readString(parsedOutput, "caption"),
        headline: readString(parsedOutput, "headline"),
        summary: readString(parsedOutput, "summary"),
        riskFlags: readArray(parsedOutput, "riskFlags"),
        hashtags: readArray(parsedOutput, "hashtags"),
        sourceAttributionText,
        sourceAttributionDebug: parsedSourceAttribution.debug === true ? parsedSourceAttribution : undefined
      },
      item: itemRow ? {
        id: itemRow.id,
        canonicalUrl: itemRow.canonical_url,
        text: itemRow.text,
        textLength: itemRow.text?.length ?? 0,
        authorHandle: itemRow.author_handle,
        provider: itemRow.provider,
        platform: itemRow.platform,
        sourceType: itemRow.source_type,
        createdAt: itemRow.created_at,
        updatedAt: itemRow.updated_at
      } : undefined,
      promptRun: promptRun ? {
        id: promptRun.id,
        itemId: promptRun.item_id,
        generatedOutputId: promptRun.generated_output_id,
        promptProfileId: promptRun.prompt_profile_id,
        status: promptRun.status,
        model: promptRun.model,
        errorMessage: promptRun.error_message,
        createdAt: promptRun.created_at
      } : undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({
      ok: false,
      error: "telegram_output_debug_failed",
      message: message.slice(0, 500)
    }, { status: 500 });
  }
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  const entry = value[key];
  return typeof entry === "string" ? entry : undefined;
}

function readArray(value: Record<string, unknown>, key: string): unknown[] {
  const entry = value[key];
  return Array.isArray(entry) ? entry : [];
}
