import type { NormalizedPost } from "./item";
import type { Platform, SourceType } from "./platform";
import { PLATFORMS, SOURCE_TYPES } from "./platform";

export type ValidationIssueCode =
  | "missing_canonical_url"
  | "invalid_canonical_url"
  | "missing_source_identity"
  | "missing_content"
  | "invalid_platform"
  | "invalid_source_type";

export type ValidationIssue = {
  code: ValidationIssueCode;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};

export function validateNormalizedPost(post: NormalizedPost): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isValidPlatform(post.platform)) {
    issues.push({
      code: "invalid_platform",
      message: "Platform is not supported."
    });
  }

  if (!isValidSourceType(post.sourceType)) {
    issues.push({
      code: "invalid_source_type",
      message: "Source type is not supported."
    });
  }

  if (!hasCanonicalUrl(post)) {
    issues.push({
      code: "missing_canonical_url",
      message: "Canonical URL is required."
    });
  } else if (!isAllowedCanonicalUrl(post.canonicalUrl)) {
    issues.push({
      code: "invalid_canonical_url",
      message: "Canonical URL must be http, https, or an internal telegram URL."
    });
  }

  if (!hasSourceIdentity(post)) {
    issues.push({
      code: "missing_source_identity",
      message: "A source post ID or fallback identity is required."
    });
  }

  if (!hasContent(post)) {
    issues.push({
      code: "missing_content",
      message: "At least one of text, media, or link content is required."
    });
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function hasCanonicalUrl(post: NormalizedPost): boolean {
  return post.canonicalUrl.trim().length > 0;
}

export function hasSourceIdentity(post: NormalizedPost): boolean {
  return Boolean(post.sourcePostId?.trim()) || hasFallbackIdentity(post);
}

export function hasFallbackIdentity(post: NormalizedPost): boolean {
  return hasContent(post);
}

export function hasContent(post: NormalizedPost): boolean {
  return Boolean(post.text?.trim()) || post.links.length > 0 || post.media.length > 0;
}

export function isAllowedCanonicalUrl(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.startsWith("telegram://")) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidPlatform(value: string): value is Platform {
  return PLATFORMS.includes(value as Platform);
}

export function isValidSourceType(value: string): value is SourceType {
  return SOURCE_TYPES.includes(value as SourceType);
}
