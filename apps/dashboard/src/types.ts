export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type JsonObject = { [key: string]: JsonValue };
export type ApiResult<T = JsonObject> = { ok: true; status: number; data: T } | { ok: false; status?: number; error: string; message: string; data?: JsonValue };
export type DashboardSettings = { apiBaseUrl: string; hasInternalCredential: boolean; rememberInternalCredential: boolean };

export type ConnectionState = "idle" | "checking" | "connected" | "reachable_not_ready" | "unreachable" | "cors_blocked" | "invalid_url";
export type ConnectionFeedback = { state: ConnectionState; title: string; detail: string; guidance: string[] };
export type OperationName = "refresh_status" | "internal_auth_probe" | "telegram_review_dry_run" | "wordpress_draft_dry_run" | "firecrawl_sandbox_fetch" | "mock_e2e_smoke" | "scheduler_dry_run" | "pilot_readiness" | "pilot_firecrawl" | "pilot_telegram_review" | "pilot_wordpress_draft" | "pilot_combined" | "admin_config_load" | "admin_config_save" | "admin_config_reset" | "admin_config_audit";
export type OperationRecord = { id: string; name: OperationName; label: string; timestamp: string; ok: boolean; warningsCount: number; errorsCount: number; result: JsonValue };
export type StatusBundle = { health?: ApiResult; status?: ApiResult; ready?: ApiResult };
export type PilotInput = { runFirecrawl?: boolean; runTelegramReview?: boolean; runWordPressDraft?: boolean; firecrawlUrl?: string; telegramText?: string; wordpressTitle?: string; wordpressContent?: string; sourceUrl?: string };

export type ChecklistItem = { name: string; purpose: string; where: string; sensitive: boolean; configured?: boolean };
export type SetupTone = "safe" | "warning" | "risky";
export type SetupStatus = { label: string; tone: SetupTone; detail: string; nextAction: string };
export type RuntimeChecklistItem = { name: string; purpose: string; where: string; sensitive: boolean; safeDefault: string; backendStatus: string; safe?: boolean; nextAction: string };
export type SetupDetailItem = { name: string; purpose: string; where: string; sensitive: boolean; currentStatus: string; nextAction: string };
export type LaunchSummary = { overallStatus: "Not ready" | "Setup in progress" | "Pilot-ready" | "Risky config"; workerReachable: string; internalSecurity: string; telegramReadiness: string; wordpressReadiness: string; firecrawlReadiness: string; schedulerSafety: "Safe" | "Warning" | "Risky"; publishingSafety: "Safe" | "Risky"; recommendedNextStep: string };
export type SchedulerSafety = { riskLabel: "Safe" | "Warning" | "Risky"; enabled?: boolean; dryRun?: boolean; realProvidersAllowed?: boolean; publishingAllowed?: boolean; maxSourcesPerRun?: number; maxItemsPerRun?: number; maxAiItemsPerRun?: number; maxProviderItemsPerRun?: number; maxPublishItemsPerRun?: number; warnings: string[] };
export type SetupCenterModel = { workerConnection: SetupStatus; internalSecurity: SetupStatus; cloudflareRuntime: RuntimeChecklistItem[]; telegram: SetupDetailItem[]; wordpress: SetupDetailItem[]; firecrawl: SetupDetailItem[]; scheduler: SchedulerSafety; launchSummary: LaunchSummary };

export type AdminConfigGroup = "operating_mode" | "content_input" | "ai" | "telegram" | "wordpress" | "providers" | "scheduler" | "quotas";
export type AdminConfigSource = "d1" | "env" | "default" | "missing";
export type AdminConfigSafetyLevel = "safe" | "warning" | "risky";
export type AdminConfigItem = {
  key: string;
  group: AdminConfigGroup;
  label: string;
  description: string;
  whereUsed: string;
  type: string;
  isSecret: boolean;
  editable: boolean;
  configured: boolean;
  source: AdminConfigSource;
  value?: string;
  valueRedacted?: string;
  safetyLevel: AdminConfigSafetyLevel;
  setupVisible: boolean;
  settingsVisible: boolean;
  requiredForProduction: boolean;
  optionalInManualOnly: boolean;
  restartRequired: boolean;
  validation: { enumValues?: string[]; min?: number; max?: number; maxLength?: number; maxItems?: number; preferHttps?: boolean };
  updatedAt?: string;
};
export type AdminConfigResponse = {
  ok: true;
  adminConfigStore?: { available: boolean; warning?: string };
  encryption: { configured: boolean; valid: boolean; secretEditingEnabled: boolean; message?: string };
  groups: Record<AdminConfigGroup, AdminConfigItem[]>;
  items: AdminConfigItem[];
  presets: { openai: string[]; gemini: string[] } | undefined;
  modes: { key: string; label: string; description: string }[];
};
export type AdminAuditEntry = { id: string; key: string; value_type: string; is_secret: number; action: string; changed_at: string; changed_by: string | null; request_id: string | null; previous_value_redacted: string | null; new_value_redacted: string | null };
