import type { NormalizedMedia } from "./media";
import type { Platform, ProviderId, SourceType } from "./platform";
import type { ItemStatus } from "./lifecycle";

export type NormalizedPost = {
  provider: ProviderId;
  platform: Platform;
  sourceType: SourceType;
  sourcePostId?: string;
  canonicalUrl: string;
  publishedAt?: string;
  authorHandle?: string;
  text?: string;
  links: string[];
  media: NormalizedMedia[];
  rawPayload: unknown;
};

export type Item = {
  id: string;
  sourceId: string;
  provider: ProviderId;
  platform: Platform;
  sourceType: SourceType;
  sourcePostId?: string;
  canonicalUrl: string;
  canonicalUrlHash: string;
  normalizedTextHash?: string;
  status: ItemStatus;
  publishedAt?: string;
  authorHandle?: string;
  text?: string;
  links: string[];
  rawPayload: unknown;
  createdAt: string;
  updatedAt: string;
};
