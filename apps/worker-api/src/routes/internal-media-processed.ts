import { MediaAssetsRepository } from "@curator/db";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, serverError, unauthorized } from "./response";
import type { Env } from "../types";

type ProcessedAssetBody = {
  kind?: unknown;
  sourceUrl?: unknown;
  canonicalUrl?: unknown;
  telegramFileId?: unknown;
  telegramFileUniqueId?: unknown;
  telegramFileType?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  width?: unknown;
  height?: unknown;
  durationSeconds?: unknown;
  fileName?: unknown;
};

type MediaProcessedBody = {
  itemId?: unknown;
  sourceUrl?: unknown;
  ok?: unknown;
  error?: unknown;
  assets?: unknown;
};

export async function handleInternalMediaProcessed(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"], request);
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) return unauthorized(auth.error, "Internal API authorization failed.", request);

  const parsed = await parseJsonBody<MediaProcessedBody>(request);
  if (!parsed.ok) return parsed.response;

  const itemId = readNonEmptyString(parsed.value.itemId);
  if (!itemId) return badRequest("invalid_media_callback", "itemId is required.", request);

  const sourceUrl = readNonEmptyString(parsed.value.sourceUrl) ?? "external-media";
  const repository = new MediaAssetsRepository(env.DB);

  try {
    if (parsed.value.ok === false || readNonEmptyString(parsed.value.error)) {
      const errorMessage = readNonEmptyString(parsed.value.error) ?? "External media processing failed.";
      await repository.createMany([{ id: `external_media_failed_${stableHash(`${itemId}:${sourceUrl}`)}`, itemId, kind: "link_preview", status: "failed", sourceUrl, canonicalUrl: sourceUrl, errorMessage }]);
      return jsonResponse({ ok: true, stored: 0, failed: 1, message: errorMessage });
    }

    const assets = Array.isArray(parsed.value.assets) ? parsed.value.assets : [];
    if (assets.length === 0) return badRequest("invalid_media_callback", "assets must be a non-empty array unless ok=false.", request);

    const normalized = assets.map((asset, index) => normalizeAsset(asset as ProcessedAssetBody, itemId, sourceUrl, index));
    const invalid = normalized.find((asset) => asset === undefined);
    if (invalid === undefined && normalized.some((asset) => asset === undefined)) {
      return badRequest("invalid_media_asset", "Every asset needs kind and telegramFileId.", request);
    }
    const safeAssets = normalized.filter((asset): asset is NonNullable<typeof asset> => asset !== undefined);
    if (safeAssets.length === 0) return badRequest("invalid_media_asset", "No valid media assets were provided.", request);
    await repository.createMany(safeAssets);
    return jsonResponse({ ok: true, stored: safeAssets.length, itemId });
  } catch (error) {
    return serverError("media_processed_store_failed", error instanceof Error ? error.message : "Media callback failed.", request);
  }
}

function normalizeAsset(asset: ProcessedAssetBody, itemId: string, fallbackSourceUrl: string, index: number) {
  const telegramFileId = readNonEmptyString(asset.telegramFileId);
  const telegramFileType = readTelegramFileType(asset.telegramFileType) ?? inferTelegramFileType(asset.kind, asset.mimeType);
  const sourceUrl = readNonEmptyString(asset.sourceUrl) ?? fallbackSourceUrl;
  if (!telegramFileId || !telegramFileType) return undefined;
  return {
    id: `external_media_ready_${stableHash(`${itemId}:${telegramFileId}:${index}`)}`,
    itemId,
    kind: toMediaAssetKind(telegramFileType),
    status: "ready" as const,
    sourceUrl,
    canonicalUrl: readNonEmptyString(asset.canonicalUrl) ?? sourceUrl,
    telegramFileId,
    telegramFileType,
    ...(readNonEmptyString(asset.telegramFileUniqueId) === undefined ? {} : { telegramFileUniqueId: readNonEmptyString(asset.telegramFileUniqueId)! }),
    ...(readNonEmptyString(asset.mimeType) === undefined ? {} : { mimeType: readNonEmptyString(asset.mimeType)!, telegramMimeType: readNonEmptyString(asset.mimeType)! }),
    ...(readNumber(asset.sizeBytes) === undefined ? {} : { sizeBytes: readNumber(asset.sizeBytes)!, telegramFileSize: readNumber(asset.sizeBytes)! }),
    ...(readNumber(asset.width) === undefined ? {} : { width: readNumber(asset.width)! }),
    ...(readNumber(asset.height) === undefined ? {} : { height: readNumber(asset.height)! }),
    ...(readNumber(asset.durationSeconds) === undefined ? {} : { durationSeconds: readNumber(asset.durationSeconds)! })
  };
}

function readTelegramFileType(value: unknown): "photo" | "video" | "animation" | "document" | undefined {
  return value === "photo" || value === "video" || value === "animation" || value === "document" ? value : undefined;
}

function inferTelegramFileType(kind: unknown, mimeType: unknown): "photo" | "video" | "document" | undefined {
  if (kind === "photo" || kind === "image") return "photo";
  if (kind === "video") return "video";
  if (typeof mimeType === "string" && mimeType.startsWith("image/")) return "photo";
  if (typeof mimeType === "string" && mimeType.startsWith("video/")) return "video";
  return "document";
}

function toMediaAssetKind(value: "photo" | "video" | "animation" | "document"): string {
  if (value === "photo") return "image";
  if (value === "video" || value === "animation") return "video";
  return "link_preview";
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
