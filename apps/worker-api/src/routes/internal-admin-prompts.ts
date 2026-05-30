import { PromptProfilesRepository, type PromptProfileStatus, type UpsertPromptBindingInput, type UpsertPromptProfileInput } from "@curator/db";
import { DEFAULT_TELEGRAM_PROMPT, renderTemplate } from "@curator/ai";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, unauthorized } from "./response";
import type { Env } from "../types";

type PromptProfileBody = Partial<UpsertPromptProfileInput> & Record<string, unknown>;
type PromptBindingBody = Partial<UpsertPromptBindingInput> & Record<string, unknown>;
type PromptPreviewBody = { systemPrompt?: unknown; userPromptTemplate?: unknown; values?: unknown; promptProfileId?: unknown; promptVersion?: unknown; model?: unknown; provider?: unknown };

export async function handleInternalAdminPrompts(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  const url = new URL(request.url);
  const path = url.pathname;
  const repository = new PromptProfilesRepository(env.DB);

  if (path === "/internal/admin/prompts" && request.method === "GET") {
    const status = normalizeStatus(url.searchParams.get("status") ?? undefined);
    try {
      const profiles = await repository.listProfiles(status);
      const bindings = await repository.listBindings();
      const recentRuns = await repository.listRuns(readLimit(url.searchParams.get("runsLimit"), 25), url.searchParams.get("promptProfileId") ?? undefined);
      return jsonResponse({ ok: true, promptStore: { available: true }, profiles, bindings, recentRuns, templateVariables: TEMPLATE_VARIABLES, defaultPrompt: DEFAULT_TELEGRAM_PROMPT });
    } catch {
      return jsonResponse({ ok: true, promptStore: { available: false, warning: "Prompt Studio tables are missing or inaccessible. Apply D1 migrations before editing prompts." }, profiles: [], bindings: [], recentRuns: [], templateVariables: TEMPLATE_VARIABLES, defaultPrompt: DEFAULT_TELEGRAM_PROMPT });
    }
  }

  if (path === "/internal/admin/prompts" && request.method === "POST") {
    const parsed = await parseJsonBody<PromptProfileBody>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizePromptProfileBody(parsed.value, request);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    const profile = await repository.upsertProfile(normalized.profile);
    return jsonResponse({ ok: true, profile });
  }

  if (path === "/internal/admin/prompts/bindings" && request.method === "GET") {
    try {
      return jsonResponse({ ok: true, promptStore: { available: true }, bindings: await repository.listBindings() });
    } catch {
      return jsonResponse({ ok: true, promptStore: { available: false, warning: "Prompt Studio tables are missing or inaccessible. Apply D1 migrations before editing prompts." }, bindings: [] });
    }
  }

  if (path === "/internal/admin/prompts/runs" && request.method === "GET") {
    try {
      const profileId = url.searchParams.get("promptProfileId") ?? undefined;
      const runs = await repository.listRuns(readLimit(url.searchParams.get("limit"), 50), profileId);
      return jsonResponse({ ok: true, promptStore: { available: true }, runs });
    } catch {
      return jsonResponse({ ok: true, promptStore: { available: false, warning: "Prompt run history table is missing or inaccessible." }, runs: [] });
    }
  }

  if (path === "/internal/admin/prompts/bindings" && request.method === "POST") {
    const parsed = await parseJsonBody<PromptBindingBody>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizePromptBindingBody(parsed.value, request);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    const binding = await repository.upsertBinding(normalized.binding);
    return jsonResponse({ ok: true, binding });
  }

  if (path === "/internal/admin/prompts/preview" && request.method === "POST") {
    const parsed = await parseJsonBody<PromptPreviewBody>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizePreviewBody(parsed.value);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    try {
      await repository.createRun({
        promptProfileId: readString(parsed.value.promptProfileId) ?? "preview",
        promptVersion: readString(parsed.value.promptVersion) ?? "preview",
        model: readString(parsed.value.model) ?? "preview",
        provider: readString(parsed.value.provider) ?? "dashboard",
        renderedPromptHash: stableHash(`${normalized.preview.systemMessage}\n${normalized.preview.userMessage}`),
        status: "previewed"
      });
    } catch {}
    return jsonResponse({ ok: true, preview: normalized.preview });
  }

  const profileMatch = path.match(/^\/internal\/admin\/prompts\/([^/]+)(?:\/(activate|archive))?$/);
  if (profileMatch) {
    const profileId = decodeURIComponent(profileMatch[1] ?? "");
    const action = profileMatch[2];
    if (action === undefined && request.method === "PUT") {
      const existing = await repository.findProfileById(profileId);
      if (!existing) return badRequest("prompt_profile_not_found", "Prompt profile was not found.", request);
      const parsed = await parseJsonBody<PromptProfileBody>(request);
      if (!parsed.ok) return parsed.response;
      const normalized = normalizePromptProfileBody({ ...existing, ...parsed.value, id: profileId }, request);
      if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
      const profile = await repository.upsertProfile(normalized.profile);
      return jsonResponse({ ok: true, profile });
    }
    if (action === "activate" && request.method === "POST") {
      const profile = await repository.setProfileStatus(profileId, "active", readAdminUser(request));
      if (!profile) return badRequest("prompt_profile_not_found", "Prompt profile was not found.", request);
      return jsonResponse({ ok: true, profile });
    }
    if (action === "archive" && request.method === "POST") {
      const profile = await repository.setProfileStatus(profileId, "archived", readAdminUser(request));
      if (!profile) return badRequest("prompt_profile_not_found", "Prompt profile was not found.", request);
      return jsonResponse({ ok: true, profile });
    }
    return methodNotAllowed(action === undefined ? ["PUT"] : ["POST"], request);
  }

  return methodNotAllowed(["GET", "POST", "PUT"], request);
}

const TEMPLATE_VARIABLES = [
  "category",
  "language",
  "sourceText",
  "sourceUrl",
  "canonicalUrl",
  "authorHandle",
  "links",
  "mediaCount",
  "contentType",
  "tonePreset",
  "channelSignature",
  "targetAudience",
  "riskPolicy",
  "hashtagPolicy",
  "sourceAttributionText"
];

function readLimit(value: string | null, fallback: number): number {
  if (value === null || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 100)) : fallback;
}

function normalizePromptProfileBody(body: PromptProfileBody, request: Request): { ok: true; profile: UpsertPromptProfileInput } | { ok: false; error: string; message: string } {
  const id = readString(body.id);
  const name = readString(body.name);
  const systemPrompt = readString(body.systemPrompt);
  const userPromptTemplate = readString(body.userPromptTemplate);
  if (!id || !name || !systemPrompt || !userPromptTemplate) return { ok: false, error: "invalid_prompt_profile", message: "Prompt profile requires id, name, systemPrompt, and userPromptTemplate." };
  return {
    ok: true,
    profile: {
      id,
      name,
      ...(readString(body.category) === undefined ? {} : { category: readString(body.category)! }),
      ...(readString(body.language) === undefined ? {} : { language: readString(body.language)! }),
      ...(readString(body.contentType) === undefined ? {} : { contentType: readString(body.contentType)! }),
      ...(readString(body.outputTarget) === undefined ? {} : { outputTarget: readString(body.outputTarget)! }),
      ...(readString(body.version) === undefined ? {} : { version: readString(body.version)! }),
      ...(normalizeStatus(readString(body.status)) === undefined ? {} : { status: normalizeStatus(readString(body.status))! }),
      systemPrompt,
      userPromptTemplate,
      ...(readString(body.outputSchemaRef) === undefined ? {} : { outputSchemaRef: readString(body.outputSchemaRef)! }),
      ...(readString(body.modelHint) === undefined ? {} : { modelHint: readString(body.modelHint)! }),
      ...(readNumber(body.temperature) === undefined ? {} : { temperature: readNumber(body.temperature)! }),
      ...(readInteger(body.maxTokens) === undefined ? {} : { maxTokens: readInteger(body.maxTokens)! }),
      ...(readString(body.riskPolicy) === undefined ? {} : { riskPolicy: readString(body.riskPolicy)! }),
      ...(readString(body.styleGuide) === undefined ? {} : { styleGuide: readString(body.styleGuide)! }),
      ...(readString(body.negativePrompt) === undefined ? {} : { negativePrompt: readString(body.negativePrompt)! }),
      updatedBy: readAdminUser(request)
    }
  };
}

function normalizePromptBindingBody(body: PromptBindingBody, request: Request): { ok: true; binding: UpsertPromptBindingInput } | { ok: false; error: string; message: string } {
  const promptProfileId = readString(body.promptProfileId);
  if (!promptProfileId) return { ok: false, error: "invalid_prompt_binding", message: "Prompt binding requires promptProfileId." };
  return {
    ok: true,
    binding: {
      ...(readString(body.id) === undefined ? {} : { id: readString(body.id)! }),
      ...(readString(body.routeId) === undefined ? {} : { routeId: readString(body.routeId)! }),
      ...(readString(body.routeOutputId) === undefined ? {} : { routeOutputId: readString(body.routeOutputId)! }),
      ...(readString(body.category) === undefined ? {} : { category: readString(body.category)! }),
      ...(readString(body.language) === undefined ? {} : { language: readString(body.language)! }),
      ...(readString(body.contentType) === undefined ? {} : { contentType: readString(body.contentType)! }),
      promptProfileId,
      ...(readString(body.promptVersion) === undefined ? {} : { promptVersion: readString(body.promptVersion)! }),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      updatedBy: readAdminUser(request)
    }
  };
}

function normalizePreviewBody(body: PromptPreviewBody): { ok: true; preview: { systemMessage: string; userMessage: string; variables: string[] } } | { ok: false; error: string; message: string } {
  const systemPrompt = readString(body.systemPrompt) ?? DEFAULT_TELEGRAM_PROMPT.systemPrompt;
  const userPromptTemplate = readString(body.userPromptTemplate) ?? DEFAULT_TELEGRAM_PROMPT.userPromptTemplate;
  const values = isRecord(body.values) ? Object.fromEntries(Object.entries(body.values).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])) : sampleTemplateValues();
  return { ok: true, preview: { systemMessage: systemPrompt, userMessage: renderTemplate(userPromptTemplate, values), variables: TEMPLATE_VARIABLES } };
}

function sampleTemplateValues(): Record<string, string> {
  return {
    category: "crypto",
    language: "fa",
    sourceText: "Sample source text for an operator prompt test.",
    sourceUrl: "https://example.com/source",
    canonicalUrl: "https://example.com/source",
    authorHandle: "@source",
    links: "https://example.com/source",
    mediaCount: "1",
    contentType: "social_post",
    tonePreset: "editorial",
    channelSignature: "@channel",
    targetAudience: "Telegram subscribers",
    riskPolicy: "Do not invent claims or financial advice.",
    hashtagPolicy: "Use up to 3 relevant hashtags.",
    sourceAttributionText: "Source: https://example.com/source"
  };
}

function normalizeStatus(value: string | undefined): PromptProfileStatus | undefined {
  return value === "draft" || value === "active" || value === "archived" ? value : undefined;
}

function readAdminUser(request: Request): string {
  return request.headers.get("x-admin-user") ?? "dashboard";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function readInteger(value: unknown): number | undefined {
  const parsed = readNumber(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
