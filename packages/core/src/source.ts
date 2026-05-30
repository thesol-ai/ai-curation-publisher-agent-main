import type { Platform, ProviderId, SourceType } from "./platform";

export const SOURCE_STATUSES = ["active", "paused", "unhealthy", "archived"] as const;
export type SourceStatus = typeof SOURCE_STATUSES[number];

export type SourceWatermark = {
  lastSeenPostId?: string;
  lastSeenAt?: string;
  providerCursor?: string;
  lastSuccessfulPollAt?: string;
};

export type Source = {
  id: string;
  platform: Platform;
  sourceType: SourceType;
  value: string;
  providerPriority: ProviderId[];
  status: SourceStatus;
  watermark: SourceWatermark;
  settings?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FetchSourceInput = {
  source: Source;
  limit: number;
  cursor?: string;
  since?: string;
};
