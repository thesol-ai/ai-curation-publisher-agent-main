import { describe, expect, it } from "vitest";
import { createMockWordPressOutput, validateWordPressOutput } from "./wordpress-output";

describe("validateWordPressOutput", () => {
  it("accepts complete WordPress output", () => {
    const result = validateWordPressOutput(createMockWordPressOutput());

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects missing required long-form fields", () => {
    const result = validateWordPressOutput(createMockWordPressOutput({
      title_fa: " ",
      excerpt_fa: " ",
      body_fa: " ",
      source_attribution: " "
    }));

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toEqual([
      "title_fa",
      "excerpt_fa",
      "body_fa",
      "source_attribution"
    ]);
  });
});
