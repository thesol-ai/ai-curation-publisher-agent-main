import type { MediaPipelineAsset, MediaProcessorAssetInput, MediaProcessorCarouselInput } from "./types";

export interface MediaProcessor {
  prepareImage(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset>;
  prepareVideo(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset>;
  prepareCarousel(input: MediaProcessorCarouselInput): Promise<MediaPipelineAsset[]>;
  generateThumbnail(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset>;
  prepareTelegramVideo(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset>;
  compressVideo?(input: MediaProcessorAssetInput): Promise<MediaPipelineAsset>;
}
