import { createStableId, type DedupeKeyInput, type DedupeKeyType } from "@curator/core";
import type { D1DatabaseLike } from "../client";

type DedupeKeyRow = {
  id: string;
  item_id: string;
  key_type: DedupeKeyType;
  key_value: string;
  created_at: string;
};

export type DedupeKeyRecord = {
  id: string;
  itemId: string;
  keyType: DedupeKeyType;
  keyValue: string;
  createdAt: string;
};

export class DedupeKeysRepository {
  constructor(private readonly db: D1DatabaseLike) {}

  async findExisting(keys: DedupeKeyInput[]): Promise<DedupeKeyRecord | null> {
    for (const key of keys) {
      const row = await this.db
        .prepare("SELECT id, item_id, key_type, key_value, created_at FROM dedupe_keys WHERE key_type = ? AND key_value = ? LIMIT 1")
        .bind(key.keyType, key.keyValue)
        .first<DedupeKeyRow>();

      if (row) {
        return toDedupeKeyRecord(row);
      }
    }

    return null;
  }

  async createMany(itemId: string, keys: DedupeKeyInput[]): Promise<void> {
    for (const key of keys) {
      await this.db
        .prepare("INSERT OR IGNORE INTO dedupe_keys (id, item_id, key_type, key_value) VALUES (?, ?, ?, ?)")
        .bind(createStableId(`dedupe_${key.keyType}`, key.keyValue), itemId, key.keyType, key.keyValue)
        .run();
    }
  }
}

function toDedupeKeyRecord(row: DedupeKeyRow): DedupeKeyRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    keyType: row.key_type,
    keyValue: row.key_value,
    createdAt: row.created_at
  };
}
