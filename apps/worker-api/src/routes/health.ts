import { readOperationalConfig } from "../config";
import { jsonResponse } from "../http/json";
import { methodNotAllowed, timestamp } from "./response";
import type { Env } from "../types";

export function handleHealth(request: Request, env: Env): Response {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }

  const config = readOperationalConfig(env);

  return jsonResponse({
    ok: true,
    service: config.serviceName,
    environment: config.environment,
    timestamp: timestamp()
  });
}
