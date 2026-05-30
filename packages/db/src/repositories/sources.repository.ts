import type { Source } from "@curator/core";
import type { D1DatabaseLike } from "../client";

export class SourcesRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: string): Promise<Source | null> {
    return this.db.prepare("SELECT * FROM sources WHERE id = ?").bind(id).first<Source>();
  }

  async listActive(): Promise<Source[]> {
    const result = await this.db.prepare("SELECT * FROM sources WHERE status = 'active'").all<Source>();
    return result.results ?? [];
  }

  async ensureManualTelegramSource(): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO sources (id, platform, source_type, value, status, provider_priority_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      "manual_telegram",
      "manual",
      "manual",
      "telegram_manual_input",
      "active",
      JSON.stringify(["mock_social_provider"])
    ).run();
  }

  async ensureApifyCurationSource(): Promise<void> {
    await this.db.prepare(
      `INSERT OR IGNORE INTO sources (id, platform, source_type, value, status, provider_priority_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      "apify_curation",
      "web",
      "profile",
      "apify_claude_curation_pipeline",
      "active",
      JSON.stringify(["apify_instagram", "apify_x", "simple_extractor"])
    ).run();
  }

  async updateWatermark(): Promise<never> {
    throw new Error("SourcesRepository.updateWatermark is intentionally deferred beyond Phase 2");
  }
}
