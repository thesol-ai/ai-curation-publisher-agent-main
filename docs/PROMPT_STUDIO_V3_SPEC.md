# Prompt Studio V3 Spec

Prompt Studio should be route/output-first, not prompt-ID-first.

## Required operator context

At the top of Prompt Studio the operator should see:

```text
Route
Output
Category
Language
Content type
Active prompt
Binding status
```

## Implemented initial controls

- Route/output context selector.
- Active prompt map.
- Binding status surfaced near the top.
- Prompt library with usage information.
- Preview scaffolding for raw response, parsed output, final caption, and validation.
- Diff collapsed by default.

## Phase 2 requirements

- Log real prompt workflow runs.
- Store raw AI response, parsed output, validation status, fallback status, and generated output ID.
- Move parser/schema errors out of Telegram review captions and into dashboard diagnostics/run history.
- Add configurable fallback behavior for invalid JSON.
