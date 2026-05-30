import type { AdminConfigDefinition } from "./allowlist";

export type AdminConfigValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string; message: string };

export function validateAdminConfigValue(definition: AdminConfigDefinition, rawValue: unknown): AdminConfigValidationResult {
  if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") {
    return { ok: false, error: "invalid_value_type", message: `${definition.key} must be a string, number, or boolean.` };
  }

  const value = String(rawValue).trim();

  if (definition.valueType === "model_chain" && value.length === 0) {
    return { ok: true, value: "[]" };
  }

  if (definition.valueType === "string" && value.length === 0 && definition.defaultValue === "") {
    return { ok: true, value: "" };
  }

  if (value.length === 0) {
    return { ok: false, error: "empty_value", message: `${definition.key} cannot be empty.` };
  }

  if (definition.isSecret) {
    return validateSafeString(definition, value, true);
  }

  switch (definition.valueType) {
    case "boolean":
      if (value !== "true" && value !== "false") return { ok: false, error: "invalid_boolean", message: `${definition.key} must be exactly true or false.` };
      return { ok: true, value };
    case "integer": {
      if (!/^\d+$/.test(value)) return { ok: false, error: "invalid_integer", message: `${definition.key} must be an integer.` };
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed)) return { ok: false, error: "invalid_integer", message: `${definition.key} must be a safe integer.` };
      if (definition.min !== undefined && parsed < definition.min) return { ok: false, error: "value_too_small", message: `${definition.key} must be at least ${definition.min}.` };
      if (definition.max !== undefined && parsed > definition.max) return { ok: false, error: "value_too_large", message: `${definition.key} must be at most ${definition.max}.` };
      return { ok: true, value: String(parsed) };
    }
    case "number": {
      if (!/^\d+(\.\d+)?$/.test(value)) return { ok: false, error: "invalid_number", message: `${definition.key} must be a number.` };
      const parsed = Number.parseFloat(value);
      if (!Number.isFinite(parsed)) return { ok: false, error: "invalid_number", message: `${definition.key} must be a finite number.` };
      if (definition.min !== undefined && parsed < definition.min) return { ok: false, error: "value_too_small", message: `${definition.key} must be at least ${definition.min}.` };
      if (definition.max !== undefined && parsed > definition.max) return { ok: false, error: "value_too_large", message: `${definition.key} must be at most ${definition.max}.` };
      return { ok: true, value: String(parsed) };
    }
    case "url": {
      let parsed: URL;
      try { parsed = new URL(value); } catch { return { ok: false, error: "invalid_url", message: `${definition.key} must be a valid URL.` }; }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "invalid_url_protocol", message: `${definition.key} must use http or https.` };
      const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.endsWith(".local");
      if (definition.preferHttps === true && parsed.protocol !== "https:" && !(definition.allowLocalHttp === true && local)) return { ok: false, error: "https_required", message: `${definition.key} must use https.` };
      return { ok: true, value: parsed.toString() };
    }
    case "enum":
      if (definition.enumValues === undefined || !definition.enumValues.includes(value)) return { ok: false, error: "invalid_enum", message: `${definition.key} must be one of: ${(definition.enumValues ?? []).join(", ")}.` };
      return { ok: true, value };
    case "model_chain":
      return validateModelChain(definition, value);
    case "string":
      return validateSafeString(definition, value, false);
    case "secret":
      return validateSafeString(definition, value, true);
    default:
      return { ok: false, error: "unsupported_value_type", message: `${definition.key} has unsupported type.` };
  }
}

function validateModelChain(definition: AdminConfigDefinition, value: string): AdminConfigValidationResult {
  let entries: string[];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) return { ok: false, error: "invalid_model_chain", message: `${definition.key} must be a JSON array of model IDs or a comma-separated list.` };
      entries = parsed.map((entry) => entry.trim());
    } catch {
      return { ok: false, error: "invalid_model_chain", message: `${definition.key} JSON array could not be parsed.` };
    }
  } else {
    entries = value.split(",").map((entry) => entry.trim());
  }

  if (entries.some((entry) => entry.length === 0)) return { ok: false, error: "empty_model_id", message: `${definition.key} cannot contain empty model IDs.` };
  if (entries.length > (definition.maxItems ?? 5)) return { ok: false, error: "too_many_models", message: `${definition.key} supports at most ${definition.maxItems ?? 5} fallback models.` };
  for (const entry of entries) { const safe = validateModelId(entry, definition.maxLength ?? 120); if (!safe.ok) return safe; }
  return { ok: true, value: JSON.stringify(entries) };
}

function validateSafeString(definition: AdminConfigDefinition, value: string, secret: boolean): AdminConfigValidationResult {
  if (secret && value.length === 0) return { ok: false, error: "empty_secret", message: `${definition.key} cannot be empty.` };
  if (definition.key === "AI_MODEL") return validateModelId(value, definition.maxLength ?? 120);
  const maxLength = definition.maxLength ?? (secret ? 4096 : 512);
  if (value.length > maxLength) return { ok: false, error: "value_too_long", message: `${definition.key} must be ${maxLength} characters or fewer.` };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: "invalid_control_character", message: `${definition.key} contains unsupported control characters.` };
  return { ok: true, value };
}

function validateModelId(value: string, maxLength: number): AdminConfigValidationResult {
  if (value.length === 0) return { ok: false, error: "empty_model_id", message: "Model ID cannot be empty." };
  if (value.length > maxLength) return { ok: false, error: "model_id_too_long", message: `Model ID must be ${maxLength} characters or fewer.` };
  if (!/^[A-Za-z0-9._:\/-]+$/.test(value)) return { ok: false, error: "invalid_model_id", message: "Model ID may contain only letters, numbers, dot, dash, underscore, slash, or colon." };
  return { ok: true, value };
}
