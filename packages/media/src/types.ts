import type { NormalizedMedia } from "@curator/core";

export const MEDIA_PIPELINE_KINDS = ["image", "video", "thumbnail", "carousel"] as const;
export type MediaPipelineKind = typeof MEDIA_PIPELINE_KINDS[number];

export const MEDIA_PROCESSING_STATUSES = ["pending", "ready", "failed", "skipped"] as const;
export type MediaProcessingStatus = typeof MEDIA_PROCESSING_STATUSES[number];

export type MediaDimensions = {
  width?: number;
  height?: number;
};

export type MediaPipelineAsset = {
  id: string;
  itemId: string;
  kind: MediaPipelineKind;
  status: MediaProcessingStatus;
  sourceUrl: string;
  canonicalUrl?: string;
  localPath?: string;
  storageKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  groupId?: string;
  order: number;
  thumbnail?: MediaPipelineAsset;
  errorMessage?: string;
};

export type MediaCarouselGroup = {
  itemId: string;
  groupId: string;
  assets: MediaPipelineAsset[];
};

export type MediaProcessorAssetInput = {
  itemId: string;
  media: NormalizedMedia;
  order: number;
  groupId?: string;
};

export type MediaProcessorCarouselInput = {
  itemId: string;
  media: NormalizedMedia[];
  groupId: string;
};

export type MediaPreparationStatus = "ready" | "partial" | "failed" | "skipped";

export type MediaPreparationResult = {
  itemId: string;
  status: MediaPreparationStatus;
  preparedAssets: MediaPipelineAsset[];
  failedAssets: MediaPipelineAsset[];
  groups: MediaCarouselGroup[];
  warnings: string[];
};

export type MediaPreparationInput = {
  itemId: string;
  media: NormalizedMedia[];
};
