import { getAdminConfigStoreStatus, getEffectiveEnv, getEncryptionSummary } from "../admin-config/service";
import { validateRuntimeConfig } from "../config";
import { jsonResponse } from "../http/json";
import { readTelegramTopicWorkflowSummary } from "../telegram-topic-workflow/status";
import { methodNotAllowed, timestamp } from "./response";
import type { Env } from "../types";

export async function handleReady(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"], request);
  }

  const effectiveEnv = await getEffectiveEnv(env);
  const validation = validateRuntimeConfig(effectiveEnv);
  const telegramTopicWorkflow = await readTelegramTopicWorkflowSummary(effectiveEnv);
  const encryption = await getEncryptionSummary(env);
  const adminConfigStore = await getAdminConfigStoreStatus(env);
  const warnings = [...validation.warnings, ...telegramTopicWorkflow.warnings];
  if (!encryption.secretEditingEnabled) {
    warnings.push("CONFIG_ENCRYPTION_KEY is not configured or invalid. Dashboard secret editing is disabled.");
  }
  if (!adminConfigStore.available && adminConfigStore.warning !== undefined) {
    warnings.push(adminConfigStore.warning);
  }

  return jsonResponse({
    ok: validation.ready,
    ready: validation.ready,
    summary: {
      ...validation.summary,
      telegramTopicWorkflow
    },
    adminConfig: {
      storeAvailable: adminConfigStore.available,
      ...(adminConfigStore.warning === undefined ? {} : { storeWarning: adminConfigStore.warning }),
      encryptionConfigured: encryption.configured,
      encryptionValid: encryption.valid,
      secretEditingEnabled: encryption.secretEditingEnabled
    },
    warnings,
    errors: validation.errors,
    timestamp: timestamp()
  }, { status: validation.ready ? 200 : 503 });
}
