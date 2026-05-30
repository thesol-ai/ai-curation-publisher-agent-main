import type { NormalizedMedia } from "@curator/core";
import type { MediaProcessor } from "./processor";
import type { MediaPipelineAsset, MediaProcessorAssetInput, MediaProcessorCarouselInput } from "./types";

export type MockMediaProcessorOptions = {
  failSourceUrls?: string[];
};

export class MockMediaProcessor implements MediaProcessor {
  readonly preparedInputs: MediaProcessorAssetInput[] = [];
  readonly carouselInputs: MediaProcessorCarouselInput[] = [];
  readonly thumbnailInputs: MediaProcessorAssetInput[] = [];

  private readonly failSourceUrls: Set<string>;

  constructor(options: MockMediaProcessorOptions = {}) {
    this.failSourceUrls = new Set(options.failSourceUrls ?? []);
  }

  async prepareImage(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset> {
    this.preparedInputs.push(input);
    return this.createAsset(input, "image", "image/jpeg", "jpg");
  }

  async prepareVideo(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset> {
    this.preparedInputs.push(input);
    const prepared = this.createAsset(input, "video", "video/mp4", "mp4");
    const thumbnail = await this.generateThumbnail(input);
    return {
      ...prepared,
      thumbnail
    };
  }

  async prepareTelegramVideo(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset> {
    return this.prepareVideo(input);
  }

  async compressVideo(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset> {
    return this.prepareVideo(input);
  }

  async prepareCarousel(input: MediaProcessorCarouselInput): Promise<MediaPipelineAsset[]> {
    this.carouselInputs.push(input);
    const prepared: MediaPipelineAsset[] = [];

    for (let index = 0; index < input.media.length; index += 1) {
      const media = input.media[index];
      if (!media) {
        continue;
      }

      const processorInput: MediaProcessorAssetInput = {
        itemId: input.itemId,
        media,
        order: index,
        groupId: input.groupId
      };

      prepared.push(media.kind === "video" ? await this.prepareVideo(processorInput) : await this.prepareImage(processorInput));
    }

    return prepared;
  }

  async generateThumbnail(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset> {
    this.thumbnailInputs.push(input);
    return this.createAsset(input, "thumbnail", "image/jpeg", "jpg", "thumbnail");
  }

  private createAsset(
    input: MediaProcessorAssetInput,
    kind: MediaPipelineAsset["kind"],
    mimeType: string,
    extension: string,
    suffix = "prepared"
  ): MediaPipelineAsset {
    if (this.failSourceUrls.has(input.media.sourceUrl)) {
      return {
        id: createMockAssetId(input.itemId, input.order, kind, input.media.sourceUrl),
        itemId: input.itemId,
        kind,
        status: "failed",
        sourceUrl: input.media.sourceUrl,
        ...(input.media.canonicalUrl === undefined ? {} : { canonicalUrl: input.media.canonicalUrl }),
        order: input.order,
        ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
        errorMessage: "Mock media processing failure"
      };
    }

    const dimensions = extractDimensions(input.media);
    const storageKey = `mock-media/${input.itemId}/${input.order}-${kind}-${suffix}.${extension}`;

    return {
      id: createMockAssetId(input.itemId, input.order, kind, input.media.sourceUrl),
      itemId: input.itemId,
      kind,
      status: "ready",
      sourceUrl: input.media.sourceUrl,
      ...(input.media.canonicalUrl === undefined ? {} : { canonicalUrl: input.media.canonicalUrl }),
      localPath: `/tmp/${storageKey}`,
      storageKey,
      mimeType,
      sizeBytes: kind === "video" ? 2048000 : 204800,
      ...(input.media.durationSeconds === undefined ? {} : { durationSeconds: input.media.durationSeconds }),
      ...(dimensions.width === undefined ? {} : { width: dimensions.width }),
      ...(dimensions.height === undefined ? {} : { height: dimensions.height }),
      ...(input.groupId === undefined ? {} : { groupId: input.groupId }),
      order: input.order
    };
  }
}

function extractDimensions(media: NormalizedMedia): { width?: number; height?: number } {
  return {
    ...(media.width === undefined ? {} : { width: media.width }),
    ...(media.height === undefined ? {} : { height: media.height })
  };
}

function createMockAssetId(itemId: string, order: number, kind: string, sourceUrl: string): string {
  return `mock_asset_${stableHash(`${itemId}:${order}:${kind}:${sourceUrl}`)}`;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
