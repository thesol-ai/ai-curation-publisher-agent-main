import { describe, expect, it } from "vitest";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "../client";
import { MediaAssetsRepository, type MediaAssetRecord } from "./media-assets.repository";

type StoredMediaAsset = {
  id: string;
  item_id: string;
  kind: string;
  status: MediaAssetRecord["status"];
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
  created_at: string;
  updated_at: string;
};

class FakeStatement implements D1PreparedStatementLike {
  private values: D1Value[] = [];

  constructor(private readonly db: FakeDb, private readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    if (this.query.includes("FROM media_assets WHERE item_id")) {
      const itemId = String(this.values[0]);
      return {
        success: true,
        results: this.db.assets.filter((asset) => asset.item_id === itemId) as T[]
      };
    }

    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    if (this.query.includes("INSERT OR REPLACE INTO media_assets")) {
      const asset: StoredMediaAsset = {
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        kind: String(this.values[2]),
        status: this.values[3] as MediaAssetRecord["status"],
        source_url: String(this.values[4]),
        canonical_url: this.values[5] === null ? null : String(this.values[5]),
        media_url_hash: this.values[6] === null ? null : String(this.values[6]),
        r2_key: this.values[7] === null ? null : String(this.values[7]),
        public_url: this.values[8] === null ? null : String(this.values[8]),
        size_bytes: this.values[9] === null ? null : Number(this.values[9]),
        mime_type: this.values[10] === null ? null : String(this.values[10]),
        width: this.values[11] === null ? null : Number(this.values[11]),
        height: this.values[12] === null ? null : Number(this.values[12]),
        duration_seconds: this.values[13] === null ? null : Number(this.values[13]),
        error_message: this.values[14] === null ? null : String(this.values[14]),
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString()
      };

      const existingIndex = this.db.assets.findIndex((candidate) => candidate.id === asset.id);
      if (existingIndex >= 0) {
        this.db.assets[existingIndex] = asset;
      } else {
        this.db.assets.push(asset);
      }
    }

    if (this.query.includes("UPDATE media_assets SET status")) {
      const status = this.values[0] as MediaAssetRecord["status"];
      const errorMessage = this.values[1] === null ? null : String(this.values[1]);
      const id = String(this.values[2]);
      const asset = this.db.assets.find((candidate) => candidate.id === id);

      if (asset) {
        asset.status = status;
        asset.error_message = errorMessage;
        asset.updated_at = new Date(1).toISOString();
      }
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  readonly assets: StoredMediaAsset[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

describe("MediaAssetsRepository", () => {
  it("creates and finds media assets by item ID", async () => {
    const db = new FakeDb();
    const repository = new MediaAssetsRepository(db);

    await repository.createMany([
      {
        id: "asset_1",
        itemId: "item_local",
        kind: "image",
        status: "ready",
        sourceUrl: "https://source.local/image.png",
        canonicalUrl: "https://source.local/image.png",
          sizeBytes: 2048,
        mimeType: "image/png",
        width: 1200,
        height: 800
      },
      {
        id: "asset_2",
        itemId: "item_local",
        kind: "video",
        status: "failed",
        sourceUrl: "https://source.local/video.mp4",
        durationSeconds: 30,
        errorMessage: "mock failure"
      }
    ]);

    const assets = await repository.findByItemId("item_local");

    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      id: "asset_1",
      itemId: "item_local",
      kind: "image",
      status: "ready",
      sourceUrl: "https://source.local/image.png",
      sizeBytes: 2048,
      mimeType: "image/png",
      width: 1200,
      height: 800
    });
    expect(assets[1]).toMatchObject({
      id: "asset_2",
      kind: "video",
      status: "failed",
      durationSeconds: 30,
      errorMessage: "mock failure"
    });
  });

  it("updates media asset status", async () => {
    const db = new FakeDb();
    const repository = new MediaAssetsRepository(db);

    await repository.createMany([
      {
        id: "asset_1",
        itemId: "item_local",
        kind: "image",
        sourceUrl: "https://source.local/image.png"
      }
    ]);

    await repository.updateStatus("asset_1", "failed", "processing failed");
    const assets = await repository.findByItemId("item_local");

    expect(assets[0]?.status).toBe("failed");
    expect(assets[0]?.errorMessage).toBe("processing failed");
  });
});
