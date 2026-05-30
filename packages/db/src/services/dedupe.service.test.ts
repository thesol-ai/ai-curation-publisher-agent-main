import { describe, expect, it } from "vitest";
import { generateDedupeKeys } from "@curator/core";
import type { DedupeKeyInput, DedupeKeyType, NormalizedPost } from "@curator/core";
import type { D1DatabaseLike, D1PreparedStatementLike, D1Result, D1RunResult, D1Value } from "../client";
import { DedupeKeysRepository } from "../repositories/dedupe-keys.repository";
import { DedupeService } from "./dedupe.service";

type StoredDedupeKey = {
  id: string;
  item_id: string;
  key_type: DedupeKeyType;
  key_value: string;
  created_at: string;
};

class FakeStatement implements D1PreparedStatementLike {
  private values: D1Value[] = [];

  constructor(private readonly db: FakeDb, private readonly query: string) {}

  bind(...values: D1Value[]): D1PreparedStatementLike {
    this.values = values;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.includes("FROM dedupe_keys")) {
      const keyType = this.values[0] as DedupeKeyType;
      const keyValue = String(this.values[1]);
      return (this.db.rows.find((row) => row.key_type === keyType && row.key_value === keyValue) as T | undefined) ?? null;
    }

    return null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return { success: true, results: [] };
  }

  async run(): Promise<D1RunResult> {
    if (this.query.includes("INSERT OR IGNORE INTO dedupe_keys")) {
      const row: StoredDedupeKey = {
        id: String(this.values[0]),
        item_id: String(this.values[1]),
        key_type: this.values[2] as DedupeKeyType,
        key_value: String(this.values[3]),
        created_at: new Date().toISOString()
      };

      if (!this.db.rows.some((candidate) => candidate.key_type === row.key_type && candidate.key_value === row.key_value)) {
        this.db.rows.push(row);
      }
    }

    return { success: true, changes: 1 };
  }
}

class FakeDb implements D1DatabaseLike {
  rows: StoredDedupeKey[] = [];

  prepare(query: string): D1PreparedStatementLike {
    return new FakeStatement(this, query);
  }
}

function makePost(overrides: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    provider: "mock_social_provider",
    platform: "manual",
    sourceType: "web_url",
    sourcePostId: "message-local",
    canonicalUrl: "https://source.local/post",
    text: "Manual post",
    links: ["https://source.local/post"],
    media: [],
    rawPayload: {},
    ...overrides
  };
}

function makeKey(overrides: Partial<DedupeKeyInput> = {}): DedupeKeyInput {
  return {
    keyType: "canonical_url_hash",
    keyValue: "local-hash",
    ...overrides
  };
}

describe("DedupeKeysRepository", () => {
  it("finds an existing dedupe key", async () => {
    const db = new FakeDb();
    const repository = new DedupeKeysRepository(db);
    await repository.createMany("item-local", [makeKey()]);

    const existing = await repository.findExisting([makeKey()]);

    expect(existing?.itemId).toBe("item-local");
    expect(existing?.keyType).toBe("canonical_url_hash");
    expect(existing?.keyValue).toBe("local-hash");
  });

  it("returns no match when no key exists", async () => {
    const repository = new DedupeKeysRepository(new FakeDb());

    await expect(repository.findExisting([makeKey()])).resolves.toBeNull();
  });

  it("creates multiple dedupe keys", async () => {
    const db = new FakeDb();
    const repository = new DedupeKeysRepository(db);

    await repository.createMany("item-local", [
      makeKey({ keyType: "canonical_url_hash", keyValue: "url-hash" }),
      makeKey({ keyType: "normalized_text_hash", keyValue: "text-hash" }),
      makeKey({ keyType: "fallback_composite", keyValue: "fallback-hash" })
    ]);

    expect(db.rows).toHaveLength(3);
    expect(db.rows.map((row) => row.item_id)).toEqual(["item-local", "item-local", "item-local"]);
  });
});

describe("DedupeService", () => {
  it("returns duplicate=false for new posts", async () => {
    const service = new DedupeService(new DedupeKeysRepository(new FakeDb()));

    const result = await service.check(makePost());

    expect(result.duplicate).toBe(false);
    expect(result.matchedKey).toBeUndefined();
    expect(result.existingItemId).toBeUndefined();
    expect(result.keys).toEqual(generateDedupeKeys(makePost()));
  });

  it("returns duplicate=true for existing keys", async () => {
    const db = new FakeDb();
    const repository = new DedupeKeysRepository(db);
    const service = new DedupeService(repository);
    const post = makePost();

    await service.recordItem("item-existing", post);
    const result = await service.check(makePost({ sourcePostId: "different-message" }));

    expect(result.duplicate).toBe(true);
    expect(result.existingItemId).toBe("item-existing");
    expect(result.matchedKey).toBeDefined();
  });

  it("records item dedupe keys", async () => {
    const db = new FakeDb();
    const service = new DedupeService(new DedupeKeysRepository(db));

    await service.recordItem("item-local", makePost());

    expect(db.rows.length).toBeGreaterThan(0);
    expect(db.rows.every((row) => row.item_id === "item-local")).toBe(true);
  });
});
