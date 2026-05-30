export type LogLevel = "debug" | "info" | "warn" | "error";

export type LoggerSink = (level: LogLevel, payload: Record<string, unknown>) => void;

export type Logger = {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
};

const SECRET_KEY_PATTERN = /(token|secret|password|apikey|api_key|applicationpassword|application_password|authorization)/i;
const REDACTED = "[REDACTED]";

export function createLogger(options: { level?: LogLevel; sink?: LoggerSink } = {}): Logger {
  const configuredLevel = options.level ?? "info";
  const sink = options.sink ?? defaultSink;

  return {
    debug(message, context) {
      writeLog("debug", configuredLevel, sink, message, context);
    },
    info(message, context) {
      writeLog("info", configuredLevel, sink, message, context);
    },
    warn(message, context) {
      writeLog("warn", configuredLevel, sink, message, context);
    },
    error(message, context) {
      writeLog("error", configuredLevel, sink, message, context);
    }
  };
}

export function redactSecrets<T>(value: T): T {
  return redactValue(value, []) as T;
}

function writeLog(
  level: LogLevel,
  configuredLevel: LogLevel,
  sink: LoggerSink,
  message: string,
  context: Record<string, unknown> | undefined
): void {
  if (!shouldLog(level, configuredLevel)) {
    return;
  }

  sink(level, {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context === undefined ? {} : { context: redactSecrets(context) })
  });
}

function shouldLog(level: LogLevel, configuredLevel: LogLevel): boolean {
  return levelWeight(level) >= levelWeight(configuredLevel);
}

function levelWeight(level: LogLevel): number {
  if (level === "debug") {
    return 10;
  }

  if (level === "info") {
    return 20;
  }

  if (level === "warn") {
    return 30;
  }

  return 40;
}

function redactValue(value: unknown, path: string[]): unknown {
  if (path.some((key) => SECRET_KEY_PATTERN.test(key))) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, path));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    redacted[key] = redactValue(childValue, [...path, key]);
  }

  return redacted;
}

function defaultSink(level: LogLevel, payload: Record<string, unknown>): void {
  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}
