import type { Item, ItemStatus, NormalizedPost } from "@curator/core";
import type { D1DatabaseLike } from "../client";

export type CreateItemFromNormalizedPostInput = {
  sourceId: string;
  status?: ItemStatus;
  post: NormalizedPost;
};

export class ItemsRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findById(id: string): Promise<Item | null> {
    return this.db.prepare("SELECT * FROM items WHERE id = ?").bind(id).first<Item>();
  }

  async findBySourcePostId(sourcePostId: string): Promise<Item | null> {
    return this.db.prepare("SELECT * FROM items WHERE source_post_id = ?").bind(sourcePostId).first<Item>();
  }

  async findByCanonicalUrl(canonicalUrl: string): Promise<Item | null> {
    return this.db
      .prepare("SELECT * FROM items WHERE canonical_url_hash = ?")
      .bind(stableHash(canonicalUrl))
      .first<Item>();
  }

  async findByNormalizedText(text: string): Promise<Item | null> {
    return this.db
      .prepare("SELECT * FROM items WHERE normalized_text_hash = ?")
      .bind(stableHash(normalizeText(text)))
      .first<Item>();
  }

  async updateStatus(id: string, status: ItemStatus): Promise<void> {
    await this.db.prepare("UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(status, id).run();
  }

  async createFromNormalizedPost(input: CreateItemFromNormalizedPostInput): Promise<Item> {
    const now = new Date().toISOString();
    const item: Item = {
      id: createId("item", input.post.sourcePostId ?? input.post.canonicalUrl),
      sourceId: input.sourceId,
      provider: input.post.provider,
      platform: input.post.platform,
      sourceType: input.post.sourceType,
      ...(input.post.sourcePostId === undefined ? {} : { sourcePostId: input.post.sourcePostId }),
      canonicalUrl: input.post.canonicalUrl,
      canonicalUrlHash: stableHash(input.post.canonicalUrl),
      ...(input.post.text === undefined ? {} : { normalizedTextHash: stableHash(normalizeText(input.post.text)) }),
      status: input.status ?? "sent_to_review",
      ...(input.post.publishedAt === undefined ? {} : { publishedAt: input.post.publishedAt }),
      ...(input.post.authorHandle === undefined ? {} : { authorHandle: input.post.authorHandle }),
      ...(input.post.text === undefined ? {} : { text: input.post.text }),
      links: input.post.links,
      rawPayload: input.post.rawPayload,
      createdAt: now,
      updatedAt: now
    };

    await this.db.prepare(
      `INSERT INTO items (id, source_id, provider, platform, source_type, source_post_id, canonical_url, canonical_url_hash, normalized_text_hash, status, published_at, author_handle, text, links_json, raw_payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      item.id,
      item.sourceId,
      item.provider,
      item.platform,
      item.sourceType,
      item.sourcePostId ?? null,
      item.canonicalUrl,
      item.canonicalUrlHash,
      item.normalizedTextHash ?? null,
      item.status,
      item.publishedAt ?? null,
      item.authorHandle ?? null,
      item.text ?? null,
      JSON.stringify(item.links),
      JSON.stringify(item.rawPayload),
      item.createdAt,
      item.updatedAt
    ).run();

    await this.createDedupeKey(item.id, "canonical_url", item.canonicalUrlHash);
    if (item.normalizedTextHash) {
      await this.createDedupeKey(item.id, "text", item.normalizedTextHash);
    }

    return item;
  }

  private async createDedupeKey(itemId: string, keyType: string, keyValue: string): Promise<void> {
    await this.db.prepare(
      "INSERT OR IGNORE INTO dedupe_keys (id, item_id, key_type, key_value) VALUES (?, ?, ?, ?)"
    ).bind(createId(`dedupe_${keyType}`, keyValue), itemId, keyType, keyValue).run();
  }
}

export function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createId(prefix: string, seed: string): string {
  return `${prefix}_${stableHash(seed)}`;
}
