const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:8787",
  "https://ai-curation-dashboard.pages.dev"
]);

const PAGE_PREVIEW_PATTERN = /^https:\/\/[a-z0-9-]+\.ai-curation-dashboard\.pages\.dev$/;
const CODESPACES_PATTERN = /^https:\/\/[a-z0-9-]+(?:-[0-9]+)?\.app\.github\.dev$/;
const ALLOWED_METHODS = "GET,POST,PUT,OPTIONS";
const ALLOWED_HEADERS = "Content-Type, x-internal-api-secret";
const MAX_AGE_SECONDS = "86400";

export function isAllowedCorsOrigin(origin: string | null): boolean {
  if (origin === null || origin.length === 0) return false;
  return ALLOWED_ORIGINS.has(origin) || PAGE_PREVIEW_PATTERN.test(origin) || CODESPACES_PATTERN.test(origin);
}

export function corsHeadersForRequest(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  if (isAllowedCorsOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin ?? "");
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
    headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    headers.set("Access-Control-Max-Age", MAX_AGE_SECONDS);
  }
  return headers;
}

export function corsPreflightResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeadersForRequest(request) });
}

export function withCors(request: Request, response: Response): Response {
  const corsHeaders = corsHeadersForRequest(request);
  if ([...corsHeaders.keys()].length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders.entries()) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
