import { generateDedupeKeys } from "@curator/core";
import type { DedupeKeyInput, NormalizedPost } from "@curator/core";
import type { DedupeKeyRecord, DedupeKeysRepository } from "../repositories/dedupe-keys.repository";

export type DedupeCheckResult = {
  duplicate: boolean;
  keys: DedupeKeyInput[];
  matchedKey?: DedupeKeyRecord;
  existingItemId?: string;
};

export class DedupeService {
  constructor(private readonly repository: DedupeKeysRepository) {}

  async check(post: NormalizedPost): Promise<DedupeCheckResult> {
    const keys = generateDedupeKeys(post);
    const matchedKey = await this.repository.findExisting(keys);

    if (matchedKey === null) {
      return { duplicate: false, keys };
    }

    return {
      duplicate: true,
      keys,
      matchedKey,
      existingItemId: matchedKey.itemId
    };
  }

  async recordItem(itemId: string, post: NormalizedPost): Promise<void> {
    await this.repository.createMany(itemId, generateDedupeKeys(post));
  }
}
