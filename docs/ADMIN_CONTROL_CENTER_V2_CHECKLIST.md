# Admin Control Center V2 Checklist

## Implemented

- [x] Preserved existing React/Vite/shadcn-style dashboard foundation.
- [x] Preserved existing Telegram social media curation workflow.
- [x] Preserved Media Cache / Internal Media Registry architecture.
- [x] Preserved publish-now endpoint and dashboard action.
- [x] Added feature-level files under `apps/dashboard/src/features/admin-control/`.
- [x] Moved publish queue table behavior out of the main dashboard file.
- [x] Moved route/output builder behavior out of the main dashboard file.
- [x] Moved settings editor behavior out of the main dashboard file.
- [x] Moved Prompt Studio panel behavior out of the main dashboard file.
- [x] Moved setup wizard/permission matrix behavior out of the main dashboard file.
- [x] Added clearer Worker URL/Admin secret connection management.
- [x] Added Clear connection.
- [x] Added metadata-driven Settings Center based on `/internal/admin/config`.
- [x] Added AI Settings page with model presets and provider test action.
- [x] Added Provider Settings page with credential/readiness test actions.
- [x] Added optional generic live HTTP probe for Apify/GetXAPI when a URL is provided.
- [x] Added Telegram Settings page with bot and chat/topic reachability checks.
- [x] Added Telegram permission matrix for configured review/final targets in Setup.
- [x] Preserved Media Registry and added editable media-related settings.
- [x] Added Routes & Outputs Builder for create/update/disable route and output rows.
- [x] Added Publishing Control page with queue filters and manual actions.
- [x] Added publish queue cancel/reschedule/bulk publish backend actions.
- [x] Added bulk publish selected UI.
- [x] Added prompt version visibility, archive, rollback-by-activation.
- [x] Added visual prompt diff.
- [x] Added prompt run history table.
- [x] Added prompt preview run recording.
- [x] Added safe config import preview UI.
- [x] Added daily time-series metrics payload and overview trend cards.
- [x] Added implementation report and user guide.

## Partially implemented

- [~] Setup Wizard 2.0 supports navigation and targeted tests, but not persisted per-step state.
- [~] Prompt run history records preview runs; real AI generation path logging remains follow-up.
- [~] Visual prompt diff is line-based, not a rich side-by-side editor.
- [~] Apify/GetXAPI live tests support credential readiness and optional generic HTTP probe, but not provider-specific contracts.
- [~] Config import UI is preview-only and does not apply changes.
- [~] Dashboard is more modular, but the orchestration shell still contains some page-level components.

## Not implemented yet

- [ ] Destructive/apply config import workflow.
- [ ] Fully transactional setup wizard with saved step state.
- [ ] Prompt run logging from real production AI generation.
- [ ] Rich semantic prompt diff and version comparison UI.
- [ ] Provider-specific Apify/GetXAPI tests based on official API contracts.
- [ ] Advanced weekly/monthly executive reporting beyond current time-series payload.

## Tested here

- [x] `node scripts/lint.mjs`

## Must be tested after uploading ZIP to a branch

- [ ] `pnpm install`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm dashboard:build`
- [ ] Staging deploy.
- [ ] Dashboard smoke test.
- [ ] Route/output builder smoke test on staging.
- [ ] AI/provider/Telegram test endpoint smoke test.
- [ ] Publish queue publish/cancel/reschedule/bulk smoke test.
- [ ] Prompt preview/diff/run-history smoke test.
- [ ] Config import preview smoke test.

## Manual review needed

- [ ] Confirm no secret values are displayed in dashboard pages or API responses.
- [ ] Confirm existing social media ingest/review workflow still works.
- [ ] Confirm Media Registry uploads still target the internal cache topic.
- [ ] Confirm published queue rows cannot be manually re-published.
- [ ] Confirm route/output edits are intentional before saving on production data.
- [ ] Confirm config import preview cannot mutate D1.
