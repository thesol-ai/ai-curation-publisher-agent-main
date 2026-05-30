# Publishing Control V3 Spec

Publishing must separate manual publishing, automatic scheduler behavior, queue limits, route output timing, and Worker cron.

## Implemented initial controls

- Route output timing summary.
- Scheduler dry-run and cron context where available from summary.
- Queue table with additional route/output context.
- Category/output filtering where queue rows contain enough context.

## Phase 2 requirements

- Strong publish confirmation modal with final channel, caption preview, media status, and bypass warnings.
- Run-due publishing outcome details: checked, published, skipped, failed, and skip reasons.
- Per-output publish timeline and next eligible publish time.
