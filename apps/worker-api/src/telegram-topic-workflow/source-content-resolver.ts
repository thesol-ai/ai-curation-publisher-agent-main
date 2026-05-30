import type { Env } from "../types";

type EnvWithExternalLinkFetch = Env & {
  EXTERNAL_LINK_METADATA_ENABLED?: string;
  EXTERNAL_LINK_FETCH_TIMEOUT_MS?: string;
};

export type SourceContentResolution = {
  text?: string;
  warning?: string;
};

export async function resolveExternalSourceText(env: Env, urls: string[], fetchImpl: typeof fetch = fetch): Promise<SourceContentResolution> {
  const config = env as EnvWithExternalLinkFetch;
  if (config.EXTERNAL_LINK_METADATA_ENABLED !== "true") return {};

  const url = urls.find((candidate) => candidate.startsWith("http://") || candidate.startsWith("https://"));
  if (!url) return {};

  const timeoutMs = readTimeout(config.EXTERNAL_LINK_FETCH_TIMEOUT_MS);
  const xResolution = await resolveXText(url, timeoutMs, fetchImpl);
  if (xResolution.text || xResolution.warning) return xResolution;

  return resolveHtmlMetadata(url, timeoutMs, fetchImpl);
}

async function resolveXText(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<SourceContentResolution> {
  const statusId = xStatusId(url);
  if (!statusId) return {};
  const endpoints = [`https://api.fxtwitter.com/2/status/${statusId}`, `https://api.vxtwitter.com/i/status/${statusId}`];
  for (const endpoint of endpoints) {
    const payload = await fetchJson(endpoint, timeoutMs, fetchImpl);
    const text = extractXText(payload);
    if (text) return { text };
  }
  return { warning: "X/Twitter text could not be extracted through public metadata fallbacks." };
}

async function resolveHtmlMetadata(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<SourceContentResolution> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { "user-agent": "ai-curation-publisher-agent/1.0" }, signal: controller.signal });
    if (!response.ok) return { warning: "External link metadata fetch failed." };
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) return { warning: "External link is not an HTML document." };
    const html = (await response.text()).slice(0, 200_000);
    const text = extractMetadataText(html);
    return text.length > 0 ? { text } : { warning: "No readable external metadata was found." };
  } catch {
    return { warning: "External link metadata fetch failed." };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string, timeoutMs: number, fetchImpl: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ai-curation-publisher-agent/1.0"
      },
      signal: controller.signal
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function extractXText(value: unknown): string | undefined {
  const direct = extractDirectXText(value);
  if (direct) return direct;

  const candidates: string[] = [];
  walk(value, (entry) => {
    const text = readString(entry.text)
      ?? readString(entry.full_text)
      ?? readString(entry.description)
      ?? readNestedString(entry, ["status", "text"])
      ?? readNestedString(entry, ["status", "raw_text", "text"]);
    if (text) candidates.push(cleanText(text));
  }, 5);

  return candidates.find((entry) => entry.length > 0);
}

function extractDirectXText(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;

  const directCandidates = [
    readNestedString(value, ["status", "text"]),
    readNestedString(value, ["status", "raw_text", "text"]),
    readString(value.text),
    readString(value.full_text),
    readString(value.description)
  ];

  for (const candidate of directCandidates) {
    const cleaned = candidate === undefined ? "" : cleanText(candidate);
    if (cleaned.length > 0) return cleaned;
  }

  return undefined;
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let cursor: unknown = value;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return readString(cursor);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(value: unknown, visitor: (entry: Record<string, unknown>) => void, depth: number): void {
  if (depth < 0 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 20)) walk(entry, visitor, depth - 1);
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    visitor(record);
    for (const entry of Object.values(record)) walk(entry, visitor, depth - 1);
  }
}

function xStatusId(url: string): string | undefined {
  const match = url.match(/(?:x\.com|twitter\.com)\/(?:[A-Za-z0-9_]+\/status|i\/status)\/(\d+)/i);
  return match?.[1];
}

function extractMetadataText(html: string): string {
  const candidates = [
    metaContent(html, "property", "og:title"),
    metaContent(html, "name", "twitter:title"),
    titleText(html),
    metaContent(html, "property", "og:description"),
    metaContent(html, "name", "twitter:description"),
    metaContent(html, "name", "description")
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);

  const instagramCaption = extractInstagramCaption(candidates);
  if (instagramCaption !== undefined) return instagramCaption;

  return uniqueMeaningfulTexts(candidates.map(cleanText)).join("\n\n").trim();
}

function extractInstagramCaption(candidates: string[]): string | undefined {
  const decoded = candidates.map((value) => cleanText(value));

  for (const value of decoded) {
    const quotedAfterInstagram = value.match(/on Instagram:\s*["“]([\s\S]+?)["”](?:\s*$|\s*[.•-])/i);
    if (quotedAfterInstagram?.[1] !== undefined) {
      const caption = cleanInstagramCaption(quotedAfterInstagram[1]);
      if (caption.length > 0) return caption;
    }

    const quotedAfterDate = value.match(/\bon\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}:\s*["“]([\s\S]+?)["”](?:\s*\.|\s*$)/i);
    if (quotedAfterDate?.[1] !== undefined) {
      const caption = cleanInstagramCaption(quotedAfterDate[1]);
      if (caption.length > 0) return caption;
    }
  }

  const withoutBoilerplate = decoded
    .map(cleanInstagramCaption)
    .filter((value) => value.length > 0 && !/^Instagram$/i.test(value) && !/Instagram reel$/i.test(value));

  return uniqueMeaningfulTexts(withoutBoilerplate)[0];
}

function cleanInstagramCaption(value: string): string {
  return cleanText(value)
    .replace(/^\.\.\./, "")
    .replace(/\s*Instagram\s*$/i, "")
    .trim();
}

function uniqueMeaningfulTexts(values: string[]): string[] {
  const result: string[] = [];

  for (const value of values) {
    const cleaned = value.trim();
    if (cleaned.length === 0) continue;
    if (result.some((existing) => existing === cleaned || existing.includes(cleaned) || cleaned.includes(existing))) continue;
    result.push(cleaned);
  }

  return result;
}

function metaContent(html: string, attribute: "name" | "property", value: string): string | undefined {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<meta[^>]+${attribute}=["']${escapedValue}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
  const reverseRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapedValue}["'][^>]*>`, "i");
  const match = html.match(regex) ?? html.match(reverseRegex);
  return match?.[1] === undefined ? undefined : decodeHtml(match[1]);
}

function titleText(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] === undefined ? undefined : decodeHtml(match[1]);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => decodeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => decodeCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readTimeout(value: string | undefined): number {
  const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 3_000;
}
