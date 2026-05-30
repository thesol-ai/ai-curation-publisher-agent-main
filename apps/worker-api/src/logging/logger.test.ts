import { describe, expect, it } from "vitest";
import { createLogger, redactSecrets } from "./logger";

describe("logger redaction", () => {
  it("redacts known secret-like keys recursively", () => {
    const redacted = redactSecrets({
      token: "value",
      nested: {
        apiKey: "value",
        applicationPassword: "value",
        safe: "visible"
      },
      headers: {
        authorization: "Bearer value"
      }
    });

    expect(redacted).toEqual({
      token: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        applicationPassword: "[REDACTED]",
        safe: "visible"
      },
      headers: {
        authorization: "[REDACTED]"
      }
    });
  });

  it("writes structured redacted logs", () => {
    const entries: Array<{ level: string; payload: Record<string, unknown> }> = [];
    const logger = createLogger({
      level: "debug",
      sink(level, payload) {
        entries.push({ level, payload });
      }
    });

    logger.info("configured", { internalSecret: "value", visible: true });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe("info");
    expect(entries[0]?.payload).toMatchObject({
      level: "info",
      message: "configured",
      context: {
        internalSecret: "[REDACTED]",
        visible: true
      }
    });
  });
});
