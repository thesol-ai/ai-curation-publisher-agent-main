import type { CreateMediaAssetInput } from "@curator/db";
import type { Env } from "../types";

export type MediaProcessorDispatchInput = {
  asset: CreateMediaAssetInput;
  sourceUrl: string;
  kind?: string;
};

export type MediaProcessorDispatchResult =
  | { ok: true; dispatched: true; assetId: string; repository: string; workflow: string }
  | { ok: true; dispatched: false; assetId: string; reason: "disabled" | "missing_config" | "unsupported_url" }
  | { ok: false; dispatched: false; assetId: string; reason: "github_dispatch_failed"; message: string };

type EnvWithMediaProcessor = Env & {
  GITHUB_MEDIA_PROCESSOR_ENABLED?: string;
  GITHUB_MEDIA_PROCESSOR_TOKEN?: string;
  GITHUB_MEDIA_PROCESSOR_REPOSITORY?: string;
  GITHUB_MEDIA_PROCESSOR_WORKFLOW?: string;
  GITHUB_MEDIA_PROCESSOR_REF?: string;
  MEDIA_PROCESSOR_CALLBACK_BASE_URL?: string;
};

export function shouldCreateExternalMediaJob(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host === "x.com"
      || host === "twitter.com"
      || host === "instagram.com"
      || host.endsWith(".instagram.com")
      || host === "tiktok.com"
      || host.endsWith(".tiktok.com")
      || host === "youtube.com"
      || host.endsWith(".youtube.com")
      || host === "youtu.be";
  } catch {
    return false;
  }
}

export async function dispatchGitHubMediaProcessor(input: {
  env: Env;
  job: MediaProcessorDispatchInput;
  fetchImpl?: typeof fetch;
}): Promise<MediaProcessorDispatchResult> {
  const env = input.env as EnvWithMediaProcessor;
  if (env.GITHUB_MEDIA_PROCESSOR_ENABLED !== "true") {
    return { ok: true, dispatched: false, assetId: input.job.asset.id, reason: "disabled" };
  }

  if (!shouldCreateExternalMediaJob(input.job.sourceUrl)) {
    return { ok: true, dispatched: false, assetId: input.job.asset.id, reason: "unsupported_url" };
  }

  const token = env.GITHUB_MEDIA_PROCESSOR_TOKEN?.trim();
  const repository = env.GITHUB_MEDIA_PROCESSOR_REPOSITORY?.trim();
  const workflow = env.GITHUB_MEDIA_PROCESSOR_WORKFLOW?.trim() || "media-processor.yml";
  const ref = env.GITHUB_MEDIA_PROCESSOR_REF?.trim() || "main";
  const callbackBaseUrl = env.MEDIA_PROCESSOR_CALLBACK_BASE_URL?.trim();

  if (!token || !repository || !callbackBaseUrl) {
    return { ok: true, dispatched: false, assetId: input.job.asset.id, reason: "missing_config" };
  }

  const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/internal/media/jobs/complete`;
  const response = await (input.fetchImpl ?? fetch)(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: "POST",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "ai-curation-publisher-agent-media-dispatcher"
    },
    body: JSON.stringify({
      ref,
      inputs: {
        asset_id: input.job.asset.id,
        item_id: input.job.asset.itemId,
        source_url: input.job.sourceUrl,
        kind: input.job.kind ?? input.job.asset.kind,
        callback_url: callbackUrl
      }
    })
  });

  if (!response.ok) {
    return {
      ok: false,
      dispatched: false,
      assetId: input.job.asset.id,
      reason: "github_dispatch_failed",
      message: "GitHub media processor dispatch failed."
    };
  }

  return { ok: true, dispatched: true, assetId: input.job.asset.id, repository, workflow };
}

export function createExternalMediaAsset(input: { itemId: string; sourceUrl: string; index?: number; status?: CreateMediaAssetInput["status"] }): CreateMediaAssetInput {
  const index = input.index ?? 0;
  return {
    id: `external_media_${stableHash(`${input.itemId}:${input.sourceUrl}:${index}`)}`,
    itemId: input.itemId,
    kind: "external",
    status: input.status ?? "processing",
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.sourceUrl
  };
}

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
