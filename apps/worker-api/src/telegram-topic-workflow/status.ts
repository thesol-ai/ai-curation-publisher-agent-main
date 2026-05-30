import { TelegramRoutesRepository, type TelegramRouteOutputRecord, type TelegramRouteRecord } from "@curator/db";
import type { Env } from "../types";

export type TelegramTopicWorkflowRouteSummary = {
  id: string;
  category: string;
  sourceChatId: string;
  sourceThreadId: number;
  promptProfile: string;
  enabled: boolean;
  warnings: string[];
  outputs: Array<{
    id: string;
    language: string;
    reviewChatId: string;
    reviewThreadId: number;
    finalChatId: string;
    finalThreadId?: number;
    enabled: boolean;
    warnings: string[];
    publishEnabled: boolean;
    publishMode: string;
    timezone: string;
    allowedPublishWindows: string[];
    minimumGapMinutes: number;
    maxPostsPerHour: number;
    maxPostsPerDay: number;
    queuePriority: number;
    signatureEnabled: boolean;
    signatureText?: string;
    signatureChannelHandle?: string;
  }>;
};

export type TelegramTopicWorkflowSummary = {
  topicWorkflowConfigured: boolean;
  routeManagerReady: boolean;
  routeValidation: {
    valid: boolean;
    invalidRouteCount: number;
    issueCount: number;
  };
  routeCount: number;
  enabledRouteCount: number;
  outputCount: number;
  enabledOutputCount: number;
  botTokenConfigured: boolean;
  reviewRoutingConfigured: boolean;
  finalPublishingEnabled: boolean;
  wordpressOptional: true;
  mediaMode: "telegram_file_id_reuse" | "telegram_file_id_reuse_plus_github_actions";
  mediaProcessorEnabled: boolean;
  sendMediaGroupSupported: true;
  routes: TelegramTopicWorkflowRouteSummary[];
  warnings: string[];
};

type EnvWithFinalPublish = Env & {
  TELEGRAM_FINAL_PUBLISH_ENABLED?: string;
  GITHUB_MEDIA_PROCESSOR_ENABLED?: string;
  GITHUB_MEDIA_PROCESSOR_REPOSITORY?: string;
  TELEGRAM_MEDIA_STAGING_CHAT_ID?: string;
};

export async function readTelegramTopicWorkflowSummary(env: Env): Promise<TelegramTopicWorkflowSummary> {
  const repository = new TelegramRoutesRepository(env.DB);
  const warnings: string[] = [];
  let routeCount = 0;
  let enabledRouteCount = 0;
  let outputCount = 0;
  let enabledOutputCount = 0;
  let reviewRoutingConfigured = false;
  let routes: TelegramTopicWorkflowRouteSummary[] = [];
  const mediaProcessorEnabled = (env as EnvWithFinalPublish).GITHUB_MEDIA_PROCESSOR_ENABLED === "true";
  const finalPublishingEnabled = (env as EnvWithFinalPublish).TELEGRAM_FINAL_PUBLISH_ENABLED === "true";

  try {
    const summary = await repository.countSummary();
    routeCount = summary.routeCount;
    enabledRouteCount = summary.enabledRouteCount;
    outputCount = summary.outputCount;
    enabledOutputCount = summary.enabledOutputCount;
    reviewRoutingConfigured = summary.reviewRoutingConfigured;
    const routeRecords = await repository.listRoutes();
    const outputRecords = await repository.listOutputs();
    routes = buildRouteSummaries(routeRecords, outputRecords);
  } catch {
    warnings.push("Telegram topic routing tables are missing or inaccessible. Apply Phase 33 D1 migrations.");
  }

  const invalidRouteCount = routes.filter((route) => route.warnings.length > 0 || route.outputs.some((output) => output.warnings.length > 0)).length;
  const issueCount = routes.reduce((count, route) => count + route.warnings.length + route.outputs.reduce((outputCountForRoute, output) => outputCountForRoute + output.warnings.length, 0), 0);

  if (enabledRouteCount === 0) {
    warnings.push("No enabled Telegram topic routes are configured.");
  }
  if (enabledOutputCount === 0) {
    warnings.push("No enabled Telegram route outputs are configured.");
  }
  if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
    warnings.push("TELEGRAM_BOT_TOKEN is not configured. Real review delivery and final publishing cannot run.");
  }
  if (!finalPublishingEnabled) {
    warnings.push("Final Telegram publishing is disabled. Send callbacks queue outputs only.");
  }
  if (mediaProcessorEnabled) {
    if (!(env as EnvWithFinalPublish).GITHUB_MEDIA_PROCESSOR_REPOSITORY?.trim()) warnings.push("GitHub media processor is enabled but repository is missing.");
    if (!(env as EnvWithFinalPublish).TELEGRAM_MEDIA_STAGING_CHAT_ID?.trim()) warnings.push("GitHub media processor is enabled but Telegram media staging chat is missing.");
    warnings.push("External media processor is enabled. Downloaded media will be staged through Telegram file_id reuse.");
  } else {
    warnings.push("External media processor is disabled. Telegram-origin file_id reuse remains active.");
  }

  return {
    topicWorkflowConfigured: enabledRouteCount > 0 && enabledOutputCount > 0,
    routeManagerReady: routeCount > 0 && issueCount === 0,
    routeValidation: {
      valid: issueCount === 0,
      invalidRouteCount,
      issueCount
    },
    routeCount,
    enabledRouteCount,
    outputCount,
    enabledOutputCount,
    botTokenConfigured: Boolean(env.TELEGRAM_BOT_TOKEN?.trim()),
    reviewRoutingConfigured,
    finalPublishingEnabled,
    wordpressOptional: true,
    mediaMode: mediaProcessorEnabled ? "telegram_file_id_reuse_plus_github_actions" : "telegram_file_id_reuse",
    mediaProcessorEnabled,
    sendMediaGroupSupported: true,
    routes,
    warnings
  };
}

function buildRouteSummaries(routes: TelegramRouteRecord[], outputs: TelegramRouteOutputRecord[]): TelegramTopicWorkflowRouteSummary[] {
  return routes.map((route) => {
    const routeOutputs = outputs.filter((output) => output.routeId === route.id);
    const enabledOutputs = routeOutputs.filter((output) => output.enabled);
    const routeWarnings: string[] = [];
    if (route.enabled && enabledOutputs.length === 0) routeWarnings.push("Enabled route has no enabled outputs.");
    if (!route.sourceChatId.trim()) routeWarnings.push("Source chat ID is missing.");
    return {
      id: route.id,
      category: route.category,
      sourceChatId: route.sourceChatId,
      sourceThreadId: route.sourceThreadId,
      promptProfile: route.promptProfile,
      enabled: route.enabled,
      warnings: routeWarnings,
      outputs: routeOutputs.map((output) => ({
        id: output.id,
        language: output.language,
        reviewChatId: output.reviewChatId,
        reviewThreadId: output.reviewThreadId,
        finalChatId: output.finalChatId,
        ...(output.finalThreadId === undefined ? {} : { finalThreadId: output.finalThreadId }),
        enabled: output.enabled,
        publishEnabled: output.publishEnabled,
        publishMode: output.publishMode,
        timezone: output.timezone,
        allowedPublishWindows: output.allowedPublishWindows,
        minimumGapMinutes: output.minimumGapMinutes,
        maxPostsPerHour: output.maxPostsPerHour,
        maxPostsPerDay: output.maxPostsPerDay,
        queuePriority: output.queuePriority,
        signatureEnabled: output.signatureEnabled,
        ...(output.signatureText === undefined ? {} : { signatureText: output.signatureText }),
        ...(output.signatureChannelHandle === undefined ? {} : { signatureChannelHandle: output.signatureChannelHandle }),
        warnings: outputWarnings(output)
      }))
    };
  });
}

function outputWarnings(output: TelegramRouteOutputRecord): string[] {
  const warnings: string[] = [];
  if (!output.reviewChatId.trim()) warnings.push("Review chat ID is missing.");
  if (!output.finalChatId.trim()) warnings.push("Final channel/chat ID is missing.");
  if (output.enabled && !output.publishEnabled) warnings.push("Publishing is disabled for this output.");
  if (output.signatureEnabled && !output.signatureText && !output.signatureChannelHandle) warnings.push("Channel signature is enabled but empty.");
  if (output.signatureChannelHandle !== undefined && !/^@[A-Za-z0-9_]{5,32}$/.test(output.signatureChannelHandle)) warnings.push("Channel signature handle must start with @.");
  return warnings;
}
