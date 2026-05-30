import { corsPreflightResponse, withCors } from "./http/cors";
import { jsonResponse } from "./http/json";
import { handleHealth } from "./routes/health";
import { handleInternalAdminConfig } from "./routes/internal-admin-config";
import { handleInternalAdminOverview } from "./routes/internal-admin-overview";
import { handleInternalAdminPrompts } from "./routes/internal-admin-prompts";
import { handleInternalAdminTests } from "./routes/internal-admin-tests";
import { handleInternalAdminAnalytics } from "./routes/internal-admin-analytics";
import { handleInternalAdminCategories } from "./routes/internal-admin-categories";
import { handleInternalAdminTimeline } from "./routes/internal-admin-timeline";
import { handleInternalAdminTestData } from "./routes/internal-admin-test-data";
import { handleInternalE2EMockPipeline } from "./routes/internal-e2e-mock";
import { handleInternalFirecrawlSandbox } from "./routes/internal-firecrawl-sandbox";
import { handleInternalMediaProcessed } from "./routes/internal-media-processed";
import { handleInternalPoll } from "./routes/internal-poll";
import { handleInternalMediaJobs } from "./routes/internal-media-jobs";
import { handleInternalRealIntegrationsPilot } from "./routes/internal-real-integrations-pilot";
import { handleInternalTelegramPublish } from "./routes/internal-publish";
import { handleInternalSchedulerRun } from "./routes/internal-scheduler-run";
import { handleInternalTelegramReviewDryRun } from "./routes/internal-telegram-review-dry-run";
import { handleInternalTelegramOutputsRecent } from "./routes/internal-telegram-outputs-recent";
import { handleInternalTelegramOutputDebug } from "./routes/internal-telegram-output-debug";
import { handleInternalTelegramPublishDue } from "./routes/internal-telegram-publish-due";
import { handleInternalTelegramPublishRetry } from "./routes/internal-telegram-publish-retry";
import { handleInternalTelegramPublishNow } from "./routes/internal-telegram-publish-now";
import { handleInternalTelegramPublishPreview } from "./routes/internal-telegram-publish-preview";
import { handleInternalTelegramPublishQueue } from "./routes/internal-telegram-publish-queue";
import { handleInternalMediaProcessing } from "./routes/internal-media-processing";
import { handleInternalTelegramTopicRoutes } from "./routes/internal-telegram-topic-routes";
import { handleInternalWordPressDryRun } from "./routes/internal-wordpress-dry-run";
import { handleInternalApifyCurationTrigger, handleInternalApifyCrawlRuns, handleInternalApifyCurationDecisions, handleInternalApifyCurationSources } from "./routes/internal-apify-curation";
import { handleReady } from "./routes/ready";
import { handleStatus } from "./routes/status";
import { handleTelegramWebhook } from "./routes/telegram-webhook";
import { handleScheduledPoll } from "./scheduled/poller";
import type { Env } from "./types";

const worker: ExportedHandler<Env> = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return corsPreflightResponse(request);
    }

    const response = await routeRequest(request, env);
    return withCors(request, response);
  },

  async scheduled(controller, env) {
    await handleScheduledPoll(controller, env);
  }
};

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/" || url.pathname === "/health") {
    return handleHealth(request, env);
  }

  if (url.pathname === "/ready") {
    return handleReady(request, env);
  }

  if (url.pathname === "/status") {
    return handleStatus(request, env);
  }

  if (url.pathname === "/internal/admin/config" || url.pathname === "/internal/admin/config/reset" || url.pathname === "/internal/admin/config/audit") {
    return handleInternalAdminConfig(request, env);
  }

  if (url.pathname === "/internal/admin/summary" || url.pathname === "/internal/admin/validate" || url.pathname === "/internal/admin/metrics/overview" || url.pathname === "/internal/admin/config/export" || url.pathname === "/internal/admin/media/settings") {
    return handleInternalAdminOverview(request, env);
  }

  if (url.pathname === "/internal/admin/prompts" || url.pathname === "/internal/admin/prompts/bindings" || url.pathname === "/internal/admin/prompts/preview" || url.pathname.startsWith("/internal/admin/prompts/")) {
    return handleInternalAdminPrompts(request, env);
  }

  if (url.pathname === "/internal/admin/ai/test" || url.pathname === "/internal/admin/providers/test" || url.pathname === "/internal/admin/telegram/test") {
    return handleInternalAdminTests(request, env);
  }

  if (url.pathname === "/internal/admin/timeline") {
    return handleInternalAdminTimeline(request, env);
  }

  if (url.pathname === "/internal/admin/analytics/overview") {
    return handleInternalAdminAnalytics(request, env);
  }

  if (url.pathname === "/internal/admin/categories" || url.pathname === "/internal/admin/categories/preview" || url.pathname === "/internal/admin/categories/create" || url.pathname.startsWith("/internal/admin/categories/") || url.pathname === "/internal/admin/prompt-map" || url.pathname === "/internal/admin/prompt-map/upsert") {
    return handleInternalAdminCategories(request, env);
  }

  if (url.pathname === "/internal/admin/test-data/counts" || url.pathname === "/internal/admin/test-data/reset" || url.pathname === "/internal/admin/test-data/dedupe-search") {
    return handleInternalAdminTestData(request, env);
  }

  if (url.pathname === "/internal/poll") {
    return handleInternalPoll(request, env);
  }

  if (url.pathname === "/internal/media/jobs" || url.pathname.startsWith("/internal/media/jobs/")) {
    return handleInternalMediaJobs(request, env);
  }

  if (url.pathname === "/internal/media/processed") {
    return handleInternalMediaProcessed(request, env);
  }

  if (url.pathname === "/internal/scheduler/run") {
    return handleInternalSchedulerRun(request, env);
  }

  if (url.pathname === "/internal/pilot/real-integrations") {
    return handleInternalRealIntegrationsPilot(request, env);
  }

  if (url.pathname === "/internal/providers/firecrawl/sandbox-fetch") {
    return handleInternalFirecrawlSandbox(request, env);
  }

  if (url.pathname === "/internal/telegram/review-dry-run") {
    return handleInternalTelegramReviewDryRun(request, env);
  }

  if (url.pathname === "/internal/telegram/outputs/recent") {
    return handleInternalTelegramOutputsRecent(request, env);
  }
  if (url.pathname === "/internal/telegram/outputs/debug") {
    return handleInternalTelegramOutputDebug(request, env);
  }

  if (url.pathname === "/internal/telegram/publish/due") {
    return handleInternalTelegramPublishDue(request, env);
  }

  if (url.pathname === "/internal/telegram/publish/retry") {
    return handleInternalTelegramPublishRetry(request, env);
  }

  if (url.pathname === "/internal/telegram/publish/now") {
    return handleInternalTelegramPublishNow(request, env);
  }

  if (url.pathname === "/internal/telegram/publish/preview") {
    return handleInternalTelegramPublishPreview(request, env);
  }

  if (url.pathname === "/internal/telegram/publish/queue") {
    return handleInternalTelegramPublishQueue(request, env);
  }

  if (isTelegramTopicRoutesPath(url.pathname)) {
    return handleInternalTelegramTopicRoutes(request, env);
  }

  if (
    url.pathname === "/internal/media/processing"
    || url.pathname === "/internal/media/processing/callback"
    || url.pathname === "/internal/media/processing/jobs"
    || url.pathname.startsWith("/internal/media/processing/jobs/")
  ) {
    return handleInternalMediaProcessing(request, env);
  }

  if (url.pathname === "/internal/apify/curation/trigger") {
    return handleInternalApifyCurationTrigger(request, env);
  }

  if (url.pathname === "/internal/apify/crawl-runs") {
    return handleInternalApifyCrawlRuns(request, env);
  }

  if (url.pathname === "/internal/apify/curation-decisions") {
    return handleInternalApifyCurationDecisions(request, env);
  }

  if (url.pathname === "/internal/apify/curation-sources") {
    return handleInternalApifyCurationSources(request, env);
  }

  if (url.pathname === "/internal/wordpress/dry-run") {
    return handleInternalWordPressDryRun(request, env);
  }

  if (url.pathname === "/internal/e2e/mock-pipeline") {
    return handleInternalE2EMockPipeline(request, env);
  }

  if (url.pathname === "/internal/publish/telegram") {
    return handleInternalTelegramPublish(request, env);
  }

  if (url.pathname === "/telegram/webhook") {
    return handleTelegramWebhook(request, env);
  }

  return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
}

function isTelegramTopicRoutesPath(pathname: string): boolean {
  return pathname === "/internal/telegram/topic-routes"
    || pathname === "/internal/telegram/topic-routes/seed"
    || pathname === "/internal/telegram/topic-routes/validate"
    || pathname.startsWith("/internal/telegram/topic-routes/")
    || pathname.startsWith("/internal/telegram/topic-route-outputs/");
}

export default worker;
