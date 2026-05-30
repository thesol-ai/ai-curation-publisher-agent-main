import type { D1DatabaseLike } from "../client";

export type MediaAssetStatus = "pending" | "processing" | "ready" | "failed" | "skipped";

export type MediaAssetRecord = {
  id: string;
  itemId: string;
  kind: string;
  status: MediaAssetStatus;
  sourceUrl: string;
  canonicalUrl?: string;
  mediaUrlHash?: string;
  r2Key?: string;
  publicUrl?: string;
  sizeBytes?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  errorMessage?: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  telegramMediaGroupId?: string;
  telegramFileType?: string;
  telegramMimeType?: string;
  telegramFileSize?: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateMediaAssetInput = {
  id: string;
  itemId: string;
  kind: string;
  status?: MediaAssetStatus;
  sourceUrl: string;
  canonicalUrl?: string;
  storageKey?: string;
  r2Key?: string;
  publicUrl?: string;
  sizeBytes?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  errorMessage?: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  telegramMediaGroupId?: string;
  telegramFileType?: string;
  telegramMimeType?: string;
  telegramFileSize?: number;
};

export type UpdateTelegramMediaInput = {
  id: string;
  status?: MediaAssetStatus;
  kind?: string;
  errorMessage?: string;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  telegramMediaGroupId?: string;
  telegramFileType?: string;
  telegramMimeType?: string;
  telegramFileSize?: number;
  sizeBytes?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  publicUrl?: string;
  storageKey?: string;
};

export class MediaAssetsRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async createMany(assets: CreateMediaAssetInput[]): Promise<void> {
    for (const asset of assets) {
      await this.createAsset(asset);
    }
  }

  async findById(id: string): Promise<MediaAssetRecord | null> {
    const row = await this.db.prepare("SELECT * FROM media_assets WHERE id = ? LIMIT 1").bind(id).first<MediaAssetRow>();
    return row ? toMediaAssetRecord(row) : null;
  }

  async findByItemId(itemId: string): Promise<MediaAssetRecord[]> {
    const result = await this.db
      .prepare("SELECT * FROM media_assets WHERE item_id = ? ORDER BY created_at ASC")
      .bind(itemId)
      .all<MediaAssetRow>();

    return (result.results ?? []).map(toMediaAssetRecord);
  }

  async updateStatus(id: string, status: MediaAssetStatus, errorMessage?: string): Promise<void> {
    await this.db
      .prepare("UPDATE media_assets SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, errorMessage ?? null, id)
      .run();
  }

  async updateTelegramMetadata(input: UpdateTelegramMediaInput): Promise<void> {
    await this.completeTelegramProcessing(input);
  }

  async completeTelegramProcessing(input: UpdateTelegramMediaInput): Promise<void> {
    await this.db.prepare(
      `UPDATE media_assets
       SET status = COALESCE(?, status),
           kind = COALESCE(?, kind),
           error_message = ?,
           telegram_file_id = COALESCE(?, telegram_file_id),
           telegram_file_unique_id = COALESCE(?, telegram_file_unique_id),
           telegram_media_group_id = COALESCE(?, telegram_media_group_id),
           telegram_file_type = COALESCE(?, telegram_file_type),
           telegram_mime_type = COALESCE(?, telegram_mime_type),
           telegram_file_size = COALESCE(?, telegram_file_size),
           size_bytes = COALESCE(?, size_bytes),
           mime_type = COALESCE(?, mime_type),
           width = COALESCE(?, width),
           height = COALESCE(?, height),
           duration_seconds = COALESCE(?, duration_seconds),
           public_url = COALESCE(?, public_url),
           r2_key = COALESCE(?, r2_key),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      input.status ?? null,
      input.kind ?? null,
      input.errorMessage ?? null,
      input.telegramFileId ?? null,
      input.telegramFileUniqueId ?? null,
      input.telegramMediaGroupId ?? null,
      input.telegramFileType ?? null,
      input.telegramMimeType ?? null,
      input.telegramFileSize ?? null,
      input.sizeBytes ?? null,
      input.mimeType ?? null,
      input.width ?? null,
      input.height ?? null,
      input.durationSeconds ?? null,
      input.publicUrl ?? null,
      input.storageKey ?? null,
      input.id
    ).run();
  }

  private async createAsset(asset: CreateMediaAssetInput): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO media_assets (id, item_id, kind, status, source_url, canonical_url, media_url_hash, r2_key, public_url, size_bytes, mime_type, width, height, duration_seconds, error_message, telegram_file_id, telegram_file_unique_id, telegram_media_group_id, telegram_file_type, telegram_mime_type, telegram_file_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(
      asset.id,
      asset.itemId,
      asset.kind,
      asset.status ?? "pending",
      asset.sourceUrl,
      asset.canonicalUrl ?? null,
      stableHash(asset.canonicalUrl ?? asset.sourceUrl),
      asset.r2Key ?? asset.storageKey ?? null,
      asset.publicUrl ?? null,
      asset.sizeBytes ?? null,
      asset.mimeType ?? null,
      asset.width ?? null,
      asset.height ?? null,
      asset.durationSeconds ?? null,
      asset.errorMessage ?? null,
      asset.telegramFileId ?? null,
      asset.telegramFileUniqueId ?? null,
      asset.telegramMediaGroupId ?? null,
      asset.telegramFileType ?? null,
      asset.telegramMimeType ?? null,
      asset.telegramFileSize ?? null
    ).run();
  }
}

type MediaAssetRow = {
  id: string;
  item_id: string;
  kind: string;
  status: MediaAssetStatus;
  source_url: string;
  canonical_url: string | null;
  media_url_hash: string | null;
  r2_key: string | null;
  public_url: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  error_message: string | null;
  telegram_file_id?: string | null;
  telegram_file_unique_id?: string | null;
  telegram_media_group_id?: string | null;
  telegram_file_type?: string | null;
  telegram_mime_type?: string | null;
  telegram_file_size?: number | null;
  created_at: string;
  updated_at: string;
};

function toMediaAssetRecord(row: MediaAssetRow): MediaAssetRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    kind: row.kind,
    status: row.status,
    sourceUrl: row.source_url,
    ...(row.canonical_url === null ? {} : { canonicalUrl: row.canonical_url }),
    ...(row.media_url_hash === null ? {} : { mediaUrlHash: row.media_url_hash }),
    ...(row.r2_key === null ? {} : { r2Key: row.r2_key }),
    ...(row.public_url === null ? {} : { publicUrl: row.public_url }),
    ...(row.size_bytes === null ? {} : { sizeBytes: row.size_bytes }),
    ...(row.mime_type === null ? {} : { mimeType: row.mime_type }),
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.duration_seconds === null ? {} : { durationSeconds: row.duration_seconds }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    ...(row.telegram_file_id === undefined || row.telegram_file_id === null ? {} : { telegramFileId: row.telegram_file_id }),
    ...(row.telegram_file_unique_id === undefined || row.telegram_file_unique_id === null ? {} : { telegramFileUniqueId: row.telegram_file_unique_id }),
    ...(row.telegram_media_group_id === undefined || row.telegram_media_group_id === null ? {} : { telegramMediaGroupId: row.telegram_media_group_id }),
    ...(row.telegram_file_type === undefined || row.telegram_file_type === null ? {} : { telegramFileType: row.telegram_file_type }),
    ...(row.telegram_mime_type === undefined || row.telegram_mime_type === null ? {} : { telegramMimeType: row.telegram_mime_type }),
    ...(row.telegram_file_size === undefined || row.telegram_file_size === null ? {} : { telegramFileSize: row.telegram_file_size }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
