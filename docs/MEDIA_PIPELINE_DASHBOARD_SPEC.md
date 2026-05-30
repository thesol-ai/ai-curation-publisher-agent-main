# Media Pipeline Dashboard Spec

Media handling should be visible as a pipeline:

```text
Source link -> GitHub workflow -> Telegram Media Cache -> file_id stored -> Review with media -> Final reuse
```

## Implemented initial controls

- Media pipeline diagram.
- Media mode/cache/workflow summary.
- Recent media jobs table with more operational columns.
- Media rule visibility: pending media should not produce duplicate text-only reviews; ready media should produce media review; failed media should use fallback review with warning.

## Phase 2 requirements

- GitHub workflow run status and open-run links.
- Retry/cancel media job actions.
- Per-item media trace from source message through callback and review.
