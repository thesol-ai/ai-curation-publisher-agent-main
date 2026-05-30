import type { WordPressClient, WordPressPostInput, WordPressPostResult, WordPressPostStatus } from "./client";

export type WordPressClientErrorCategory =
  | "missing_credentials"
  | "wordpress_api_error"
  | "network_error"
  | "invalid_response"
  | "unauthorized"
  | "unknown_error";

export type WordPressClientErrorDetails = {
  category: WordPressClientErrorCategory;
  message: string;
  statusCode?: number;
  cause?: unknown;
};

export class WordPressClientError extends Error {
  readonly category: WordPressClientErrorCategory;
  readonly statusCode: number | undefined;
  readonly cause: unknown;

  constructor(details: WordPressClientErrorDetails) {
    super(details.message);
    this.name = "WordPressClientError";
    this.category = details.category;
    this.statusCode = details.statusCode;
    this.cause = details.cause;
  }
}

export type WordPressFetch = typeof fetch;

export type RealWordPressClientOptions = {
  baseUrl?: string;
  username?: string;
  applicationPassword?: string;
  fetchImpl?: WordPressFetch;
  timeoutMs?: number;
};

type WordPressRestPost = {
  id?: unknown;
  link?: unknown;
  status?: unknown;
  slug?: unknown;
  date_gmt?: unknown;
  date?: unknown;
};

export class RealWordPressClient implements WordPressClient {
  private readonly baseUrl: string | undefined;
  private readonly username: string | undefined;
  private readonly applicationPassword: string | undefined;
  private readonly fetchImpl: WordPressFetch;
  private readonly timeoutMs: number;

  constructor(options: RealWordPressClientOptions) {
    this.baseUrl = normalizeOptional(options.baseUrl);
    this.username = normalizeOptional(options.username);
    this.applicationPassword = normalizeOptional(options.applicationPassword);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async createPost(input: WordPressPostInput): Promise<WordPressPostResult> {
    this.assertConfigured();
    const status = input.status ?? "draft";
    const requestBody = toWordPressRestPostPayload(input, status);
    const endpoint = `${this.baseUrl?.replace(/\/$/, "")}/wp-json/wp/v2/posts`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Basic ${buildBasicAuth(this.username as string, this.applicationPassword as string)}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (error) {
      throw new WordPressClientError({
        category: "network_error",
        message: "WordPress REST request failed before receiving a response.",
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }

    let payload: WordPressRestPost;
    try {
      payload = await response.json() as WordPressRestPost;
    } catch (error) {
      throw new WordPressClientError({
        category: "invalid_response",
        message: "WordPress REST API returned invalid JSON.",
        statusCode: response.status,
        cause: error
      });
    }

    if (!response.ok) {
      throw new WordPressClientError({
        category: response.status === 401 || response.status === 403 ? "unauthorized" : "wordpress_api_error",
        message: response.status === 401 || response.status === 403
          ? "WordPress REST API rejected authentication or authorization."
          : "WordPress REST API returned an error.",
        statusCode: response.status
      });
    }

    return parseWordPressPostResult(payload, status);
  }

  private assertConfigured(): void {
    if (!this.baseUrl || !this.username || !this.applicationPassword) {
      throw new WordPressClientError({
        category: "missing_credentials",
        message: "WordPress base URL, username, and application password are required."
      });
    }
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function toWordPressRestPostPayload(input: WordPressPostInput, status: WordPressPostStatus): Record<string, unknown> {
  return {
    title: input.title,
    excerpt: input.excerpt,
    content: input.content,
    status,
    ...(input.slug === undefined ? {} : { slug: input.slug }),
    ...(input.meta === undefined ? {} : { meta: input.meta })
  };
}

function buildBasicAuth(username: string, applicationPassword: string): string {
  return btoa(`${username}:${applicationPassword}`);
}

function parseWordPressPostResult(payload: WordPressRestPost, fallbackStatus: WordPressPostStatus): WordPressPostResult {
  if (typeof payload.id !== "number" && typeof payload.id !== "string") {
    throw new WordPressClientError({
      category: "invalid_response",
      message: "WordPress REST API response did not include a post id."
    });
  }

  if (typeof payload.link !== "string" || payload.link.trim().length === 0) {
    throw new WordPressClientError({
      category: "invalid_response",
      message: "WordPress REST API response did not include a post URL."
    });
  }

  const status = isWordPressPostStatus(payload.status) ? payload.status : fallbackStatus;
  const createdAt = typeof payload.date_gmt === "string"
    ? payload.date_gmt
    : typeof payload.date === "string"
      ? payload.date
      : new Date(0).toISOString();

  return {
    id: String(payload.id),
    url: payload.link,
    status,
    createdAt,
    ...(typeof payload.slug === "string" && payload.slug.length > 0 ? { slug: payload.slug } : {})
  };
}

function isWordPressPostStatus(value: unknown): value is WordPressPostStatus {
  return value === "draft" || value === "publish" || value === "pending" || value === "private";
}
