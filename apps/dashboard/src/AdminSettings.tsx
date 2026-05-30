import type { WorkerApiClient } from "./api";
import type { AdminConfigItem } from "./types";

type AdminSettingsProps = {
  client: WorkerApiClient;
  enabled: boolean;
  initialTab?: string;
  onNotice: (message: string) => void;
  onRefreshStatus: () => Promise<void>;
};

export function AdminSettings({ enabled }: AdminSettingsProps): JSX.Element {
  return <section className="panel"><h2>Settings moved</h2><p className="muted">The rebuilt operator dashboard now renders settings directly from the main Settings page.</p>{!enabled && <p className="muted">Admin access is needed before editing settings.</p>}</section>;
}

export function providerSetupSkippedInManualOnly(mode: string): boolean {
  return mode === "manual_only";
}

export function settingsSourceLabel(source: AdminConfigItem["source"]): string {
  return source === "d1" ? "Dashboard override" : source === "env" ? "Cloudflare env" : source === "default" ? "Default" : "Missing";
}

export function secretStatusLabel(item: Pick<AdminConfigItem, "isSecret" | "configured">): string {
  return item.isSecret ? item.configured ? "Configured" : "Missing" : "Not secret";
}

export function aiMissingNextAction(provider: string, configured: boolean): string {
  return configured || provider === "mock" ? "AI settings are usable." : "Configure an AI model and provider credential in Settings -> AI.";
}
