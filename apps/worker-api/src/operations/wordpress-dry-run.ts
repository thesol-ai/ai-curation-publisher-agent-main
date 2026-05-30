import {
  buildWordPressPostPayload,
  createMockWordPressOutput,
  MockWordPressClient,
  RealWordPressClient,
  WordPressClientError,
  type WordPressClient,
  type WordPressPostStatus
} from "@curator/wordpress";
import type { Env } from "../types";

export type WordPressDryRunInput = {
  title: string;
  content: string;
  sourceUrl?: string;
};

export type WordPressDryRunMode = "mock" | "real";

export type WordPressDryRunResult = {
  ok: boolean;
  mode: WordPressDryRunMode;
  inspectOnly: boolean;
  draftRequested: boolean;
  wordpressConfigured: boolean;
  credentialsConfigured: boolean;
  realDryRunEnabled: boolean;
  statusRequested: WordPressPostStatus;
  payloadPrepared: boolean;
  postCreated: boolean;
  wordpressPostId?: string;
  wordpressUrl?: string;
  error?: "disabled" | "missing_config" | "missing_credentials" | "wordpress_api_error" | "network_error" | "invalid_response" | "unauthorized" | "unknown_error";
  message?: string;
};

export type WordPressDryRunOptions = {
  env: Env;
  input: WordPressDryRunInput;
  client?: WordPressClient;
};

export function isRealWordPressDryRunEnabled(env: Pick<Env, "WORDPRESS_REAL_DRY_RUN_ENABLED">): boolean {
  return env.WORDPRESS_REAL_DRY_RUN_ENABLED === "true";
}

export async function runWordPressDryRun(options: WordPressDryRunOptions): Promise<WordPressDryRunResult> {
  const realDryRunEnabled = isRealWordPressDryRunEnabled(options.env);
  const wordpressConfigured = hasValue(options.env.WORDPRESS_BASE_URL);
  const credentialsConfigured = hasValue(options.env.WORDPRESS_USERNAME) && hasValue(options.env.WORDPRESS_APPLICATION_PASSWORD);
  const statusRequested = normalizeStatus(options.env.WORDPRESS_DEFAULT_STATUS);
  const payload = buildDryRunPayload(options.input, statusRequested);

  if (!realDryRunEnabled) {
    const client = options.client ?? new MockWordPressClient();
    const post = await client.createPost(payload);

    return {
      ok: true,
      mode: "mock",
      inspectOnly: true,
      draftRequested: statusRequested === "draft",
      wordpressConfigured,
      credentialsConfigured,
      realDryRunEnabled: false,
      statusRequested,
      payloadPrepared: true,
      postCreated: true,
      wordpressPostId: post.id,
      wordpressUrl: post.url
    };
  }

  if (!wordpressConfigured || !credentialsConfigured) {
    return {
      ok: false,
      mode: "real",
      inspectOnly: false,
      draftRequested: true,
      wordpressConfigured,
      credentialsConfigured,
      realDryRunEnabled: true,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: false,
      error: "missing_config",
      message: "Real WordPress dry-run requires base URL, username, and application password configuration."
    };
  }

  const client = options.client ?? new RealWordPressClient({
    ...(options.env.WORDPRESS_BASE_URL === undefined ? {} : { baseUrl: options.env.WORDPRESS_BASE_URL }),
    ...(options.env.WORDPRESS_USERNAME === undefined ? {} : { username: options.env.WORDPRESS_USERNAME }),
    ...(options.env.WORDPRESS_APPLICATION_PASSWORD === undefined ? {} : { applicationPassword: options.env.WORDPRESS_APPLICATION_PASSWORD })
  });

  try {
    const post = await client.createPost({
      ...payload,
      status: "draft"
    });

    return {
      ok: true,
      mode: "real",
      inspectOnly: false,
      draftRequested: true,
      wordpressConfigured,
      credentialsConfigured,
      realDryRunEnabled: true,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: true,
      wordpressPostId: post.id,
      wordpressUrl: post.url
    };
  } catch (error) {
    if (error instanceof WordPressClientError) {
      return {
        ok: false,
        mode: "real",
        inspectOnly: false,
        draftRequested: true,
        wordpressConfigured,
        credentialsConfigured,
        realDryRunEnabled: true,
        statusRequested: "draft",
        payloadPrepared: true,
        postCreated: false,
        error: error.category,
        message: error.message
      };
    }

    return {
      ok: false,
      mode: "real",
      inspectOnly: false,
      draftRequested: true,
      wordpressConfigured,
      credentialsConfigured,
      realDryRunEnabled: true,
      statusRequested: "draft",
      payloadPrepared: true,
      postCreated: false,
      error: "unknown_error",
      message: "WordPress dry-run failed."
    };
  }
}

function buildDryRunPayload(input: WordPressDryRunInput, status: WordPressPostStatus) {
  return buildWordPressPostPayload({
    output: createMockWordPressOutput({
      title_fa: input.title,
      excerpt_fa: input.content.slice(0, 180),
      body_fa: input.content,
      source_attribution: input.sourceUrl === undefined ? "Source: WordPress dry-run" : `Source: ${input.sourceUrl}`
    }),
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    status
  });
}

function normalizeStatus(value: string | undefined): WordPressPostStatus {
  return value === "pending" || value === "private" || value === "publish" ? value : "draft";
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
