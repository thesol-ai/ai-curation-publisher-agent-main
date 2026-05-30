import type { D1DatabaseLike } from "../client";

export const MEDIA_PROCESSING_JOB_STATUSES = ["pending", "dispatching", "dispatched", "processing", "ready", "failed", "skipped"] as const;
export type MediaProcessingJobStatus = typeof MEDIA_PROCESSING_JOB_STATUSES[number];

export type MediaProcessingJobRecord = {
  id: string;
  itemId: string;
  mediaAssetId?: string;
  sourceUrl: string;
  kind: string;
  processor: string;
  status: MediaProcessingJobStatus;
  requestedBy?: string;
  workflowRunId?: string;
  output: Record<string, unknown>;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateMediaProcessingJobInput = {
  id?: string;
  itemId: string;
  mediaAssetId?: string;
  sourceUrl: string;
  kind?: string;
  processor?: string;
  requestedBy?: string;
  status?: MediaProcessingJobStatus;
};

type MediaProcessingJobRow = {
  id: string;
  item_id: string;
  media_asset_id?: string | null;
  source_url: string;
  kind?: string | null;
  processor: string;
  status: MediaProcessingJobStatus;
  requested_by: string | null;
  workflow_run_id: string | null;
  output_json: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export class MediaProcessingJobsRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async create(input: CreateMediaProcessingJobInput): Promise<MediaProcessingJobRecord> {
    const id = input.id ?? createMediaProcessingJobId(input.itemId, input.sourceUrl, input.mediaAssetId);
    const now = new Date().toISOString();
    await this.db.prepare(
      `INSERT OR IGNORE INTO media_processing_jobs (id, item_id, media_asset_id, source_url, kind, processor, status, requested_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      input.itemId,
      input.mediaAssetId ?? null,
      input.sourceUrl,
      input.kind ?? "video",
      input.processor ?? "github_actions",
      input.status ?? "pending",
      input.requestedBy ?? null,
      now,
      now
    ).run();
    const existing = await this.findById(id);
    if (existing) return existing;
    return {
      id,
      itemId: input.itemId,
      ...(input.mediaAssetId === undefined ? {} : { mediaAssetId: input.mediaAssetId }),
      sourceUrl: input.sourceUrl,
      kind: input.kind ?? "video",
      processor: input.processor ?? "github_actions",
      status: input.status ?? "pending",
      ...(input.requestedBy === undefined ? {} : { requestedBy: input.requestedBy }),
      output: {},
      createdAt: now,
      updatedAt: now
    };
  }

  async findById(id: string): Promise<MediaProcessingJobRecord | null> {
    const row = await this.db.prepare("SELECT * FROM media_processing_jobs WHERE id = ? LIMIT 1").bind(id).first<MediaProcessingJobRow>();
    return row ? toRecord(row) : null;
  }

  async findByMediaAssetId(mediaAssetId: string): Promise<MediaProcessingJobRecord | null> {
    const row = await this.db.prepare("SELECT * FROM media_processing_jobs WHERE media_asset_id = ? ORDER BY updated_at DESC LIMIT 1")
      .bind(mediaAssetId)
      .first<MediaProcessingJobRow>();
    return row ? toRecord(row) : null;
  }

  async listByItemId(itemId: string): Promise<MediaProcessingJobRecord[]> {
    const result = await this.db.prepare("SELECT * FROM media_processing_jobs WHERE item_id = ? ORDER BY created_at ASC")
      .bind(itemId)
      .all<MediaProcessingJobRow>();
    return (result.results ?? []).map(toRecord);
  }

  async listRecent(limit = 25, status?: MediaProcessingJobStatus): Promise<MediaProcessingJobRecord[]> {
    const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 100));
    const sql = status === undefined
      ? "SELECT * FROM media_processing_jobs ORDER BY updated_at DESC, created_at DESC LIMIT ?"
      : "SELECT * FROM media_processing_jobs WHERE status = ? ORDER BY updated_at DESC, created_at DESC LIMIT ?";
    const result = status === undefined
      ? await this.db.prepare(sql).bind(cappedLimit).all<MediaProcessingJobRow>()
      : await this.db.prepare(sql).bind(status, cappedLimit).all<MediaProcessingJobRow>();
    return (result.results ?? []).map(toRecord);
  }


  async markDispatching(id: string): Promise<void> {
    await this.updateStatus(id, "dispatching");
  }

  async markDispatched(id: string, workflowRunId?: string): Promise<void> {
    await this.db.prepare("UPDATE media_processing_jobs SET status = 'dispatched', workflow_run_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(workflowRunId ?? null, id)
      .run();
  }

  async markProcessing(id: string, output: Record<string, unknown> = {}): Promise<void> {
    await this.db.prepare("UPDATE media_processing_jobs SET status = 'processing', output_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(await this.mergeOutput(id, output)), id)
      .run();
  }

  async markReady(id: string, output: Record<string, unknown> = {}): Promise<void> {
    await this.db.prepare("UPDATE media_processing_jobs SET status = 'ready', output_json = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(await this.mergeOutput(id, output)), id)
      .run();
  }

  async markFailed(id: string, errorMessage: string, output: Record<string, unknown> = {}): Promise<void> {
    await this.db.prepare("UPDATE media_processing_jobs SET status = 'failed', output_json = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(await this.mergeOutput(id, output)), errorMessage, id)
      .run();
  }

  async markSkipped(id: string, message: string, output: Record<string, unknown> = {}): Promise<void> {
    await this.db.prepare("UPDATE media_processing_jobs SET status = 'skipped', output_json = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(JSON.stringify(await this.mergeOutput(id, output)), message, id)
      .run();
  }

  private async updateStatus(id: string, status: MediaProcessingJobStatus): Promise<void> {
    await this.db.prepare("UPDATE media_processing_jobs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(status, id)
      .run();
  }

  private async mergeOutput(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const current = await this.findById(id);
    return { ...(current?.output ?? {}), ...patch };
  }
}

export function createMediaProcessingJobId(itemId: string, sourceUrl: string, mediaAssetId?: string): string {
  return `mediajob_${stableHash(`${itemId}:${mediaAssetId ?? "none"}:${sourceUrl}`)}`;
}

function toRecord(row: MediaProcessingJobRow): MediaProcessingJobRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    ...(row.media_asset_id === undefined || row.media_asset_id === null ? {} : { mediaAssetId: row.media_asset_id }),
    sourceUrl: row.source_url,
    kind: row.kind ?? "video",
    processor: row.processor,
    status: row.status,
    ...(row.requested_by === null ? {} : { requestedBy: row.requested_by }),
    ...(row.workflow_run_id === null ? {} : { workflowRunId: row.workflow_run_id }),
    output: parseOutput(row.output_json),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseOutput(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
