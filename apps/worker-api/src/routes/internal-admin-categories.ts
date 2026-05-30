import { PromptProfilesRepository, TelegramRoutesRepository, type PromptProfileRecord, type PromptBindingRecord, type TelegramRouteOutputRecord, type TelegramRouteRecord, type UpsertTelegramRouteOutputInput } from "@curator/db";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, unauthorized } from "./response";
import type { Env } from "../types";

type PromptPayload = {
  systemPrompt?: unknown;
  userPromptTemplate?: unknown;
  negativePrompt?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  riskPolicy?: unknown;
  styleGuide?: unknown;
};

type WizardLanguagePayload = {
  language?: unknown;
  reviewChatId?: unknown;
  reviewThreadId?: unknown;
  finalChatId?: unknown;
  finalThreadId?: unknown;
  publishMode?: unknown;
  timezone?: unknown;
  minimumGapMinutes?: unknown;
  maxPostsPerHour?: unknown;
  maxPostsPerDay?: unknown;
  queuePriority?: unknown;
  signatureEnabled?: unknown;
  signatureText?: unknown;
  signatureChannelHandle?: unknown;
  prompt?: PromptPayload;
};

type CreateCategoryPayload = {
  category?: unknown;
  label?: unknown;
  source?: { chatId?: unknown; threadId?: unknown };
  promptProfile?: unknown;
  languages?: WizardLanguagePayload[];
};

type AddLanguagePayload = {
  language?: unknown;
  reviewChatId?: unknown;
  reviewThreadId?: unknown;
  finalChatId?: unknown;
  finalThreadId?: unknown;
  prompt?: PromptPayload;
  publishMode?: unknown;
  timezone?: unknown;
  minimumGapMinutes?: unknown;
  maxPostsPerHour?: unknown;
  maxPostsPerDay?: unknown;
  queuePriority?: unknown;
  signatureEnabled?: unknown;
  signatureText?: unknown;
  signatureChannelHandle?: unknown;
};

type PromptMapPayload = {
  category?: unknown;
  language?: unknown;
  routeId?: unknown;
  routeOutputId?: unknown;
  contentType?: unknown;
  prompt?: PromptPayload;
};


type NormalizedCreateCategory = {
  category: string;
  label: string;
  source: { chatId: string; threadId: number };
  promptProfile: string;
  languages: NormalizedLanguage[];
};

type NormalizedLanguage = {
  language: string;
  reviewChatId: string;
  reviewThreadId: number;
  finalChatId: string;
  finalThreadId?: number;
  publishMode: "immediate" | "scheduled" | "queued";
  timezone: string;
  minimumGapMinutes: number;
  maxPostsPerHour: number;
  maxPostsPerDay: number;
  queuePriority: number;
  signatureEnabled: boolean;
  signatureText?: string;
  signatureChannelHandle?: string;
  prompt: NormalizedPrompt;
};

type NormalizedPrompt = {
  systemPrompt: string;
  userPromptTemplate: string;
  negativePrompt?: string;
  temperature: number;
  maxTokens: number;
  riskPolicy?: string;
  styleGuide?: string;
};

export async function handleInternalAdminCategories(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  const url = new URL(request.url);
  const routesRepository = new TelegramRoutesRepository(env.DB);
  const promptsRepository = new PromptProfilesRepository(env.DB);

  if (url.pathname === "/internal/admin/categories" && request.method === "GET") {
    return jsonResponse(await buildCategoryOverview(routesRepository, promptsRepository));
  }

  if (url.pathname === "/internal/admin/categories/preview" && request.method === "POST") {
    const parsed = await parseJsonBody<CreateCategoryPayload>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizeCreateCategoryPayload(parsed.value);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    return jsonResponse({ ok: true, preview: buildCreatePreview(normalized.value) });
  }

  if (url.pathname === "/internal/admin/categories/create" && request.method === "POST") {
    const parsed = await parseJsonBody<CreateCategoryPayload>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizeCreateCategoryPayload(parsed.value);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    const result = await createCategory(routesRepository, promptsRepository, normalized.value, readAdminUser(request));
    return jsonResponse({ ok: true, ...result, overview: await buildCategoryOverview(routesRepository, promptsRepository) });
  }

  const addLanguageMatch = url.pathname.match(/^\/internal\/admin\/categories\/([^/]+)\/add-language$/);
  if (addLanguageMatch && request.method === "POST") {
    const category = decodeURIComponent(addLanguageMatch[1] ?? "");
    const parsed = await parseJsonBody<AddLanguagePayload>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizeAddLanguagePayload(category, parsed.value);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    const routes = await routesRepository.listRoutes();
    const route = routes.find((entry) => entry.category === category || entry.id === category);
    if (!route) return badRequest("category_route_missing", `No route found for category ${category}. Create the category route first.`, request);
    const result = await createLanguageOutput(routesRepository, promptsRepository, route, normalized.language, readAdminUser(request));
    return jsonResponse({ ok: true, category, created: result, overview: await buildCategoryOverview(routesRepository, promptsRepository) });
  }

  if (url.pathname === "/internal/admin/prompt-map" && request.method === "GET") {
    return jsonResponse(await buildPromptMap(routesRepository, promptsRepository));
  }

  if ((url.pathname === "/internal/admin/prompt-map" || url.pathname === "/internal/admin/prompt-map/upsert") && request.method === "POST") {
    const parsed = await parseJsonBody<PromptMapPayload>(request);
    if (!parsed.ok) return parsed.response;
    const normalized = await normalizePromptMapPayload(routesRepository, parsed.value);
    if (!normalized.ok) return badRequest(normalized.error, normalized.message, request);
    const profile = await upsertPromptForOutput(promptsRepository, normalized.value, readAdminUser(request));
    return jsonResponse({ ok: true, ...profile, promptMap: await buildPromptMap(routesRepository, promptsRepository) });
  }

  return methodNotAllowed(["GET", "POST"], request);
}

async function buildCategoryOverview(routesRepository: TelegramRoutesRepository, promptsRepository: PromptProfilesRepository): Promise<Record<string, unknown>> {
  const routes = await routesRepository.listRoutes();
  const outputs = await routesRepository.listOutputs();
  const profiles = await safeProfiles(promptsRepository);
  const bindings = await safeBindings(promptsRepository);
  const topicSuggestions = buildTopicSuggestions(routes, outputs);
  const categories = routes.map((route) => {
    const routeOutputs = outputs.filter((output) => output.routeId === route.id);
    return {
      id: route.category,
      category: route.category,
      routeId: route.id,
      source: { chatId: route.sourceChatId, threadId: route.sourceThreadId, label: topicLabel("Source", route.sourceChatId, route.sourceThreadId) },
      enabled: route.enabled,
      outputCount: routeOutputs.length,
      languages: Array.from(new Set(routeOutputs.map((output) => output.language))).sort(),
      promptBoundCount: routeOutputs.filter((output) => findBindingForOutput(output, bindings) !== undefined).length,
      outputs: routeOutputs.map((output) => ({
        ...output,
        reviewLabel: topicLabel("Review", output.reviewChatId, output.reviewThreadId),
        finalLabel: topicLabel("Final", output.finalChatId, output.finalThreadId),
        promptProfileId: findBindingForOutput(output, bindings)?.promptProfileId ?? null,
        promptStatus: findBindingForOutput(output, bindings) ? "connected" : "missing"
      }))
    };
  });
  return { ok: true, categories, routes, outputs, profiles, bindings, promptMap: buildPromptMapRows(outputs, bindings, profiles), topicSuggestions };
}

async function buildPromptMap(routesRepository: TelegramRoutesRepository, promptsRepository: PromptProfilesRepository): Promise<Record<string, unknown>> {
  const outputs = await routesRepository.listOutputs();
  const profiles = await safeProfiles(promptsRepository);
  const bindings = await safeBindings(promptsRepository);
  return { ok: true, outputs, profiles, bindings, promptMap: buildPromptMapRows(outputs, bindings, profiles) };
}

function buildPromptMapRows(outputs: TelegramRouteOutputRecord[], bindings: PromptBindingRecord[], profiles: PromptProfileRecord[]): unknown[] {
  return outputs.map((output) => {
    const binding = findBindingForOutput(output, bindings);
    const profile = binding ? profiles.find((entry) => entry.id === binding.promptProfileId) : undefined;
    return {
      routeId: output.routeId,
      routeOutputId: output.id,
      category: deriveCategoryFromOutput(output),
      language: output.language,
      promptProfileId: binding?.promptProfileId ?? null,
      profileStatus: profile?.status ?? "missing",
      connected: binding !== undefined,
      systemPrompt: profile?.systemPrompt ?? "",
      userPromptTemplate: profile?.userPromptTemplate ?? defaultUserPromptTemplate(output.language),
      negativePrompt: profile?.negativePrompt ?? defaultNegativePrompt(),
      temperature: profile?.temperature ?? 0.4,
      maxTokens: profile?.maxTokens ?? 1200,
      riskPolicy: profile?.riskPolicy ?? defaultRiskPolicy(),
      styleGuide: profile?.styleGuide ?? defaultStyleGuide(output.language)
    };
  });
}

async function createCategory(routesRepository: TelegramRoutesRepository, promptsRepository: PromptProfilesRepository, input: NormalizedCreateCategory, updatedBy?: string): Promise<Record<string, unknown>> {
  const route = await routesRepository.upsertRoute({ id: input.category, category: input.category, sourceChatId: input.source.chatId, sourceThreadId: input.source.threadId, promptProfile: input.promptProfile, enabled: true });
  const createdOutputs: string[] = [];
  const createdPrompts: string[] = [];
  const createdBindings: string[] = [];
  for (const language of input.languages) {
    const result = await createLanguageOutput(routesRepository, promptsRepository, route, language, updatedBy);
    createdOutputs.push(...result.outputs);
    createdPrompts.push(...result.prompts);
    createdBindings.push(...result.bindings);
  }
  return { created: { route: route.id, outputs: createdOutputs, prompts: createdPrompts, bindings: createdBindings } };
}

async function createLanguageOutput(routesRepository: TelegramRoutesRepository, promptsRepository: PromptProfilesRepository, route: TelegramRouteRecord, language: NormalizedLanguage, updatedBy?: string): Promise<{ outputs: string[]; prompts: string[]; bindings: string[] }> {
  const outputId = `${route.id}_${language.language}`;
  const outputInput: UpsertTelegramRouteOutputInput = {
    id: outputId,
    routeId: route.id,
    language: language.language,
    reviewChatId: language.reviewChatId,
    reviewThreadId: language.reviewThreadId,
    finalChatId: language.finalChatId,
    ...(language.finalThreadId === undefined ? {} : { finalThreadId: language.finalThreadId }),
    enabled: true,
    publishEnabled: true,
    publishMode: language.publishMode,
    timezone: language.timezone,
    allowedPublishWindows: [],
    minimumGapMinutes: language.minimumGapMinutes,
    maxPostsPerHour: language.maxPostsPerHour,
    maxPostsPerDay: language.maxPostsPerDay,
    queuePriority: language.queuePriority,
    signatureEnabled: language.signatureEnabled,
    ...(language.signatureText === undefined ? {} : { signatureText: language.signatureText }),
    ...(language.signatureChannelHandle === undefined ? {} : { signatureChannelHandle: language.signatureChannelHandle })
  };
  const output = await routesRepository.upsertRouteOutput(outputInput);
  const promptProfileId = promptProfileIdFor(route.category, language.language);
  const profile = await promptsRepository.upsertProfile(makePromptProfileInput({
    id: promptProfileId,
    name: `${titleCase(route.category)} ${language.language.toUpperCase()} Editorial`,
    category: route.category,
    language: language.language,
    prompt: language.prompt,
    ...(updatedBy === undefined ? {} : { updatedBy })
  }));
  await promptsRepository.enforceSinglePromptForOutput({
    routeId: route.id,
    routeOutputId: output.id,
    category: route.category,
    language: language.language,
    contentType: "social_post",
    promptProfileId: profile.id,
    ...(updatedBy === undefined ? {} : { updatedBy })
  });
  const binding = await promptsRepository.upsertBinding(makePromptBindingInput({
    routeId: route.id,
    routeOutputId: output.id,
    category: route.category,
    language: language.language,
    promptProfileId: profile.id,
    promptVersion: profile.version,
    ...(updatedBy === undefined ? {} : { updatedBy })
  }));
  return { outputs: [output.id], prompts: [profile.id], bindings: [binding.id] };
}

async function upsertPromptForOutput(promptsRepository: PromptProfilesRepository, input: NormalizedPromptMap, updatedBy?: string): Promise<Record<string, unknown>> {
  const promptProfileId = promptProfileIdFor(input.category, input.language);
  const profile = await promptsRepository.upsertProfile(makePromptProfileInput({
    id: promptProfileId,
    name: `${titleCase(input.category)} ${input.language.toUpperCase()} Editorial`,
    category: input.category,
    language: input.language,
    contentType: input.contentType,
    prompt: input.prompt,
    ...(updatedBy === undefined ? {} : { updatedBy })
  }));
  await promptsRepository.enforceSinglePromptForOutput({
    routeId: input.routeId,
    routeOutputId: input.routeOutputId,
    category: input.category,
    language: input.language,
    contentType: input.contentType,
    promptProfileId: profile.id,
    ...(updatedBy === undefined ? {} : { updatedBy })
  });
  const binding = await promptsRepository.upsertBinding(makePromptBindingInput({
    routeId: input.routeId,
    routeOutputId: input.routeOutputId,
    category: input.category,
    language: input.language,
    contentType: input.contentType,
    promptProfileId: profile.id,
    promptVersion: profile.version,
    ...(updatedBy === undefined ? {} : { updatedBy })
  }));
  return { profile, binding };
}


function makePromptProfileInput(input: { id: string; name: string; category: string; language: string; contentType?: string; prompt: NormalizedPrompt; updatedBy?: string }): Parameters<PromptProfilesRepository["upsertProfile"]>[0] {
  return {
    id: input.id,
    name: input.name,
    category: input.category,
    language: input.language,
    contentType: input.contentType ?? "social_post",
    outputTarget: "telegram",
    version: "1.0.0",
    status: "active",
    systemPrompt: input.prompt.systemPrompt,
    userPromptTemplate: input.prompt.userPromptTemplate,
    ...(input.prompt.negativePrompt === undefined ? {} : { negativePrompt: input.prompt.negativePrompt }),
    temperature: input.prompt.temperature,
    maxTokens: input.prompt.maxTokens,
    ...(input.prompt.riskPolicy === undefined ? {} : { riskPolicy: input.prompt.riskPolicy }),
    ...(input.prompt.styleGuide === undefined ? {} : { styleGuide: input.prompt.styleGuide }),
    ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy })
  };
}

function makePromptBindingInput(input: { routeId: string; routeOutputId: string; category: string; language: string; contentType?: string; promptProfileId: string; promptVersion?: string; updatedBy?: string }): Parameters<PromptProfilesRepository["upsertBinding"]>[0] {
  return {
    routeId: input.routeId,
    routeOutputId: input.routeOutputId,
    category: input.category,
    language: input.language,
    contentType: input.contentType ?? "social_post",
    promptProfileId: input.promptProfileId,
    ...(input.promptVersion === undefined ? {} : { promptVersion: input.promptVersion }),
    enabled: true,
    ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy })
  };
}

type NormalizedPromptMap = { category: string; language: string; routeId: string; routeOutputId: string; contentType: string; prompt: NormalizedPrompt };

async function normalizePromptMapPayload(routesRepository: TelegramRoutesRepository, body: PromptMapPayload): Promise<{ ok: true; value: NormalizedPromptMap } | { ok: false; error: string; message: string }> {
  const routeOutputId = readString(body.routeOutputId);
  const output = routeOutputId ? await routesRepository.findOutputById(routeOutputId) : null;
  const outputs = output ? [output] : await routesRepository.listOutputs();
  const resolvedOutput = output ?? outputs.find((entry) => readString(body.category) && entry.routeId === readString(body.routeId) && entry.language === readString(body.language)) ?? outputs.find((entry) => entry.id === routeOutputId);
  if (!resolvedOutput) return { ok: false, error: "route_output_missing", message: "Choose an existing route output before saving a simple prompt." };
  const routes = await routesRepository.listRoutes();
  const route = routes.find((entry) => entry.id === resolvedOutput.routeId);
  const category = normalizeIdentifier(readString(body.category) ?? route?.category ?? deriveCategoryFromOutput(resolvedOutput));
  const language = normalizeLanguage(readString(body.language) ?? resolvedOutput.language);
  return { ok: true, value: { category, language, routeId: resolvedOutput.routeId, routeOutputId: resolvedOutput.id, contentType: readString(body.contentType) ?? "social_post", prompt: normalizePrompt(body.prompt, category, language) } };
}

function normalizeCreateCategoryPayload(body: CreateCategoryPayload): { ok: true; value: NormalizedCreateCategory } | { ok: false; error: string; message: string } {
  const category = normalizeIdentifier(readString(body.category));
  if (!category) return { ok: false, error: "invalid_category", message: "Category ID is required." };
  const sourceChatId = readString(body.source?.chatId);
  const sourceThreadId = readInteger(body.source?.threadId);
  if (!sourceChatId || sourceThreadId === undefined) return { ok: false, error: "invalid_source_topic", message: "Source chat and topic/thread are required." };
  const languages = Array.isArray(body.languages) ? body.languages.map((language) => normalizeLanguagePayload(language, category)).filter((entry): entry is NormalizedLanguage => entry !== null) : [];
  if (languages.length === 0) return { ok: false, error: "languages_required", message: "Add at least one language output." };
  return { ok: true, value: { category, label: readString(body.label) ?? titleCase(category), source: { chatId: sourceChatId, threadId: sourceThreadId }, promptProfile: readString(body.promptProfile) ?? promptProfileIdFor(category, languages[0]?.language ?? "fa"), languages } };
}

function normalizeAddLanguagePayload(categoryRaw: string, body: AddLanguagePayload): { ok: true; language: NormalizedLanguage } | { ok: false; error: string; message: string } {
  const category = normalizeIdentifier(categoryRaw);
  if (!category) return { ok: false, error: "invalid_category", message: "Category is required." };
  const language = normalizeLanguagePayload({ ...body, language: readString(body.language) }, category);
  if (!language) return { ok: false, error: "invalid_language_output", message: "Language, review topic and final channel are required." };
  return { ok: true, language };
}

function normalizeLanguagePayload(input: WizardLanguagePayload, category: string): NormalizedLanguage | null {
  const language = normalizeLanguage(readString(input.language));
  const reviewChatId = readString(input.reviewChatId);
  const reviewThreadId = readInteger(input.reviewThreadId);
  const finalChatId = readString(input.finalChatId);
  if (!language || !reviewChatId || reviewThreadId === undefined || !finalChatId) return null;
  return {
    language,
    reviewChatId,
    reviewThreadId,
    finalChatId,
    ...(readInteger(input.finalThreadId) === undefined ? {} : { finalThreadId: readInteger(input.finalThreadId)! }),
    publishMode: normalizePublishMode(readString(input.publishMode)),
    timezone: readString(input.timezone) ?? "Asia/Tehran",
    minimumGapMinutes: readInteger(input.minimumGapMinutes) ?? 10,
    maxPostsPerHour: readInteger(input.maxPostsPerHour) ?? 4,
    maxPostsPerDay: readInteger(input.maxPostsPerDay) ?? 24,
    queuePriority: readInteger(input.queuePriority) ?? 100,
    signatureEnabled: typeof input.signatureEnabled === "boolean" ? input.signatureEnabled : true,
    ...(readString(input.signatureText) === undefined ? {} : { signatureText: readString(input.signatureText)! }),
    ...(readString(input.signatureChannelHandle) === undefined ? {} : { signatureChannelHandle: readString(input.signatureChannelHandle)! }),
    prompt: normalizePrompt(input.prompt, category, language)
  };
}

function normalizePrompt(input: PromptPayload | undefined, category: string, language: string): NormalizedPrompt {
  return {
    systemPrompt: readString(input?.systemPrompt) ?? defaultSystemPrompt(category, language),
    userPromptTemplate: readString(input?.userPromptTemplate) ?? defaultUserPromptTemplate(language),
    ...(readString(input?.negativePrompt) === undefined ? {} : { negativePrompt: readString(input?.negativePrompt)! }),
    temperature: readNumber(input?.temperature) ?? 0.4,
    maxTokens: readInteger(input?.maxTokens) ?? 1200,
    riskPolicy: readString(input?.riskPolicy) ?? defaultRiskPolicy(),
    styleGuide: readString(input?.styleGuide) ?? defaultStyleGuide(language)
  };
}

function buildCreatePreview(input: NormalizedCreateCategory): Record<string, unknown> {
  return { route: input.category, source: input.source, outputs: input.languages.map((language) => `${input.category}_${language.language}`), prompts: input.languages.map((language) => promptProfileIdFor(input.category, language.language)), bindings: input.languages.map((language) => `${input.category}_${language.language}`) };
}

function buildTopicSuggestions(routes: TelegramRouteRecord[], outputs: TelegramRouteOutputRecord[]): unknown[] {
  const suggestions: Array<{ id: string; label: string; role: string; chatId: string; threadId?: number; category?: string; language?: string }> = [];
  for (const route of routes) suggestions.push({ id: `source:${route.id}`, label: topicLabel(`${titleCase(route.category)} Source`, route.sourceChatId, route.sourceThreadId), role: "source", chatId: route.sourceChatId, threadId: route.sourceThreadId, category: route.category });
  for (const output of outputs) {
    suggestions.push({ id: `review:${output.id}`, label: topicLabel(`${titleCase(deriveCategoryFromOutput(output))} ${output.language.toUpperCase()} Review`, output.reviewChatId, output.reviewThreadId), role: "review", chatId: output.reviewChatId, threadId: output.reviewThreadId, category: deriveCategoryFromOutput(output), language: output.language });
    if (output.finalChatId) suggestions.push({ id: `final:${output.id}`, label: topicLabel(`${titleCase(deriveCategoryFromOutput(output))} ${output.language.toUpperCase()} Final`, output.finalChatId, output.finalThreadId), role: "final", chatId: output.finalChatId, ...(output.finalThreadId === undefined ? {} : { threadId: output.finalThreadId }), category: deriveCategoryFromOutput(output), language: output.language });
  }
  return suggestions;
}

function findBindingForOutput(output: TelegramRouteOutputRecord, bindings: PromptBindingRecord[]): PromptBindingRecord | undefined {
  const exact = bindings.find((binding) => binding.enabled && binding.routeOutputId === output.id);
  if (exact) return exact;
  return bindings.find((binding) => binding.enabled && binding.routeId === output.routeId && binding.language === output.language);
}

function promptProfileIdFor(category: string, language: string): string {
  return `${normalizeIdentifier(category)}_${normalizeLanguage(language)}_editorial`;
}

function deriveCategoryFromOutput(output: TelegramRouteOutputRecord): string {
  return output.routeId.includes("_") ? output.routeId.split("_")[0] ?? output.routeId : output.routeId;
}

function defaultSystemPrompt(category: string, language: string): string {
  return [
    "You are an editorial automation assistant for Telegram publishing.",
    `Write in ${language} for the ${category} audience.`,
    "Preserve facts from the source. Do not invent claims, prices, quotes, or advice.",
    "Return only valid JSON matching the Telegram output schema."
  ].join("\n");
}

function defaultUserPromptTemplate(_language: string): string {
  return [
    "Category: {{category}}",
    "Language: {{language}}",
    "Source URL: {{sourceUrl}}",
    "Original text:",
    "{{sourceText}}",
    "Links:",
    "{{links}}",
    "Channel signature:",
    "{{channelSignature}}",
    "Task: rewrite the source into a Telegram-ready caption."
  ].join("\n");
}

function defaultNegativePrompt(): string {
  return "Do not invent prices, quotes, unsupported claims, financial advice, exaggerated promises, or unrelated hashtags.";
}

function defaultRiskPolicy(): string {
  return "Do not provide financial advice, unsupported claims, fake quotes, fake numbers, or unverifiable promises.";
}

function defaultStyleGuide(language: string): string {
  if (language === "fa") return "فارسی روان، دقیق، کوتاه، مناسب تلگرام، بدون اغراق و وفادار به منبع.";
  if (language === "ar") return "Arabic should be clear, concise, Telegram-ready, source-faithful, and not exaggerated.";
  return "Concise, accurate, source-faithful, Telegram-ready, and ready for human review.";
}

function normalizePublishMode(value: string | undefined): "immediate" | "scheduled" | "queued" {
  return value === "immediate" || value === "scheduled" || value === "queued" ? value : "queued";
}

function normalizeIdentifier(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeLanguage(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || "fa";
}

function titleCase(value: string): string {
  return value.split(/[_:-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || value;
}

function topicLabel(prefix: string, chatId: string | undefined, threadId?: number): string {
  if (!chatId && threadId === undefined) return "missing";
  return `${prefix}: ${chatId ?? "chat?"}${threadId === undefined ? "" : ` #${threadId}`}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readAdminUser(request: Request): string | undefined {
  return request.headers.get("x-admin-user") ?? request.headers.get("x-internal-api-user") ?? undefined;
}

async function safeProfiles(repository: PromptProfilesRepository): Promise<PromptProfileRecord[]> {
  try { return await repository.listProfiles(); } catch { return []; }
}

async function safeBindings(repository: PromptProfilesRepository): Promise<PromptBindingRecord[]> {
  try { return await repository.listBindings(); } catch { return []; }
}
