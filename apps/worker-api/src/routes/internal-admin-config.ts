import { listAdminConfigAudit, listEditableConfig, resetConfigValues, setConfigValues, type SetAdminConfigInput } from "../admin-config/service";
import { jsonResponse } from "../http/json";
import { verifyInternalRequest } from "../security/internal-auth";
import { badRequest, methodNotAllowed, parseJsonBody, unauthorized } from "./response";
import type { Env } from "../types";

type PutAdminConfigBody = {
  updates?: SetAdminConfigInput[];
  key?: string;
  value?: unknown;
};

type ResetAdminConfigBody = {
  keys?: string[];
  key?: string;
};

export async function handleInternalAdminConfig(request: Request, env: Env): Promise<Response> {
  const auth = verifyInternalRequest(request, env);
  if (!auth.ok) {
    return unauthorized(auth.error, "Internal API authorization failed.", request);
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/audit")) {
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
      return jsonResponse(await listAdminConfigAudit(env, Number.isFinite(limit) ? limit : 50));
    }
    return jsonResponse(await listEditableConfig(env));
  }

  if (request.method === "PUT") {
    const parsed = await parseJsonBody<PutAdminConfigBody>(request);
    if (!parsed.ok) return parsed.response;
    const updates = normalizeUpdates(parsed.value);
    if (!updates.ok) return badRequest(updates.error, updates.message, request);
    const result = await setConfigValues(env, updates.updates, request);
    if (!result.ok) return badRequest(result.error, result.message, request);
    return jsonResponse(result.response);
  }

  if (request.method === "POST") {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/reset")) {
      return methodNotAllowed(["GET", "PUT", "POST"], request);
    }
    const parsed = await parseJsonBody<ResetAdminConfigBody>(request);
    if (!parsed.ok) return parsed.response;
    const keys = normalizeResetKeys(parsed.value);
    if (!keys.ok) return badRequest(keys.error, keys.message, request);
    const result = await resetConfigValues(env, keys.keys, request);
    if (!result.ok) return badRequest(result.error, result.message, request);
    return jsonResponse(result.response);
  }

  return methodNotAllowed(["GET", "PUT", "POST"], request);
}

function normalizeUpdates(body: PutAdminConfigBody): { ok: true; updates: SetAdminConfigInput[] } | { ok: false; error: string; message: string } {
  if (Array.isArray(body.updates)) {
    return { ok: true, updates: body.updates };
  }
  if (typeof body.key === "string" && body.value !== undefined) {
    return { ok: true, updates: [{ key: body.key, value: body.value }] };
  }
  return { ok: false, error: "invalid_updates", message: "Provide updates array or key/value." };
}

function normalizeResetKeys(body: ResetAdminConfigBody): { ok: true; keys: string[] } | { ok: false; error: string; message: string } {
  if (Array.isArray(body.keys)) {
    return { ok: true, keys: body.keys };
  }
  if (typeof body.key === "string") {
    return { ok: true, keys: [body.key] };
  }
  return { ok: false, error: "invalid_reset_keys", message: "Provide keys array or key." };
}
