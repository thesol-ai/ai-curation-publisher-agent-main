import { useMemo, useState } from "react";
import type { JsonValue } from "./types";

type OutputDraft = {
  idSuffix: string;
  language: string;
  reviewThreadId: string;
  finalChatId: string;
  publishMode: "immediate" | "scheduled" | "queued";
  timezone: string;
  allowedWindow: string;
  minimumGapMinutes: string;
  maxPostsPerHour: string;
  maxPostsPerDay: string;
  queuePriority: string;
  signatureEnabled: boolean;
  signatureText: string;
  signatureChannelHandle: string;
  enabled: boolean;
};

const defaultOutputs: OutputDraft[] = [
  { idSuffix: "fa", language: "fa", reviewThreadId: "201", finalChatId: "@crypto_fa", publishMode: "scheduled", timezone: "Asia/Tehran", allowedWindow: "09:00-23:00", minimumGapMinutes: "10", maxPostsPerHour: "4", maxPostsPerDay: "24", queuePriority: "0", signatureEnabled: true, signatureText: "", signatureChannelHandle: "@crypto_fa", enabled: true },
  { idSuffix: "ar", language: "ar", reviewThreadId: "202", finalChatId: "@crypto_ar", publishMode: "scheduled", timezone: "Asia/Dubai", allowedWindow: "10:00-23:00", minimumGapMinutes: "10", maxPostsPerHour: "4", maxPostsPerDay: "24", queuePriority: "0", signatureEnabled: false, signatureText: "", signatureChannelHandle: "", enabled: true },
  { idSuffix: "en", language: "en", reviewThreadId: "203", finalChatId: "@crypto_en", publishMode: "scheduled", timezone: "UTC", allowedWindow: "08:00-22:00", minimumGapMinutes: "15", maxPostsPerHour: "3", maxPostsPerDay: "24", queuePriority: "0", signatureEnabled: false, signatureText: "", signatureChannelHandle: "", enabled: true }
];

export function TelegramRouteQuickForm(props: { busy: boolean; onSave: (routes: JsonValue) => Promise<void> }): JSX.Element {
  const [routeId, setRouteId] = useState("crypto");
  const [category, setCategory] = useState("crypto");
  const [sourceChatId, setSourceChatId] = useState("-1001111111111");
  const [sourceThreadId, setSourceThreadId] = useState("101");
  const [promptProfile, setPromptProfile] = useState("crypto_editorial");
  const [enabled, setEnabled] = useState(true);
  const [outputs, setOutputs] = useState<OutputDraft[]>(defaultOutputs);
  const [localMessage, setLocalMessage] = useState<string | undefined>();

  const routePreview = useMemo(() => buildRoute(), [routeId, category, sourceChatId, sourceThreadId, promptProfile, enabled, outputs]);

  function buildRoute(): JsonValue {
    return [{
      id: routeId.trim(),
      category: category.trim(),
      sourceChatId: sourceChatId.trim(),
      sourceThreadId: toInteger(sourceThreadId, 0),
      promptProfile: promptProfile.trim(),
      enabled,
      outputs: outputs.filter((output: OutputDraft) => output.enabled).map((output: OutputDraft) => ({
        id: `${routeId.trim()}_${output.idSuffix.trim()}`,
        language: output.language.trim(),
        reviewChatId: sourceChatId.trim(),
        reviewThreadId: toInteger(output.reviewThreadId, 0),
        finalChatId: output.finalChatId.trim(),
        enabled: true,
        publishEnabled: true,
        publishMode: output.publishMode,
        timezone: output.timezone.trim() || "UTC",
        allowedPublishWindows: output.allowedWindow.trim().length > 0 ? [output.allowedWindow.trim()] : [],
        minimumGapMinutes: toInteger(output.minimumGapMinutes, 10),
        maxPostsPerHour: toInteger(output.maxPostsPerHour, 4),
        maxPostsPerDay: toInteger(output.maxPostsPerDay, 24),
        queuePriority: toInteger(output.queuePriority, 0),
        signatureEnabled: output.signatureEnabled,
        signatureText: output.signatureText.trim(),
        signatureChannelHandle: output.signatureChannelHandle.trim(),
        signaturePosition: "append"
      }))
    }];
  }

  async function save(): Promise<void> {
    if (routeId.trim().length === 0 || category.trim().length === 0 || sourceChatId.trim().length === 0) {
      setLocalMessage("Route ID, category, and source chat ID are required.");
      return;
    }
    if (!Number.isInteger(toInteger(sourceThreadId, NaN))) {
      setLocalMessage("Source topic ID must be numeric.");
      return;
    }
    setLocalMessage(undefined);
    await props.onSave(routePreview);
  }

  function updateOutput(index: number, patch: Partial<OutputDraft>): void {
    setOutputs((current: OutputDraft[]) => current.map((output: OutputDraft, outputIndex: number) => outputIndex === index ? { ...output, ...patch } : output));
  }

  return <details className="panel" open>
    <summary>MVP route builder</summary>
    <p className="muted">Use this for your manual test: one source topic, multiple language review topics, one final channel per language. It writes real D1 route/output rows.</p>
    {localMessage && <p className="warningText">{localMessage}</p>}
    <div className="grid two">
      <label>Route ID<input value={routeId} onChange={(event: any) => setRouteId(event.target.value)} placeholder="crypto" /></label>
      <label>Category<input value={category} onChange={(event: any) => setCategory(event.target.value)} placeholder="crypto" /></label>
      <label>Source chat ID<input value={sourceChatId} onChange={(event: any) => setSourceChatId(event.target.value)} placeholder="-100..." /></label>
      <label>Source topic ID<input value={sourceThreadId} onChange={(event: any) => setSourceThreadId(event.target.value)} placeholder="101" /></label>
      <label>Prompt profile<input value={promptProfile} onChange={(event: any) => setPromptProfile(event.target.value)} placeholder="crypto_editorial" /></label>
      <label className="checkRow"><input type="checkbox" checked={enabled} onChange={(event: any) => setEnabled(event.target.checked)} /> Enabled</label>
    </div>
    <h3>Language outputs</h3>
    <div className="grid three">
      {outputs.map((output: OutputDraft, index: number) => <article className="panel softPanel" key={output.idSuffix}>
        <label className="checkRow"><input type="checkbox" checked={output.enabled} onChange={(event: any) => updateOutput(index, { enabled: event.target.checked })} /> {output.language.toUpperCase()} enabled</label>
        <label>Output suffix<input value={output.idSuffix} onChange={(event: any) => updateOutput(index, { idSuffix: event.target.value })} /></label>
        <label>Language<input value={output.language} onChange={(event: any) => updateOutput(index, { language: event.target.value })} /></label>
        <label>Review topic ID<input value={output.reviewThreadId} onChange={(event: any) => updateOutput(index, { reviewThreadId: event.target.value })} /></label>
        <label>Final channel<input value={output.finalChatId} onChange={(event: any) => updateOutput(index, { finalChatId: event.target.value })} /></label>
        <label>Publish mode<select value={output.publishMode} onChange={(event: any) => updateOutput(index, { publishMode: event.target.value as OutputDraft["publishMode"] })}><option value="scheduled">scheduled</option><option value="queued">queued</option><option value="immediate">immediate</option></select></label>
        <label>Timezone<input value={output.timezone} onChange={(event: any) => updateOutput(index, { timezone: event.target.value })} /></label>
        <label>Allowed window<input value={output.allowedWindow} onChange={(event: any) => updateOutput(index, { allowedWindow: event.target.value })} placeholder="09:00-23:00" /></label>
        <label>Gap minutes<input value={output.minimumGapMinutes} onChange={(event: any) => updateOutput(index, { minimumGapMinutes: event.target.value })} /></label>
        <label>Max/hour<input value={output.maxPostsPerHour} onChange={(event: any) => updateOutput(index, { maxPostsPerHour: event.target.value })} /></label>
        <label>Max/day<input value={output.maxPostsPerDay} onChange={(event: any) => updateOutput(index, { maxPostsPerDay: event.target.value })} /></label>
        <label className="checkRow"><input type="checkbox" checked={output.signatureEnabled} onChange={(event: any) => updateOutput(index, { signatureEnabled: event.target.checked })} /> Channel signature</label>
        <label>Signature text<textarea value={output.signatureText} onChange={(event: any) => updateOutput(index, { signatureText: event.target.value })} placeholder="Optional footer text" /></label>
        <label>Public channel handle<input value={output.signatureChannelHandle} onChange={(event: any) => updateOutput(index, { signatureChannelHandle: event.target.value })} placeholder="@channel" /></label>
      </article>)}
    </div>
    <div className="buttonRow"><button type="button" onClick={() => void save()} disabled={props.busy}>Save MVP route</button></div>
    <details><summary>Generated route JSON</summary><pre>{JSON.stringify(routePreview, null, 2)}</pre></details>
  </details>;
}

function toInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
