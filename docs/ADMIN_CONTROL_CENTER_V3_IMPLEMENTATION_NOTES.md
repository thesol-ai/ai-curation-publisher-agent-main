# Admin Control Center V3 Implementation Notes

This patch moves the dashboard toward an operator-grade control center instead of a raw settings/debug panel.

## Implemented in this patch

### Trust and configuration reliability

- Added environment and D1 visibility to the dashboard shell through the admin summary payload.
- Added source-aware secret status so the UI can distinguish `missing`, `env_or_worker_secret`, and `encrypted_d1_override`.
- Settings rows now show effective value, draft value, source, secret status, and per-setting save state.
- Save handling no longer blindly refreshes the whole dashboard after every setting change. It refreshes admin configuration and related readiness status only.
- Boolean and secret UI checks are strict, using `item.isSecret === true` rather than loose truthiness.

### Category, topic, language, and output topology

- Added a category scope selector derived from configured routes.
- Added category health and category workspace panels to make Route -> Output -> Review -> Prompt -> Final Channel relationships visible.
- Added an output matrix per category with review topic, final channel, prompt binding, publish policy, and issue status.
- Added derived topic labels from route/output/media configuration so operators see human-readable topic context rather than raw thread IDs only.

### Prompt Studio

- Added route/output context selector.
- Added active prompt map by category, language, and output.
- Moved binding context up so operators can see whether a prompt affects a live output.
- Added preview scaffolding that separates raw backend response, parsed/final output expectations, and validation signals.
- Collapsed visual diff by default and reduced noise.

### Publishing and media clarity

- Added route output timing summary to Publishing.
- Publishing queue table now includes more route/output context.
- Added scheduler dry-run, cron, quota, and final publishing context where available.
- Added a media pipeline diagram and stronger media job context.

### Staging test tools

- Added internal staging-only test data reset endpoint.
- Added dashboard UI for operational test data counts and scoped reset actions.
- Reset is rejected unless `ENVIRONMENT=staging` and confirmation is exactly `RESET STAGING`.
- Reset preserves admin configuration, routes, outputs, prompts, settings, migrations, and secrets.

## Main files changed

- `apps/worker-api/src/index.ts`
- `apps/worker-api/src/types.ts`
- `apps/worker-api/src/routes/internal-admin-overview.ts`
- `apps/worker-api/src/routes/internal-admin-test-data.ts`
- `apps/dashboard/src/api.ts`
- `apps/dashboard/src/ModernDashboardApp.tsx`
- `apps/dashboard/src/features/admin-control/category-topology.tsx`
- `apps/dashboard/src/features/admin-control/settings-editor.tsx`
- `apps/dashboard/src/features/admin-control/route-output-builder.tsx`
- `apps/dashboard/src/features/admin-control/prompt-studio-panel.tsx`
- `apps/dashboard/src/features/admin-control/publish-queue-table.tsx`
- `apps/dashboard/src/modern.css`

## Still recommended for Phase 2

- Persisted Telegram Topic Registry instead of derived labels only.
- Full prompt run logging for real AI workflow executions.
- Stronger publish confirmation modal with final caption/media preview.
- Media job retry/cancel/open-GitHub-run actions if backend endpoints exist.
- Dedupe search and reset-by-URL with full traceability.
- A full category-first setup wizard.
- Query-layer refactor with TanStack Query or an equivalent internal query manager.
