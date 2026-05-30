import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, DataTable, Select } from "../../shared/ui";
import type { JsonObject } from "../../types";
import { readNumber, readString, statusTone } from "./dashboard-utils";

type PromptDiffPanelProps = {
  profiles: JsonObject[];
};

export function PromptDiffPanel({ profiles }: PromptDiffPanelProps): JSX.Element {
  const [leftId, setLeftId] = useState(profiles[0] === undefined ? "" : readString(profiles[0], "id") ?? "");
  const [rightId, setRightId] = useState(profiles[1] === undefined ? "" : readString(profiles[1], "id") ?? leftId);
  const options = profiles.map((profile) => ({ value: readString(profile, "id") ?? "", label: `${readString(profile, "id") ?? "unknown"} · v${readString(profile, "version") ?? "?"}` })).filter((option) => option.value.length > 0);
  const left = profiles.find((profile) => readString(profile, "id") === leftId);
  const right = profiles.find((profile) => readString(profile, "id") === rightId);
  const systemDiff = useMemo(() => diffLines(readString(left, "systemPrompt") ?? "", readString(right, "systemPrompt") ?? ""), [left, right]);
  const userDiff = useMemo(() => diffLines(readString(left, "userPromptTemplate") ?? "", readString(right, "userPromptTemplate") ?? ""), [left, right]);

  if (profiles.length < 2) {
    return <Card><CardHeader title="Prompt visual diff" description="Create at least two prompt versions to compare system and user templates side by side." /><div className="ui-empty">Not enough prompt profiles for a visual diff yet.</div></Card>;
  }

  return <Card><CardHeader title="Prompt visual diff" description="Compare two prompt versions before activating or rolling back." /><div className="grid two"><Select label="Left prompt" value={leftId} onChange={setLeftId} options={options} /><Select label="Right prompt" value={rightId} onChange={setRightId} options={options} /></div><PromptDiffBlock title="System prompt" rows={systemDiff} /><PromptDiffBlock title="User template" rows={userDiff} /></Card>;
}

export function PromptRunsTable({ runs }: { runs: JsonObject[] }): JSX.Element {
  return <Card><CardHeader title="Prompt run history" description="Recent prompt executions recorded by the backend. Empty history means prompt run logging has not produced records yet." /><DataTable rows={runs} columns={[{ key: "id", label: "Run", render: (row) => readString(row, "id") ?? "-" }, { key: "promptProfileId", label: "Prompt" }, { key: "promptVersion", label: "Version" }, { key: "provider", label: "Provider" }, { key: "model", label: "Model" }, { key: "status", label: "Status", render: (row) => <Badge tone={statusTone(readString(row, "status"))}>{readString(row, "status") ?? "unknown"}</Badge> }, { key: "tokens", label: "Tokens", render: (row) => `${readNumber(row, "inputTokens") ?? 0}/${readNumber(row, "outputTokens") ?? 0}` }, { key: "createdAt", label: "Created" }, { key: "errorMessage", label: "Error" }]} /></Card>;
}

function PromptDiffBlock({ title, rows }: { title: string; rows: DiffLine[] }): JSX.Element {
  return <div className="prompt-diff-block"><strong>{title}</strong><div className="prompt-diff-grid">{rows.map((row, index) => <div key={`${title}-${index}`} className={`prompt-diff-line prompt-diff-${row.kind}`}><span>{row.kind === "same" ? " " : row.kind === "added" ? "+" : "-"}</span><code>{row.text || " "}</code></div>)}</div></div>;
}

type DiffLine = { kind: "same" | "added" | "removed"; text: string };

function diffLines(left: string, right: string): DiffLine[] {
  const leftLines = left.split(/\r?\n/);
  const rightLines = right.split(/\r?\n/);
  const rows: DiffLine[] = [];
  const max = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < max; index += 1) {
    const l = leftLines[index] ?? "";
    const r = rightLines[index] ?? "";
    if (l === r) rows.push({ kind: "same", text: l });
    else {
      if (l.length > 0) rows.push({ kind: "removed", text: l });
      if (r.length > 0) rows.push({ kind: "added", text: r });
    }
  }
  return rows.length === 0 ? [{ kind: "same", text: "No prompt content." }] : rows;
}
