import type { JsonObject } from "../../types";

export function readObject(value: unknown, key?: string): JsonObject | undefined {
  const source = key === undefined ? value : typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject)[key] : undefined;
  return typeof source === "object" && source !== null && !Array.isArray(source) ? source as JsonObject : undefined;
}

export function readString(value: unknown, key: string): string | undefined {
  const object = readObject(value);
  const raw = object?.[key];
  return typeof raw === "string" ? raw : undefined;
}

export function readNumber(value: unknown, key: string): number | undefined {
  const object = readObject(value);
  const raw = object?.[key];
  return typeof raw === "number" ? raw : undefined;
}

export function readBoolean(value: unknown, key: string): boolean | undefined {
  const object = readObject(value);
  const raw = object?.[key];
  return typeof raw === "boolean" ? raw : undefined;
}

export function shortId(value: string | undefined): string {
  if (!value) return "-";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function statusTone(value: string | undefined): "success" | "warning" | "danger" | "info" | "muted" {
  if (value === "ready" || value === "published" || value === "ready_for_review" || value === "active") return "success";
  if (value === "failed" || value === "cancelled") return "danger";
  if (value === "pending" || value === "processing" || value === "scheduled") return "warning";
  return "info";
}
