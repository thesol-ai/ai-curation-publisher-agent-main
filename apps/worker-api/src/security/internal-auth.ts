import type { Env } from "../types";

export type InternalAuthResult =
  | { ok: true; protected: boolean }
  | { ok: false; error: "internal_auth_required" | "internal_auth_invalid" };

export function verifyInternalRequest(request: Request, env: Env): InternalAuthResult {
  const configuredSecret = env.INTERNAL_API_SECRET?.trim();

  if (!configuredSecret) {
    return { ok: true, protected: false };
  }

  const providedSecret = request.headers.get("x-internal-api-secret")?.trim();
  if (!providedSecret) {
    return { ok: false, error: "internal_auth_required" };
  }

  if (!constantTimeEqual(providedSecret, configuredSecret)) {
    return { ok: false, error: "internal_auth_invalid" };
  }

  return { ok: true, protected: true };
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    diff |= leftCode ^ rightCode;
  }

  return diff === 0;
}
