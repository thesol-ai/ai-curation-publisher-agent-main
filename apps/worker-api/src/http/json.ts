import type { JsonResponseBody } from "../types";

export function jsonResponse(body: JsonResponseBody, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers
  });
}
