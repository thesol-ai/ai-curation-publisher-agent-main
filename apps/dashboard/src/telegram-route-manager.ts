export type TelegramRouteManagerSummary = {
  botStatus: "Configured" | "Missing";
  finalPublishing: "Enabled" | "Disabled";
  routeCount: number;
  enabledOutputCount: number;
  mediaMode: string;
  wordpress: "Optional";
  routeCards: TelegramRouteCard[];
};

export type TelegramRouteCard = {
  title: string;
  category: string;
  sourceChatId: string;
  sourceThreadId: number;
  promptProfile: string;
  enabledLabel: "Enabled" | "Disabled";
  outputsCount: number;
  warnings: string[];
  outputs: Array<{
    title: string;
    language: string;
    reviewChatId: string;
    reviewThreadId: number;
    finalChatId: string;
    finalThreadId?: number;
    enabledLabel: "Enabled" | "Disabled";
    latestStatus: string;
    publishEnabledLabel: "Enabled" | "Disabled";
    publishMode: string;
    timezone: string;
    allowedPublishWindows: string[];
    minimumGapMinutes: number;
    maxPostsPerHour: number;
    maxPostsPerDay: number;
    queuePriority: number;
    signatureEnabled: boolean;
    signatureText: string;
    signatureChannelHandle: string;
  }>;
};

export const TELEGRAM_ROUTE_FORM_FIELDS = [
  { label: "Route ID", helper: "Technical name: id. Example: crypto", secret: false },
  { label: "Category", helper: "Human category shown to operators. Example: crypto", secret: false },
  { label: "Source chat ID", helper: "Technical name: sourceChatId. Example: -1001234567890", secret: false },
  { label: "Source topic ID", helper: "Technical name: sourceThreadId. Example: 101", secret: false },
  { label: "Prompt profile", helper: "Technical name: promptProfile. Example: crypto_editorial", secret: false },
  { label: "Enabled", helper: "Disabled routes are ignored safely.", secret: false }
] as const;

export const TELEGRAM_OUTPUT_FORM_FIELDS = [
  { label: "Output ID", helper: "Technical name: id. Example: crypto_fa", secret: false },
  { label: "Language", helper: "Example: fa, en, ar", secret: false },
  { label: "Review chat ID", helper: "Technical name: reviewChatId. Usually the internal forum group ID.", secret: false },
  { label: "Review topic ID", helper: "Technical name: reviewThreadId. Example: 201", secret: false },
  { label: "Final channel/chat ID", helper: "Technical name: finalChatId. Example: @crypto_fa", secret: false },
  { label: "Final topic ID", helper: "Optional technical name: finalThreadId.", secret: false },
  { label: "Enabled", helper: "Disabled outputs are skipped safely.", secret: false },
  { label: "Publish enabled", helper: "Technical name: publishEnabled. Controls whether this output can be queued/published.", secret: false },
  { label: "Publish mode", helper: "Technical name: publishMode. Use immediate, scheduled, or queued.", secret: false },
  { label: "Timezone", helper: "Technical name: timezone. Example: Asia/Tehran or UTC.", secret: false },
  { label: "Allowed windows", helper: "Technical name: allowedPublishWindows. Example: 09:00-23:00.", secret: false },
  { label: "Minimum gap", helper: "Technical name: minimumGapMinutes. Example: 10.", secret: false },
  { label: "Max per hour", helper: "Technical name: maxPostsPerHour. Example: 4.", secret: false },
  { label: "Max per day", helper: "Technical name: maxPostsPerDay. Example: 24.", secret: false },
  { label: "Queue priority", helper: "Technical name: queuePriority. Higher values publish first.", secret: false },
  { label: "Channel signature", helper: "Optional output footer shown in review and final publish.", secret: false },
  { label: "Signature channel handle", helper: "Public channel handle for the signature. Must start with @.", secret: false }
] as const;

export function telegramRouteManagerCopy(): string {
  return "Topic names are only for humans. The system uses numeric topic IDs.";
}

export function telegramRoutesEmptyStateTitle(): string {
  return "No routes loaded yet.";
}

export function telegramRoutesEmptyStateText(summary: TelegramRouteManagerSummary): string {
  if (summary.routeCount === 0) {
    return "No routes loaded yet. Enter Admin access, then click Load routes. If it still shows 0, create or seed a route first. No Telegram routes are configured yet. A route connects one source topic to one or more review/final outputs.";
  }
  return "Enter Admin access, then click Load routes. If it still shows 0, create or seed a route first.";
}

export function telegramBotMissingText(summary: TelegramRouteManagerSummary): string | undefined {
  if (summary.botStatus !== "Missing") return undefined;
  return "Telegram bot token is missing or not visible to the Worker. Set TELEGRAM_BOT_TOKEN as a Cloudflare Worker Secret, then redeploy.";
}

export function buildTelegramRouteManagerSummary(topicWorkflow: Record<string, unknown> | undefined): TelegramRouteManagerSummary {
  const routes = Array.isArray(topicWorkflow?.routes) ? topicWorkflow.routes.filter(isRecord) : [];
  return {
    botStatus: topicWorkflow?.botTokenConfigured === true ? "Configured" : "Missing",
    finalPublishing: topicWorkflow?.finalPublishingEnabled === true ? "Enabled" : "Disabled",
    routeCount: readNumber(topicWorkflow?.routeCount) ?? routes.length,
    enabledOutputCount: readNumber(topicWorkflow?.enabledOutputCount) ?? 0,
    mediaMode: readString(topicWorkflow?.mediaMode) ?? "telegram_file_id_reuse",
    wordpress: "Optional",
    routeCards: routes.map(toRouteCard)
  };
}

export function summarizeRecentTelegramOutputs(rawOutputs: unknown): Array<{ itemId: string; category: string; language: string; reviewStatus: string; publishQueueStatus: string; finalChatId: string; lastError: string; updatedAt: string }> {
  if (!Array.isArray(rawOutputs)) return [];
  return rawOutputs.filter(isRecord).map((entry) => ({
    itemId: readString(entry.itemId) ?? "unknown",
    category: readString(entry.category) ?? "unknown",
    language: readString(entry.language) ?? "unknown",
    reviewStatus: readString(entry.reviewStatus) ?? readString(entry.status) ?? "unknown",
    publishQueueStatus: readString(entry.publishQueueStatus) ?? "not queued",
    finalChatId: readString(entry.finalChatId) ?? "not configured",
    lastError: redactStatusText(readString(entry.lastError) ?? readString(entry.errorMessage) ?? "none"),
    updatedAt: readString(entry.updatedAt) ?? "unknown"
  }));
}


export function summarizeTelegramPublishQueue(rawQueue: unknown): Array<{ queueId: string; generatedOutputId: string; language: string; finalChatId: string; status: string; scheduledFor: string; priority: number; attemptCount: number; lastError: string; updatedAt: string }> {
  if (!Array.isArray(rawQueue)) return [];
  return rawQueue.filter(isRecord).map((entry) => ({
    queueId: readString(entry.queueId) ?? "unknown",
    generatedOutputId: readString(entry.generatedOutputId) ?? "unknown",
    language: readString(entry.language) ?? "unknown",
    finalChatId: readString(entry.finalChatId) ?? "not configured",
    status: readString(entry.status) ?? "unknown",
    scheduledFor: readString(entry.scheduledFor) ?? "not scheduled",
    priority: readNumber(entry.priority) ?? 0,
    attemptCount: readNumber(entry.attemptCount) ?? 0,
    lastError: redactStatusText(readString(entry.lastError) ?? "none"),
    updatedAt: readString(entry.updatedAt) ?? "unknown"
  }));
}

export function summarizeMediaJobs(rawJobs: unknown): Array<{ jobId: string; itemId: string; mediaAssetId: string; sourceUrl: string; status: string; errorMessage: string; updatedAt: string }> {
  if (!Array.isArray(rawJobs)) return [];
  return rawJobs.filter(isRecord).map((entry) => ({
    jobId: readString(entry.jobId) ?? "unknown",
    itemId: readString(entry.itemId) ?? "unknown",
    mediaAssetId: readString(entry.mediaAssetId) ?? "unknown",
    sourceUrl: readString(entry.sourceUrl) ?? "unknown",
    status: readString(entry.status) ?? "unknown",
    errorMessage: redactStatusText(readString(entry.errorMessage) ?? "none"),
    updatedAt: readString(entry.updatedAt) ?? "unknown"
  }));
}

function toRouteCard(route: Record<string, unknown>): TelegramRouteCard {
  const outputs = Array.isArray(route.outputs) ? route.outputs.filter(isRecord) : [];
  return {
    title: readString(route.category) ?? readString(route.id) ?? "Telegram route",
    category: readString(route.category) ?? "uncategorized",
    sourceChatId: readString(route.sourceChatId) ?? "missing",
    sourceThreadId: readNumber(route.sourceThreadId) ?? 0,
    promptProfile: readString(route.promptProfile) ?? "missing",
    enabledLabel: route.enabled === false ? "Disabled" : "Enabled",
    outputsCount: outputs.length,
    warnings: readStringArray(route.warnings),
    outputs: outputs.map((output) => ({
      title: `${readString(output.language) ?? "unknown"} output`,
      language: readString(output.language) ?? "unknown",
      reviewChatId: readString(output.reviewChatId) ?? "missing",
      reviewThreadId: readNumber(output.reviewThreadId) ?? 0,
      finalChatId: readString(output.finalChatId) ?? "missing",
      ...(readNumber(output.finalThreadId) === undefined ? {} : { finalThreadId: readNumber(output.finalThreadId)! }),
      enabledLabel: output.enabled === false ? "Disabled" : "Enabled",
      latestStatus: readString(output.latestStatus) ?? "not generated yet",
      publishEnabledLabel: output.publishEnabled === false ? "Disabled" : "Enabled",
      publishMode: readString(output.publishMode) ?? "scheduled",
      timezone: readString(output.timezone) ?? "UTC",
      allowedPublishWindows: readStringArray(output.allowedPublishWindows),
      minimumGapMinutes: readNumber(output.minimumGapMinutes) ?? 10,
      maxPostsPerHour: readNumber(output.maxPostsPerHour) ?? 4,
      maxPostsPerDay: readNumber(output.maxPostsPerDay) ?? 24,
      queuePriority: readNumber(output.queuePriority) ?? 0,
      signatureEnabled: readBoolean(output.signatureEnabled) ?? false,
      signatureText: readString(output.signatureText) ?? "",
      signatureChannelHandle: readString(output.signatureChannelHandle) ?? ""
    }))
  };
}

function redactStatusText(value: string): string {
  return value.split("bot").join("bot[redacted-prefix]").replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
