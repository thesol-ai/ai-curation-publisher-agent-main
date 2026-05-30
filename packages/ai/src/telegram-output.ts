export type TelegramStructuredOutput = {
  headline: string;
  rewrittenPersianCaption: string;
  shortSummary: string;
  language: string;
  riskFlags: string[];
  relevanceScore: number;
  suggestedHashtags: string[];
  sourceAttributionText: string;
};

export type TelegramOutputValidationResult = {
  valid: boolean;
  output?: TelegramStructuredOutput;
  errors: string[];
};

export const TELEGRAM_OUTPUT_SCHEMA_REF = "telegram_structured_output_v1";

export function validateTelegramStructuredOutput(value: unknown): TelegramOutputValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ["Output must be an object."] };
  }

  const output = normalizeTelegramOutputAliases(value as Record<string, unknown>);
  requireString(output, "headline", errors);
  requireString(output, "rewrittenPersianCaption", errors);
  requireString(output, "shortSummary", errors);
  requireString(output, "language", errors);
  requireOptionalString(output, "sourceAttributionText", errors);
  requireStringArray(output, "riskFlags", errors);
  requireStringArray(output, "suggestedHashtags", errors);

  if (typeof output.relevanceScore !== "number" || Number.isNaN(output.relevanceScore)) {
    errors.push("relevanceScore must be a number.");
  } else if (output.relevanceScore < 0 || output.relevanceScore > 1) {
    errors.push("relevanceScore must be between 0 and 1.");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    output: {
      headline: output.headline as string,
      rewrittenPersianCaption: output.rewrittenPersianCaption as string,
      shortSummary: output.shortSummary as string,
      language: output.language as string,
      riskFlags: output.riskFlags as string[],
      relevanceScore: output.relevanceScore as number,
      suggestedHashtags: output.suggestedHashtags as string[],
      sourceAttributionText: output.sourceAttributionText as string
    }
  };
}

export function parseTelegramStructuredOutput(rawText: string): TelegramOutputValidationResult {
  const candidates = [
    rawText,
    stripMarkdownJsonFence(rawText),
    extractFirstJsonObject(rawText)
  ].filter((value): value is string => value !== undefined && value.trim().length > 0);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);

    try {
      return validateTelegramStructuredOutput(JSON.parse(trimmed));
    } catch {
      // Try the next candidate.
    }
  }

  return { valid: false, errors: ["Output must be valid JSON."] };
}

function stripMarkdownJsonFence(rawText: string): string | undefined {
  const trimmed = rawText.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1];
}

function extractFirstJsonObject(rawText: string): string | undefined {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  return rawText.slice(start, end + 1);
}

function normalizeTelegramOutputAliases(output: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...output };

  normalized.headline = firstString(
    normalized.headline,
    normalized.title,
    normalized.heading
  );

  normalized.rewrittenPersianCaption = firstString(
    normalized.rewrittenPersianCaption,
    normalized.caption,
    normalized.persianCaption,
    normalized.finalCaption,
    normalized.text
  );

  normalized.shortSummary = firstString(
    normalized.shortSummary,
    normalized.summary,
    normalized.description,
    normalized.headline
  );

  normalized.language = firstString(normalized.language, "fa");
  normalized.sourceAttributionText = firstString(normalized.sourceAttributionText, "");

  if (!Array.isArray(normalized.riskFlags)) normalized.riskFlags = [];
  if (!Array.isArray(normalized.suggestedHashtags)) normalized.suggestedHashtags = [];

  if (typeof normalized.relevanceScore !== "number" || Number.isNaN(normalized.relevanceScore)) {
    normalized.relevanceScore = 0.5;
  }

  return normalized;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

function requireString(output: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof output[field] !== "string" || output[field].trim().length === 0) {
    errors.push(`${field} must be a non-empty string.`);
  }
}

function requireOptionalString(output: Record<string, unknown>, field: string, errors: string[]): void {
  if (typeof output[field] !== "string") {
    errors.push(`${field} must be a string.`);
  }
}

function requireStringArray(output: Record<string, unknown>, field: string, errors: string[]): void {
  if (!Array.isArray(output[field]) || !(output[field] as unknown[]).every((value) => typeof value === "string")) {
    errors.push(`${field} must be an array of strings.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
