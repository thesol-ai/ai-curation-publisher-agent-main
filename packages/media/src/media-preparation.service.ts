import type { NormalizedMedia } from "@curator/core";
import type { MediaProcessor } from "./processor";
import type { MediaCarouselGroup, MediaPipelineAsset, MediaPreparationInput, MediaPreparationResult } from "./types";

export class MediaPreparationService {
  constructor(private readonly processor: MediaProcessor) {}

  async prepare(input: MediaPreparationInput): Promise<MediaPreparationResult> {
    const media = input.media.filter((asset) => asset.sourceUrl.trim().length > 0);
    const warnings: string[] = [];

    if (media.length !== input.media.length) {
      warnings.push("Skipped media entries with empty source URLs.");
    }

    if (media.length === 0) {
      return {
        itemId: input.itemId,
        status: "skipped",
        preparedAssets: [],
        failedAssets: [],
        groups: [],
        warnings
      };
    }

    const groupId = createMediaGroupId(input.itemId);
    const preparedAssets = media.length > 1
      ? await this.processor.prepareCarousel({ itemId: input.itemId, media, groupId })
      : [await this.prepareSingle(input.itemId, media[0], 0, groupId)];

    const readyAssets = preparedAssets.filter((asset) => asset.status === "ready");
    const failedAssets = preparedAssets.filter((asset) => asset.status === "failed");
    const groups: MediaCarouselGroup[] = readyAssets.length === 0 ? [] : [{ itemId: input.itemId, groupId, assets: readyAssets }];

    return {
      itemId: input.itemId,
      status: resolvePreparationStatus(readyAssets, failedAssets),
      preparedAssets: readyAssets,
      failedAssets,
      groups,
      warnings
    };
  }

  private async prepareSingle(itemId: string, media: NormalizedMedia | undefined, order: number, groupId: string): Promise<MediaPipelineAsset> {
    if (!media) {
      return {
        id: `skipped_${itemId}_${order}`,
        itemId,
        kind: "image",
        status: "skipped",
        sourceUrl: "",
        order,
        groupId,
        errorMessage: "Missing media input"
      };
    }

    if (media.kind === "video") {
      return this.processor.prepareTelegramVideo({ itemId, media, order, groupId });
    }

    return this.processor.prepareImage({ itemId, media, order, groupId });
  }
}

function resolvePreparationStatus(readyAssets: MediaPipelineAsset[], failedAssets: MediaPipelineAsset[]): MediaPreparationResult["status"] {
  if (readyAssets.length === 0 && failedAssets.length === 0) {
    return "skipped";
  }

  if (readyAssets.length === 0) {
    return "failed";
  }

  if (failedAssets.length > 0) {
    return "partial";
  }

  return "ready";
}

function createMediaGroupId(itemId: string): string {
  return `media_group_${stableHash(itemId)}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
