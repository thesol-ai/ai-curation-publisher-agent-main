# Operational Safety V1

This phase makes final publishing safer and easier to debug.

## Goals

- Show media readiness before final publishing.
- Preview caption, media and prompt status before `Publish now`.
- Explain due publishing results with checked/published/skipped/failed counts.
- Provide an item timeline across ingest, prompt, media, review, queue and publish events.
- Let operators search and reset history by source URL in staging.
- Show detailed media job diagnostics.

## New internal routes

- `POST /internal/telegram/publish/preview`
- `GET /internal/admin/timeline`
- `POST /internal/admin/test-data/dedupe-search`

## Dashboard changes

- Publish queue rows include media status and prompt status.
- Publish preview card shows blockers and warnings.
- Activity tab can load a timeline by item ID, queue ID, generated output ID or source URL.
- Diagnostics includes dedupe search and URL reset controls.
- Media tab includes a media job details card.

## Publish blockers

The preview blocks immediate publishing when:

- generated output is missing;
- route output is missing;
- publishing is disabled for the output;
- media is pending or partial;
- media failed and text fallback for final publishing is disabled;
- queue status is not actionable.

## Prompt run logging MVP

Prompt runs are recorded in the existing `prompt_runs` table for mock and real generation attempts. The current implementation logs input/output token counts where available, status, model/provider and error message.

