import type { ReactNode } from "react";

type Tone = "default" | "muted" | "success" | "warning" | "danger" | "info";

type ButtonProps = {
  children: ReactNode;
  type?: "button" | "submit" | "reset";
  variant?: "default" | "secondary" | "ghost" | "destructive";
  size?: "default" | "sm";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
};

export function Button({ children, type = "button", variant = "default", size = "default", disabled, onClick, className }: ButtonProps): JSX.Element {
  return <button type={type} className={cx("ui-button", `ui-button-${variant}`, size === "sm" ? "ui-button-sm" : undefined, className)} disabled={disabled} onClick={onClick}>{children}</button>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
  return <section className={cx("ui-card", className)}>{children}</section>;
}

export function CardHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }): JSX.Element {
  return <div className="ui-card-header"><div>{eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="ui-card-action">{action}</div>}</div>;
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: Tone }): JSX.Element {
  return <span className={cx("ui-badge", `ui-badge-${tone}`)}>{children}</span>;
}

export function Alert({ title, children, tone = "info" }: { title: string; children: ReactNode; tone?: Tone }): JSX.Element {
  return <div className={cx("ui-alert", `ui-alert-${tone}`)}><strong>{title}</strong><div>{children}</div></div>;
}

export function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }): JSX.Element {
  return <label className="ui-field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value)} /></label>;
}

export function Textarea({ label, value, onChange, placeholder, rows = 8 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number }): JSX.Element {
  return <label className="ui-field"><span>{label}</span><textarea value={value} placeholder={placeholder} rows={rows} onChange={(event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value)} /></label>;
}

export function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }): JSX.Element {
  return <label className="ui-field"><span>{label}</span><select value={value} onChange={(event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}


export function Switch({ label, checked, onChange, disabled, description }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; description?: string }): JSX.Element {
  return <label className="ui-switch-field"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><button type="button" className={cx("ui-switch", checked ? "ui-switch-on" : undefined)} aria-pressed={checked} disabled={disabled} onClick={() => onChange(!checked)}><i /></button></label>;
}

export function Progress({ value, label }: { value: number; label?: string }): JSX.Element {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return <div className="ui-progress" aria-label={label ?? "Progress"}><div className="ui-progress-header"><span>{label ?? "Progress"}</span><strong>{safeValue}%</strong></div><div className="ui-progress-track"><span style={{ width: `${safeValue}%` }} /></div></div>;
}

export function StatCard({ label, value, helper, tone = "default" }: { label: string; value: string | number; helper?: string; tone?: Tone }): JSX.Element {
  return <Card className="ui-stat-card"><div className="ui-stat-top"><span>{label}</span><Badge tone={tone}>{tone}</Badge></div><strong>{value}</strong>{helper && <p>{helper}</p>}</Card>;
}

export function DataTable<T>({ columns, rows, emptyText = "No data yet." }: { columns: Array<{ key: string; label: string; render?: (row: T) => ReactNode }>; rows: T[]; emptyText?: string }): JSX.Element {
  if (rows.length === 0) return <div className="ui-empty">{emptyText}</div>;
  return <div className="ui-table-wrap"><table className="ui-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : readCell(row, column.key)}</td>)}</tr>)}</tbody></table></div>;
}

function readCell<T>(row: T, key: string): ReactNode {
  if (typeof row !== "object" || row === null) return "";
  const value = (row as Record<string, unknown>)[key];
  if (value === undefined || value === null) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function cx(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}
