export type D1Value = string | number | boolean | null | ArrayBuffer;
export type D1Result<T = unknown> = { results?: T[]; success: boolean; error?: string; meta?: Record<string, unknown> };
export type D1RunResult = D1Result & { changes?: number; lastRowId?: number };
export interface D1PreparedStatementLike { bind(...values: D1Value[]): D1PreparedStatementLike; first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<D1Result<T>>; run(): Promise<D1RunResult>; }
export interface D1DatabaseLike { prepare(query: string): D1PreparedStatementLike; batch?<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1Result<T>[]>; }
