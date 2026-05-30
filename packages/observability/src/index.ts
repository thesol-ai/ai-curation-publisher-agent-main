export type LogLevel = "debug" | "info" | "warn" | "error";
export function logPhaseOneEvent(level: LogLevel, message: string, context: Record<string, unknown> = {}): void { console.log(JSON.stringify({ level, message, context })); }
