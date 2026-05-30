import { TelegramPublishQueueRepository } from "@curator/db";
import type { Env } from "../types";
import { publishTelegramQueueItem, type TelegramQueuePublishResult } from "../telegram-topic-workflow/publish-runner";

export type TelegramPublishDueResult = {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  finalPublishingEnabled: boolean;
  dueCount: number;
  checkedCount: number;
  publishedCount: number;
  skippedCount: number;
  failedCount: number;
  results: TelegramQueuePublishResult[];
  startedAt: string;
  finishedAt: string;
};

type EnvWithTelegramPublish = Env & {
  TELEGRAM_FINAL_PUBLISH_ENABLED?: string;
  TELEGRAM_PUBLISH_DUE_LIMIT?: string;
};

export async function runTelegramPublishDueOperation(env: Env, options: { limit?: number; now?: Date } = {}): Promise<TelegramPublishDueResult> {
  const startedAt = new Date().toISOString();
  const finalPublishingEnabled = (env as EnvWithTelegramPublish).TELEGRAM_FINAL_PUBLISH_ENABLED === "true";
  if (!finalPublishingEnabled) {
    return {
      ok: true,
      skipped: true,
      reason: "final_publishing_disabled",
      finalPublishingEnabled,
      dueCount: 0,
      checkedCount: 0,
      publishedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      results: [],
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  const repository = new TelegramPublishQueueRepository(env.DB);
  const limit = options.limit ?? readPositiveInteger((env as EnvWithTelegramPublish).TELEGRAM_PUBLISH_DUE_LIMIT, 5);
  const due = await repository.listDue((options.now ?? new Date()).toISOString(), limit);
  const results: TelegramQueuePublishResult[] = [];
  const processedTargets = new Set<string>();

  for (const queueItem of due) {
    const targetKey = `${queueItem.finalChatId}:${queueItem.finalThreadId ?? "main"}`;
    if (processedTargets.has(targetKey)) {
      results.push({
        ok: true,
        queueId: queueItem.id,
        generatedOutputId: queueItem.generatedOutputId,
        status: "skipped",
        message: "Skipped this run to preserve one publish per final channel/topic per scheduler tick."
      });
      continue;
    }
    processedTargets.add(targetKey);
    results.push(await publishTelegramQueueItem({ env, queueItem }));
  }

  return {
    ok: results.every((result) => result.ok),
    skipped: false,
    finalPublishingEnabled,
    dueCount: due.length,
    checkedCount: results.length,
    publishedCount: results.filter((result) => result.status === "published").length,
    skippedCount: results.filter((result) => result.status === "skipped").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    results,
    startedAt,
    finishedAt: new Date().toISOString()
  };
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25) : fallback;
}
