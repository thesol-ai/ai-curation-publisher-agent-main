import { Card, CardHeader, cx } from "./ui";

type Distribution = Record<string, number>;

export function DonutChartCard({ title, description, data }: { title: string; description: string; data: Distribution }): JSX.Element {
  const entries = Object.entries(data).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return <Card><CardHeader title={title} description={description} /><div className="chart-donut-layout"><div className="chart-donut" style={{ background: donutGradient(entries, total) }}><span>{total}</span></div><div className="chart-legend">{entries.length === 0 ? <span className="muted">No activity yet.</span> : entries.map(([key, value], index) => <div key={key}><i className={cx("chart-dot", `chart-dot-${index % 6}`)} /><span>{key}</span><strong>{value}</strong></div>)}</div></div></Card>;
}

export function BarChartCard({ title, description, data }: { title: string; description: string; data: Distribution }): JSX.Element {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return <Card><CardHeader title={title} description={description} /><div className="chart-bars">{entries.length === 0 ? <div className="ui-empty">No data yet.</div> : entries.map(([key, value]) => <div className="chart-bar-row" key={key}><span>{key}</span><div><i style={{ width: `${Math.max(5, (value / max) * 100)}%` }} /></div><strong>{value}</strong></div>)}</div></Card>;
}

export function FunnelCard({ title, description, steps }: { title: string; description: string; steps: Array<{ label: string; value: number }> }): JSX.Element {
  const max = Math.max(1, ...steps.map((step) => step.value));
  return <Card><CardHeader title={title} description={description} /><div className="chart-funnel">{steps.map((step) => <div key={step.label} className="chart-funnel-step"><span>{step.label}</span><div><i style={{ width: `${Math.max(5, (step.value / max) * 100)}%` }} /></div><strong>{step.value}</strong></div>)}</div></Card>;
}

function donutGradient(entries: Array<[string, number]>, total: number): string {
  if (entries.length === 0 || total <= 0) return "conic-gradient(var(--muted) 0deg 360deg)";
  const colors = ["#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
  let cursor = 0;
  const parts = entries.map(([, value], index) => {
    const start = cursor;
    cursor += (value / total) * 360;
    return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
  });
  return `conic-gradient(${parts.join(", ")})`;
}
