import { describe, expect, it } from "vitest";
import { resolveExternalSourceText } from "./source-content-resolver";

describe("resolveExternalSourceText", () => {
  it("extracts X text from fxtwitter status payload for x.com/i/status links", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({
      status: {
        text: "Singapore’s Foreign Minister built his own AI agent using Claude and WhatsApp integration."
      }
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

    const result = await resolveExternalSourceText(
      {
        EXTERNAL_LINK_METADATA_ENABLED: "true",
        EXTERNAL_LINK_FETCH_TIMEOUT_MS: "8000"
      } as never,
      ["https://x.com/i/status/2055800354986434589"],
      fetchImpl as never
    );

    expect(result.text).toContain("Singapore’s Foreign Minister");
    expect(result.warning).toBeUndefined();
  });

  it("extracts X text from vxtwitter top-level text payload", async () => {
    let callCount = 0;
    const fetchImpl = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        text: "NVIDIA just unleashed SANA-WM and it is a major open source AI model update."
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const result = await resolveExternalSourceText(
      {
        EXTERNAL_LINK_METADATA_ENABLED: "true",
        EXTERNAL_LINK_FETCH_TIMEOUT_MS: "8000"
      } as never,
      ["https://x.com/i/status/2055492991918518692"],
      fetchImpl as never
    );

    expect(result.text).toContain("NVIDIA just unleashed");
    expect(result.warning).toBeUndefined();
  });
});
