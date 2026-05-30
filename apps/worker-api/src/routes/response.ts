import { jsonResponse } from "../http/json";

export type JsonParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export type ErrorResponseOptions = {
  status: number;
  error: string;
  message: string;
  request?: Request;
  headers?: HeadersInit;
};

export function methodNotAllowed(allowedMethods: string[], request?: Request): Response {
  return errorResponse({
    status: 405,
    error: "method_not_allowed",
    message: `Allowed methods: ${allowedMethods.join(", ")}`,
    ...(request === undefined ? {} : { request }),
    headers: { allow: allowedMethods.join(", ") }
  });
}

export function badRequest(error: string, message = error, request?: Request): Response {
  return errorResponse({
    status: 400,
    error,
    message,
    ...(request === undefined ? {} : { request })
  });
}

export function unauthorized(error: string, message: string, request?: Request): Response {
  return errorResponse({
    status: 401,
    error,
    message,
    ...(request === undefined ? {} : { request })
  });
}

export function tooManyRequests(message: string, retryAfterSeconds: number | undefined, request?: Request): Response {
  return errorResponse({
    status: 429,
    error: "rate_limited",
    message,
    ...(request === undefined ? {} : { request }),
    ...(retryAfterSeconds === undefined ? {} : { headers: { "retry-after": String(retryAfterSeconds) } })
  });
}

export function serverError(error: string, message = error, request?: Request): Response {
  return errorResponse({
    status: 500,
    error,
    message,
    ...(request === undefined ? {} : { request })
  });
}

export function errorResponse(options: ErrorResponseOptions): Response {
  return jsonResponse({
    ok: false,
    error: options.error,
    message: options.message,
    requestId: getRequestId(options.request),
    timestamp: timestamp()
  }, {
    status: options.status,
    ...(options.headers === undefined ? {} : { headers: options.headers })
  });
}

export async function parseJsonBody<T>(request: Request): Promise<JsonParseResult<T>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return { ok: false, response: badRequest("expected_json_body", "Expected a JSON request body.", request) };
  }

  const value = await request.json().catch(() => null) as T | null;
  if (value === null || typeof value !== "object") {
    return { ok: false, response: badRequest("malformed_json", "Request body could not be parsed as JSON.", request) };
  }

  return { ok: true, value };
}

export function timestamp(): string {
  return new Date().toISOString();
}

export function getRequestId(request: Request | undefined): string {
  return request?.headers.get("cf-ray")
    ?? request?.headers.get("x-request-id")
    ?? `req_${crypto.randomUUID()}`;
}
