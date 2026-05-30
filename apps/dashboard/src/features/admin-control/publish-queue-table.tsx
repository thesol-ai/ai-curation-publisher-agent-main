import { useMemo, useState } from "react";
import { Badge, Button, DataTable } from "../../shared/ui";
import type { JsonObject } from "../../types";
import { readNumber, readString, shortId, statusTone } from "./dashboard-utils";

type PublishQueueTableProps = {
  rows: JsonObject[];
  onPublishNow: (queueId: string) => Promise<void>;
  onCancel: (queueId: string) => Promise<void>;
  onReschedule: (queueId: string) => Promise<void>;
  onBulkPublishNow?: (queueIds: string[]) => Promise<void>;
  onPreview?: (queueId: string) => Promise<void>;
  onTimeline?: (input: { itemId?: string; queueId?: string; generatedOutputId?: string }) => Promise<void>;
  busyQueueId: string | undefined;
};

export function PublishQueueTable({ rows, onPublishNow, onCancel, onReschedule, onBulkPublishNow, onPreview, onTimeline, busyQueueId }: PublishQueueTableProps): JSX.Element {
  const [selected, setSelected] = useState<string[]>([]);
  const actionableIds = useMemo(() => rows.flatMap((row) => {
    const queueId = readString(row, "queueId") ?? readString(row, "id");
    return queueId && isActionable(readString(row, "status")) ? [queueId] : [];
  }), [rows]);
  const selectedActionable = selected.filter((queueId) => actionableIds.includes(queueId));

  function toggle(queueId: string): void { setSelected((current) => current.includes(queueId) ? current.filter((entry) => entry !== queueId) : [...current, queueId]); }
  function toggleAll(): void { setSelected((current) => current.filter((queueId) => actionableIds.includes(queueId)).length === actionableIds.length ? [] : actionableIds); }

  return <div className="queue-table-stack">
    {onBulkPublishNow !== undefined && <div className="queue-bulk-toolbar"><Button size="sm" variant="secondary" onClick={toggleAll} disabled={actionableIds.length === 0}>{selectedActionable.length === actionableIds.length && actionableIds.length > 0 ? "Clear selection" : "Select actionable"}</Button><Button size="sm" disabled={selectedActionable.length === 0} onClick={() => void onBulkPublishNow(selectedActionable)}>Bulk publish selected ({selectedActionable.length})</Button><span className="muted-text">Bulk publish skips non-actionable rows.</span></div>}
    <DataTable rows={rows} columns={[{ key: "select", label: "Select", render: (row) => { const queueId = readString(row, "queueId") ?? readString(row, "id"); const actionable = isActionable(readString(row, "status")); return queueId && actionable ? <input aria-label={`Select ${queueId}`} type="checkbox" checked={selected.includes(queueId)} onChange={() => toggle(queueId)} /> : <span className="muted-text">-</span>; } }, { key: "queueId", label: "Queue", render: (row) => shortId(readString(row, "queueId") ?? readString(row, "id")) }, { key: "routeOutputId", label: "Output", render: (row) => readString(row, "routeOutputId") ?? shortId(readString(row, "generatedOutputId")) }, { key: "category", label: "Category" }, { key: "language", label: "Lang" }, { key: "finalChatId", label: "Final" }, { key: "media", label: "Media", render: (row) => <MediaStatusCell row={row} /> }, { key: "prompt", label: "Prompt", render: (row) => <PromptStatusCell row={row} /> }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "scheduledFor", label: "Scheduled" }, { key: "attemptCount", label: "Attempts" }, { key: "lastError", label: "Error" }, { key: "action", label: "Action", render: (row) => <QueueActions row={row} busyQueueId={busyQueueId} onPublishNow={onPublishNow} onCancel={onCancel} onReschedule={onReschedule} {...(onPreview === undefined ? {} : { onPreview })} {...(onTimeline === undefined ? {} : { onTimeline })} /> }]} />
  </div>;
}

function MediaStatusCell({ row }: { row: JsonObject }): JSX.Element {
  const status = readString(row, "mediaStatus") ?? "none";
  const assetCount = readNumber(row, "mediaAssetCount") ?? 0;
  const readyCount = readNumber(row, "mediaReadyAssetCount") ?? 0;
  const pending = readNumber(row, "mediaPendingJobCount") ?? 0;
  const failed = readNumber(row, "mediaFailedJobCount") ?? 0;
  const aspect = readNumber(row, "mediaAspectWarningCount") ?? 0;
  const tone = status === "ready" || status === "none" ? "success" : status === "failed" ? "danger" : "warning";
  return <div className="queue-media-cell"><Badge tone={tone}>{status}</Badge><small>{assetCount > 0 ? `${readyCount}/${assetCount} assets` : "no media"}{pending > 0 ? ` · ${pending} pending` : ""}{failed > 0 ? ` · ${failed} failed` : ""}{aspect > 0 ? ` · ${aspect} aspect` : ""}</small></div>;
}

function PromptStatusCell({ row }: { row: JsonObject }): JSX.Element {
  const prompt = readString(row, "promptProfileId") ?? "-";
  const status = readString(row, "promptStatus") ?? "unknown";
  const fallback = row.promptFallbackUsed === true;
  return <div className="queue-media-cell"><span>{shortId(prompt)}</span><small>{fallback ? "fallback" : status}</small></div>;
}

function QueueActions({ row, busyQueueId, onPublishNow, onCancel, onReschedule, onPreview, onTimeline }: { row: JsonObject; busyQueueId: string | undefined; onPublishNow: (queueId: string) => Promise<void>; onCancel: (queueId: string) => Promise<void>; onReschedule: (queueId: string) => Promise<void>; onPreview?: (queueId: string) => Promise<void>; onTimeline?: (input: { itemId?: string; queueId?: string; generatedOutputId?: string }) => Promise<void> }): JSX.Element {
  const queueId = readString(row, "queueId") ?? readString(row, "id");
  const status = readString(row, "status");
  if (!queueId) return <span className="muted-text">-</span>;
  const busy = busyQueueId === queueId;
  const actionable = isActionable(status);
  return <div className="inline-actions">{onPreview && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onPreview(queueId)}>Preview</Button>}{actionable && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onPublishNow(queueId)}>{busy ? "Publishing..." : "Publish now"}</Button>}<Button size="sm" variant="ghost" disabled={busy || status === "failed" || !actionable} onClick={() => void onReschedule(queueId)}>Reschedule</Button>{onTimeline && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onTimeline(timelineInputForRow(row, queueId))}>Timeline</Button>}{actionable && <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onCancel(queueId)}>Cancel</Button>}</div>;
}

function timelineInputForRow(row: JsonObject, queueId: string): { itemId?: string; queueId?: string; generatedOutputId?: string } {
  const itemId = readString(row, "itemId");
  const generatedOutputId = readString(row, "generatedOutputId");
  return {
    queueId,
    ...(itemId === undefined ? {} : { itemId }),
    ...(generatedOutputId === undefined ? {} : { generatedOutputId })
  };
}

function isActionable(status: string | undefined): boolean { return status === "pending" || status === "scheduled" || status === "failed"; }
