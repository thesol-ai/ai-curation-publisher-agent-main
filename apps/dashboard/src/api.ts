import { redactSensitiveJson, redactSensitiveText } from "./setup";
import type { AdminConfigResponse, AdminAuditEntry, ApiResult, JsonObject, JsonValue, PilotInput, StatusBundle } from "./types";

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

export function validateWorkerBaseUrl(value: string): { ok: true; value: string } | { ok: false; message: string } {
  const normalized = normalizeApiBaseUrl(value);
  if (normalized.length === 0) return { ok: false, message: "Invalid Worker URL. Enter the deployed Worker URL first." };
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return { ok: false, message: "Invalid Worker URL. Use https:// for deployed workers." };
    }
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, message: "Invalid Worker URL. Check the URL format." };
  }
}

export function describeConnectionBundle(bundle: StatusBundle): "connected" | "reachable_not_ready" | "unreachable" | "cors_blocked" {
  if (bundle.health?.ok === true && bundle.status?.ok === true) return bundle.ready?.ok === true ? "connected" : "reachable_not_ready";
  const failures = [bundle.health, bundle.status, bundle.ready].filter((result): result is Extract<ApiResult, { ok: false }> => result?.ok === false);
  return failures.some((failure) => failure.error === "cors_or_network_error") ? "cors_blocked" : "unreachable";
}

export class WorkerApiClient {
  private readonly baseUrl: string;
  private readonly internalCredential?: string;

  constructor(baseUrl: string, internalCredential?: string) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    if (internalCredential !== undefined && internalCredential.length > 0) this.internalCredential = internalCredential;
  }

  async getStatusBundle(): Promise<StatusBundle> {
    const [health, status, ready] = await Promise.all([this.getJson("/health"), this.getJson("/status"), this.getJson("/ready")]);
    return { health, status, ready };
  }

  async getAdminConfig(): Promise<ApiResult<AdminConfigResponse>> { return this.getInternalJson("/internal/admin/config") as Promise<ApiResult<AdminConfigResponse>>; }
  async getAdminSummary(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/summary"); }
  async getAdminValidation(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/validate"); }
  async getAdminMetricsOverview(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/metrics/overview"); }
  async getAdminMetricsTimeseries(rangeDays = 30): Promise<ApiResult> { return this.getInternalJson(`/internal/admin/metrics/timeseries?rangeDays=${encodeURIComponent(String(rangeDays))}`); }
  async getAdminAnalyticsOverview(rangeDays = 30, category = "all"): Promise<ApiResult> { return this.getInternalJson(`/internal/admin/analytics/overview?rangeDays=${encodeURIComponent(String(rangeDays))}&category=${encodeURIComponent(category)}`); }
  async getPromptStudio(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/prompts"); }
  async getCategories(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/categories"); }
  async previewCategory(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/categories/preview", input); }
  async createCategory(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/categories/create", input); }
  async addCategoryLanguage(category: string, input: JsonObject): Promise<ApiResult> { return this.postInternalJson(`/internal/admin/categories/${encodeURIComponent(category)}/add-language`, input); }
  async getPromptMap(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/prompt-map"); }
  async upsertPromptMap(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/prompt-map/upsert", input); }
  async savePromptProfile(profile: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/prompts", profile); }
  async updatePromptProfile(profileId: string, profile: JsonObject): Promise<ApiResult> { return this.requestJson(`/internal/admin/prompts/${encodeURIComponent(profileId)}`, { method: "PUT", body: JSON.stringify(profile), headers: this.internalHeaders() }); }
  async activatePromptProfile(profileId: string): Promise<ApiResult> { return this.postInternalJson(`/internal/admin/prompts/${encodeURIComponent(profileId)}/activate`, {}); }
  async archivePromptProfile(profileId: string): Promise<ApiResult> { return this.postInternalJson(`/internal/admin/prompts/${encodeURIComponent(profileId)}/archive`, {}); }
  async savePromptBinding(binding: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/prompts/bindings", binding); }
  async previewPrompt(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/prompts/preview", input); }
  async exportAdminConfig(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/config/export"); }
  async getAdminMediaSettings(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/media/settings"); }
  async getTestDataCounts(): Promise<ApiResult> { return this.getInternalJson("/internal/admin/test-data/counts"); }
  async resetTestData(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/test-data/reset", input); }
  async searchDedupeHistory(sourceUrl: string): Promise<ApiResult> { return this.postInternalJson("/internal/admin/test-data/dedupe-search", { sourceUrl }); }
  async getItemTimeline(input: { itemId?: string; generatedOutputId?: string; queueId?: string; sourceUrl?: string }): Promise<ApiResult> { const params = new URLSearchParams(); if (input.itemId) params.set("itemId", input.itemId); if (input.generatedOutputId) params.set("generatedOutputId", input.generatedOutputId); if (input.queueId) params.set("queueId", input.queueId); if (input.sourceUrl) params.set("sourceUrl", input.sourceUrl); return this.getInternalJson(`/internal/admin/timeline?${params.toString()}`); }

  async testAI(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/ai/test", input); }
  async testProvider(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/providers/test", input); }
  async testTelegram(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/admin/telegram/test", input); }
  async saveAdminMediaSettings(updates: { key: string; value: string }[]): Promise<ApiResult> { return this.requestJson("/internal/admin/media/settings", { method: "PATCH", body: JSON.stringify({ updates }), headers: this.internalHeaders() }); }
  async saveAdminConfig(updates: { key: string; value: string }[]): Promise<ApiResult<AdminConfigResponse>> { return this.putInternalJson("/internal/admin/config", { updates }) as Promise<ApiResult<AdminConfigResponse>>; }
  async resetAdminConfig(keys: string[]): Promise<ApiResult<AdminConfigResponse>> { return this.postInternalJson("/internal/admin/config/reset", { keys }) as Promise<ApiResult<AdminConfigResponse>>; }
  async getAdminConfigAudit(): Promise<ApiResult<{ ok: true; entries: AdminAuditEntry[] }>> { return this.getInternalJson("/internal/admin/config/audit") as Promise<ApiResult<{ ok: true; entries: AdminAuditEntry[] }>>; }
  async getTelegramTopicRoutes(): Promise<ApiResult> { return this.getInternalJson("/internal/telegram/topic-routes"); }
  async validateTelegramTopicRoutes(): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/topic-routes/validate", {}); }
  async seedTelegramTopicRoutes(routes: JsonValue): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/topic-routes/seed", { routes }); }
  async saveTelegramRoute(route: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/topic-routes", route); }
  async saveTelegramRouteOutput(routeId: string, output: JsonObject): Promise<ApiResult> { return this.postInternalJson(`/internal/telegram/topic-routes/${encodeURIComponent(routeId)}/outputs`, output); }

  async updateTelegramRoute(routeId: string, route: JsonObject): Promise<ApiResult> { return this.requestJson(`/internal/telegram/topic-routes/${encodeURIComponent(routeId)}`, { method: "PUT", body: JSON.stringify(route), headers: this.internalHeaders() }); }
  async disableTelegramRoute(routeId: string): Promise<ApiResult> { return this.postInternalJson(`/internal/telegram/topic-routes/${encodeURIComponent(routeId)}/disable`, {}); }
  async updateTelegramRouteOutput(outputId: string, output: JsonObject): Promise<ApiResult> { return this.requestJson(`/internal/telegram/topic-route-outputs/${encodeURIComponent(outputId)}`, { method: "PUT", body: JSON.stringify(output), headers: this.internalHeaders() }); }
  async disableTelegramRouteOutput(outputId: string): Promise<ApiResult> { return this.postInternalJson(`/internal/telegram/topic-route-outputs/${encodeURIComponent(outputId)}/disable`, {}); }
  async getRecentTelegramOutputs(limit = 20): Promise<ApiResult> { return this.getInternalJson(`/internal/telegram/outputs/recent?limit=${encodeURIComponent(String(limit))}`); }
  async publishTelegramNow(queueId: string): Promise<ApiResult> {
    return this.postInternalJson("/internal/telegram/publish/now", { queueId });
  }
  async previewTelegramPublish(queueId: string): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/publish/preview", { queueId }); }

  async getTelegramPublishQueue(limit = 25): Promise<ApiResult> { return this.getInternalJson(`/internal/telegram/publish/queue?limit=${encodeURIComponent(String(limit))}`); }
  async runTelegramPublishDue(limit = 5): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/publish/due", { limit }); }

  async cancelTelegramPublishQueueItem(queueId: string): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/publish/queue", { action: "cancel", queueId }); }
  async rescheduleTelegramPublishQueueItem(queueId: string, scheduledFor: string): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/publish/queue", { action: "reschedule", queueId, scheduledFor }); }
  async bulkPublishTelegramNow(queueIds: string[]): Promise<ApiResult> { return this.postInternalJson("/internal/telegram/publish/queue", { action: "bulk_publish_now", queueIds }); }
  async getMediaJobs(limit = 25): Promise<ApiResult> { return this.getInternalJson(`/internal/media/jobs?limit=${encodeURIComponent(String(limit))}`); }
  async debugMediaUrl(sourceUrl: string): Promise<ApiResult> { return this.postInternalJson("/internal/media/processing/debug", { sourceUrl }); }
  async retryMediaJob(jobId: string): Promise<ApiResult> { return this.postInternalJson(`/internal/media/processing/jobs/${encodeURIComponent(jobId)}/dispatch`, {}); }
  async cancelMediaJob(jobId: string): Promise<ApiResult> { return this.postInternalJson(`/internal/media/processing/jobs/${encodeURIComponent(jobId)}/cancel`, {}); }

  async runInternalAuthProbe(): Promise<ApiResult> {
    const withoutSecret = await this.postJson("/internal/e2e/mock-pipeline", {}, false);
    const withSecret = this.internalCredential === undefined ? undefined : await this.postJson("/internal/e2e/mock-pipeline", {}, true);
    const protectedRoute = withoutSecret.status === 401;
    const credentialWorks = withSecret?.ok === true;
    const ok = protectedRoute && credentialWorks;
    const data: JsonObject = { ok, withoutSecretStatus: withoutSecret.status ?? "network_error", withSecretStatus: withSecret?.status ?? "not_run", protected: protectedRoute, credentialWorks, note: ok ? "Internal auth is protected and the local credential works." : "Internal auth needs attention. Check Cloudflare Worker Secret and the locally entered dashboard credential." };
    if (ok) return { ok: true, status: withSecret.status, data };
    return { ok: false, status: withSecret?.status ?? withoutSecret.status ?? 0, error: "internal_auth_probe_failed", message: "Internal auth protection did not pass the expected check.", data };
  }

  async runMockE2E(): Promise<ApiResult> { return this.postInternalJson("/internal/e2e/mock-pipeline", {}); }
  async runSchedulerDryRun(): Promise<ApiResult> { return this.postInternalJson("/internal/scheduler/run", { dryRun: true, maxSources: 1, maxItems: 1 }); }

  async runTelegramReviewDryRun(input: { text: string; sourceUrl?: string }): Promise<ApiResult> {
    const body: JsonObject = { text: input.text };
    if (input.sourceUrl !== undefined && input.sourceUrl.length > 0) body.sourceUrl = input.sourceUrl;
    return this.postInternalJson("/internal/telegram/review-dry-run", body);
  }

  async runWordPressDraftDryRun(input: { title: string; content: string; sourceUrl?: string }): Promise<ApiResult> {
    const body: JsonObject = { title: input.title, content: input.content };
    if (input.sourceUrl !== undefined && input.sourceUrl.length > 0) body.sourceUrl = input.sourceUrl;
    return this.postInternalJson("/internal/wordpress/dry-run", body);
  }

  async runFirecrawlSandboxFetch(input: { url: string }): Promise<ApiResult> { return this.postInternalJson("/internal/providers/firecrawl/sandbox-fetch", { url: input.url }); }
  async runPilot(input: PilotInput): Promise<ApiResult> { return this.postInternalJson("/internal/pilot/real-integrations", input as JsonObject); }

  // Apify Curation Pipeline
  async triggerApifyCuration(): Promise<ApiResult> { return this.postInternalJson("/internal/apify/curation/trigger", {}); }
  async getApifyCrawlRuns(limit = 20): Promise<ApiResult> { return this.getInternalJson(`/internal/apify/crawl-runs?limit=${encodeURIComponent(String(limit))}`); }
  async getApifyCurationDecisions(runId?: string, limit = 50): Promise<ApiResult> { const params = new URLSearchParams(); if (runId) params.set("runId", runId); params.set("limit", String(limit)); return this.getInternalJson(`/internal/apify/curation-decisions?${params.toString()}`); }
  async getApifyCurationSources(): Promise<ApiResult> { return this.getInternalJson("/internal/apify/curation-sources"); }
  async addApifyCurationSource(input: JsonObject): Promise<ApiResult> { return this.postInternalJson("/internal/apify/curation-sources", input); }
  async deleteApifyCurationSource(id: string): Promise<ApiResult> { return this.requestJson(`/internal/apify/curation-sources?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: this.internalHeaders() }); }

  private async getJson(path: string): Promise<ApiResult> { return this.requestJson(path, { method: "GET" }); }
  private async getInternalJson(path: string): Promise<ApiResult> { return this.requestJson(path, { method: "GET", headers: this.internalHeaders() }); }
  private async putInternalJson(path: string, body: JsonObject): Promise<ApiResult> { return this.requestJson(path, { method: "PUT", body: JSON.stringify(body), headers: this.internalHeaders() }); }
  private async postInternalJson(path: string, body: JsonObject): Promise<ApiResult> { return this.postJson(path, body, true); }
  private async postJson(path: string, body: JsonObject, includeCredential: boolean): Promise<ApiResult> { return this.requestJson(path, { method: "POST", body: JSON.stringify(body), headers: includeCredential ? this.internalHeaders() : { "content-type": "application/json" } }); }
  private internalHeaders(): HeadersInit { return { "content-type": "application/json", ...(this.internalCredential !== undefined ? { "x-internal-api-secret": this.internalCredential } : {}) }; }

  private async requestJson(path: string, init: RequestInit): Promise<ApiResult> {
    const valid = validateWorkerBaseUrl(this.baseUrl);
    if (!valid.ok) return { ok: false, error: "invalid_worker_url", message: valid.message };
    try {
      const response = await fetch(`${valid.value}${path}`, init);
      const data = await readJsonSafely(response);
      if (!response.ok) return { ok: false, status: response.status, error: getErrorName(data), message: getErrorMessage(data, response.status), data: redactSensitiveJson(data) };
      return { ok: true, status: response.status, data: redactSensitiveJson(data) as JsonObject };
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Network request failed.";
      return { ok: false, error: "cors_or_network_error", message: classifyNetworkError(rawMessage) };
    }
  }
}

async function readJsonSafely(response: Response): Promise<JsonValue> { try { return await response.json() as JsonValue; } catch { return null; } }
function getErrorName(value: JsonValue): string { if (isObject(value) && typeof value.error === "string") return value.error; return "http_error"; }
function getErrorMessage(value: JsonValue, status: number): string { if (isObject(value) && typeof value.message === "string") return redactSensitiveText(value.message); return `Request failed with HTTP ${status}.`; }
function classifyNetworkError(message: string): string { const safe = redactSensitiveText(message); return `Browser blocked the request, likely CORS, or the Worker could not be reached. ${safe}`; }
function isObject(value: JsonValue): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
