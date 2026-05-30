import type { Source } from "@curator/core";
import type { PollingOptions, SourcePollResult, SourcePollerService } from "./source-poller.service";

export type BatchPollResult = {
  startedAt: string;
  finishedAt: string;
  totalSources: number;
  successfulSources: number;
  failedSources: number;
  totalReturned: number;
  totalQueued: number;
  totalDuplicates: number;
  totalInvalid: number;
  totalErrors: number;
  sourceResults: SourcePollResult[];
};

export type BatchPollerOptions = {
  now?: () => Date;
};

export class BatchPollerService {
  private readonly now: () => Date;

  constructor(
    private readonly sourcePoller: SourcePollerService,
    options: BatchPollerOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async pollSources(sources: Source[], options: PollingOptions = {}): Promise<BatchPollResult> {
    const startedAt = this.now().toISOString();
    const sourceResults: SourcePollResult[] = [];

    for (const source of sources) {
      try {
        sourceResults.push(await this.sourcePoller.pollSource(source, options));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown batch polling failure";
        const timestamp = this.now().toISOString();
        sourceResults.push({
          sourceId: source.id,
          platform: source.platform,
          sourceType: source.sourceType,
          providerAttempts: [],
          returnedCount: 0,
          normalizedCount: 0,
          queuedCount: 0,
          duplicateCount: 0,
          invalidCount: 0,
          failedCount: 1,
          errors: [message],
          startedAt: timestamp,
          finishedAt: timestamp,
          posts: [],
          sourceState: {
            lastError: message
          }
        });
      }
    }

    return {
      startedAt,
      finishedAt: this.now().toISOString(),
      totalSources: sources.length,
      successfulSources: sourceResults.filter((result) => result.failedCount === 0 && result.errors.length === 0).length,
      failedSources: sourceResults.filter((result) => result.failedCount > 0 || result.errors.length > 0).length,
      totalReturned: sum(sourceResults, "returnedCount"),
      totalQueued: sum(sourceResults, "queuedCount"),
      totalDuplicates: sum(sourceResults, "duplicateCount"),
      totalInvalid: sum(sourceResults, "invalidCount"),
      totalErrors: sourceResults.reduce((total, result) => total + result.errors.length, 0),
      sourceResults
    };
  }
}

function sum(results: SourcePollResult[], key: "returnedCount" | "queuedCount" | "duplicateCount" | "invalidCount"): number {
  return results.reduce((total, result) => total + result[key], 0);
}
