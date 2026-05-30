export const MEDIA_KINDS = ["image", "video", "carousel", "thumbnail", "link_preview"] as const;
export type MediaKind = typeof MEDIA_KINDS[number];

export const MEDIA_ASSET_STATUSES = ["pending", "ready", "failed", "fallback_used"] as const;
export type MediaAssetStatus = typeof MEDIA_ASSET_STATUSES[number];

export type NormalizedMedia = {
  kind: MediaKind;
  sourceUrl: string;
  canonicalUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  altText?: string;
};

export type MediaAsset = {
  id: string;
  itemId: string;
  kind: MediaKind;
  status: MediaAssetStatus;
  sourceUrl: string;
  canonicalUrl?: string;
  r2Key?: string;
  publicUrl?: string;
  sizeBytes?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};
