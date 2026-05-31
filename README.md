# AI Curation Publisher Agent

AI Curation Publisher Agent is a provider-agnostic content curation, AI rewriting, Telegram review, media staging, and controlled publishing pipeline built on Cloudflare Workers, Cloudflare D1, Telegram, GitHub Actions, and a React/Vite admin dashboard.

The system is designed for review-first social publishing workflows:

1. Ingest content from Telegram source topics or configured sources.
2. Normalize and deduplicate source items.
3. Resolve source text, links, and metadata.
4. Generate localized editorial output with AI prompt profiles.
5. Stage or process media when needed.
6. Send review cards to Telegram review topics.
7. Let humans edit, approve, cancel, send, or schedule output.
8. Queue approved output safely.
9. Publish to final Telegram channels only when final publishing is explicitly enabled.

The default posture is intentionally safe: mock providers by default, scheduler publishing disabled by default, final Telegram publishing disabled by default, and production-sensitive secrets kept out of source control.

---

## Current status

Current status: **MVP / staging-operational**.

Implemented areas include:

- Cloudflare Worker API.
- Cloudflare D1 persistence.
- React/Vite Admin Control Center dashboard.
- Telegram source-topic ingest.
- Telegram topic route management.
- Telegram review cards and review callbacks.
- Reply-based Telegram edit workflow.
- Telegram publish queue.
- Safe manual publish controls.
- Media processing through GitHub Actions.
- Telegram media cache/staging support.
- AI prompt profiles, prompt bindings, prompt preview, and output validation.
- Admin config, validation, metrics, timeline, diagnostics, and safe test endpoints.
- Apify + Claude autonomous curation tables and trigger routes, disabled by default.
- WordPress dry-run integration, optional.
- CI, deploy, D1 migration, dashboard deploy, smoke, media processor, backup, agent-task, and auto-merge workflows.

Not guaranteed by default:

- Fully automated production publishing.
- Real production scraping from every external platform.
- Guaranteed media extraction from rate-limited social platforms.
- Local parity with Cloudflare Workers, Telegram, GitHub Actions, and D1 remote behavior.
- Production readiness without explicit secrets, real route validation, staging smoke tests, and manual review.

---

## Architecture

High-level flow:

```text
Telegram source topic / configured source
        ↓
Cloudflare Worker
        ↓
Normalize item + dedupe
        ↓
Resolve source text and metadata
        ↓
Generate AI output with prompt profile
        ↓
Dispatch media processor when external media is expected
        ↓
GitHub Actions media processor
        ↓
Telegram media cache/staging chat
        ↓
Telegram review topic
        ↓
Reviewer edit / status / cancel / send / schedule
        ↓
Telegram publish queue
        ↓
Final Telegram channel, only when explicitly enabled
```

The Worker owns request routing, orchestration, internal APIs, runtime config resolution, authentication checks, D1 persistence, review callbacks, media callbacks, publish decisions, and scheduled polling.

GitHub Actions owns expensive or platform-dependent media work such as `yt-dlp`, `gallery-dl`, `instaloader`, `ffmpeg`, Telegram media staging, and callback delivery to the Worker.

Telegram is used for three separate roles:

1. Source input.
2. Human review UI.
3. Media cache/staging before final publish.

The dashboard is an operator interface over protected Worker Admin APIs. It does not call Cloudflare APIs directly and must not receive Cloudflare deployment tokens.

---

## Repository structure

```text
.
├── apps/
│   ├── dashboard/                  # React/Vite operator dashboard
│   └── worker-api/                 # Cloudflare Worker API and orchestration
├── packages/
│   ├── ai/                         # AI schemas, providers, prompt rendering, output validation
│   ├── core/                       # Shared core types, lifecycle, dedupe, validation utilities
│   ├── db/                         # D1 migrations, repositories, services
│   ├── media/                      # Media-related shared services and mocks
│   ├── observability/              # Logging and diagnostics utilities
│   ├── providers/                  # Provider adapters, config, mocks, mappers
│   ├── scheduler/                  # Polling and scheduling support
│   ├── telegram/                   # Telegram client, parser, review UI, media policy, publish helpers
│   └── wordpress/                  # WordPress draft/publish output helpers
├── scripts/
│   ├── media_processor.py          # GitHub Actions media processor
│   ├── media-processor.mjs         # Legacy/helper media script
│   ├── setup-cloudflare.mjs        # Cloudflare setup helper
│   ├── check-production-readiness.mjs
│   ├── telegram-set-webhook.mjs
│   └── telegram-mvp-smoke.mjs
├── .github/workflows/
│   ├── ci.yml
│   ├── deploy-cloudflare.yml
│   ├── deploy-dashboard-pages.yml
│   ├── d1-migrations.yml
│   ├── backup-d1.yml
│   ├── media-processor.yml
│   ├── smoke-test.yml
│   ├── agent-task.yml
│   └── auto-merge-safe.yml
├── wrangler.toml
├── .env.example
├── package.json
├── pnpm-lock.yaml
└── README.md
```

Important Worker areas:

```text
apps/worker-api/src/index.ts
apps/worker-api/src/routes/
apps/worker-api/src/telegram-topic-workflow/
apps/worker-api/src/operations/
apps/worker-api/src/admin-config/
apps/worker-api/src/security/
```

Important dashboard areas:

```text
apps/dashboard/src/ModernDashboardApp.tsx
apps/dashboard/src/api.ts
apps/dashboard/src/storage.ts
apps/dashboard/src/features/admin-control/
apps/dashboard/src/shared/
apps/dashboard/src/modern.css
```

Important media areas:

```text
scripts/media_processor.py
.github/workflows/media-processor.yml
apps/worker-api/src/telegram-topic-workflow/media-processing-orchestrator.ts
apps/worker-api/src/media/github-media-processor.ts
packages/media/src/
packages/telegram/src/media-policy.ts
```

---

## Core modules

### Worker API

Location: `apps/worker-api/`

Responsibilities:

- Public health, status, and readiness routes.
- Telegram webhook handling.
- Internal admin APIs.
- Admin config and safe runtime summaries.
- Telegram topic route management.
- Telegram topic ingest orchestration.
- Review callback orchestration.
- Reply-based review edit handling.
- Media processing dispatch and callback handling.
- Publish preview, queue, retry, due-run, and publish-now routes.
- Apify curation trigger and audit routes.
- WordPress dry-run route.
- Scheduler and poller execution.
- D1 repository usage.
- Internal authentication enforcement when `INTERNAL_API_SECRET` is configured.

Main request router: `apps/worker-api/src/index.ts`.

### Dashboard

Location: `apps/dashboard/`

Responsibilities:

- Worker connection and Admin secret entry.
- Readiness and operational overview.
- Settings Center from Worker Admin Config API.
- AI settings and AI test actions.
- Provider readiness and optional test actions.
- Telegram status and permission checks.
- Route and output builder.
- Category workspace and topology view.
- Media jobs and media settings.
- Prompt Studio, prompt preview, bindings, activation, archive, diff, and run history.
- Publish queue filters and manual actions.
- Diagnostics, timeline lookup, dedupe search, and safe config import preview.
- Technical redacted payload view for debugging.

Main app shell: `apps/dashboard/src/ModernDashboardApp.tsx`.

### AI package

Location: `packages/ai/`

Responsibilities:

- Prompt definitions.
- Localized Telegram prompt rendering.
- Mock, OpenAI, Gemini, and custom JSON provider wrappers.
- AI output service.
- Telegram output schema handling.
- Output normalization and validation.
- Safe fallback behavior.

Runtime AI provider selection happens in `apps/worker-api/src/telegram-topic-workflow/output-orchestrator.ts`.

### DB package

Location: `packages/db/`

Responsibilities:

- D1 migrations.
- Repository wrappers.
- Items, sources, dedupe keys, outputs, review messages, media assets, media jobs, publish queue, routes, prompt profiles, admin config, audit, and curation persistence.

Important migration groups:

- `0001_initial_schema.sql`: source, item, dedupe, media, prompt, output, review, queue, WordPress, provider log, settings foundation.
- `0031_telegram_topic_routing.sql`: Telegram routes, route outputs, generated outputs, review messages, publish queue, Telegram media metadata columns.
- `0033_media_processing_jobs.sql`: async media job tracking.
- `0035_prompt_studio.sql`: prompt studio support.
- `0037_apify_curation_pipeline.sql`: Apify source config, crawl runs, and Claude curation decisions.

### Telegram package

Location: `packages/telegram/`

Responsibilities:

- Telegram update parsing.
- Reviewer allowlist helpers.
- Mock and real Telegram clients.
- Review message builders.
- Review callback controls.
- Media payload helpers.
- Media publish validation.
- Final publish helpers.
- Telegram API error redaction.

### Media processor

Locations:

```text
scripts/media_processor.py
.github/workflows/media-processor.yml
```

Responsibilities:

- Download external media from source URLs.
- Try fallback providers in configurable order.
- Use direct requests, `gallery-dl`, `instaloader`, `yt-dlp`, or an external fallback provider.
- Preserve aspect ratio.
- Prepare video/photo assets for Telegram limits.
- Use `ffmpeg` and `ffprobe` for video inspection and preparation.
- Upload staged media to Telegram cache/staging chat.
- Callback the Worker with Telegram file IDs, asset metadata, timings, warnings, and diagnostics.

### WordPress package

Location: `packages/wordpress/`

Responsibilities:

- WordPress output shaping.
- WordPress draft helpers.
- Real WordPress client support.

WordPress is optional for the current Telegram-first workflow.

---

## Runtime environments

### Local

Used for development, static checks, unit tests, dashboard development, mock Worker routes, and limited Worker testing.

Local does not fully reproduce Cloudflare Worker + Telegram + GitHub Actions + remote D1 behavior.

### Staging

Used for realistic Telegram review, media processor dispatch, D1 migrations, dashboard checks, and controlled integration testing.

Staging may enable real review and GitHub Actions media processing while keeping provider automation, Claude curation, scheduler publishing, and final public publishing controlled.

### Production

Production must be enabled cautiously. Do not assume production is ready because staging works.

Production publishing requires explicit secrets, final route validation, bot permissions, final channel configuration, queue readiness, and `TELEGRAM_FINAL_PUBLISH_ENABLED=true`.

---

## Local development

Requirements:

- Node.js 22+
- pnpm 9.15.4
- Wrangler 3.x or a compatible project version
- Python 3.11+ for media processor work
- Cloudflare account for remote Worker/D1 flows
- Telegram bot for real Telegram flows

Install dependencies:

```bash
pnpm install
```

Create local config:

```bash
cp .env.example .env.local
```

Run the Worker locally:

```bash
pnpm dev
```

Run the dashboard locally:

```bash
pnpm dashboard:dev
```

Run checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dashboard:build
```

Run mock Worker smoke checks:

```bash
pnpm worker:smoke
pnpm worker:e2e:mock
```

Run local media processor manually:

```bash
python scripts/media_processor.py \
  --job-id test_job \
  --item-id test_item \
  --source-url https://example.com/media.mp4 \
  --callback-url http://localhost:8787/internal/media/processing/callback
```

---

## Cloudflare setup

The Worker is configured through `wrangler.toml`.

Main Worker entry:

```toml
main = "apps/worker-api/src/index.ts"
```

D1 binding:

```toml
[[d1_databases]]
binding = "DB"
database_name = "your_database_name"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "packages/db/migrations"
```

Before staging or production use, replace placeholder values in `wrangler.toml`:

- Worker name.
- D1 database name.
- D1 database ID.
- `WORKER_PUBLIC_BASE_URL`.
- `GITHUB_MEDIA_PROCESSOR_REPOSITORY`.
- Telegram media staging/cache chat IDs.
- Any environment-specific provider switches.

---

## Secrets and configuration

Secrets must be set outside source control.

Common Worker secrets:

```bash
wrangler secret put INTERNAL_API_SECRET --env staging
wrangler secret put TELEGRAM_BOT_TOKEN --env staging
wrangler secret put TELEGRAM_WEBHOOK_SECRET --env staging
wrangler secret put GITHUB_MEDIA_PROCESSOR_TOKEN --env staging
wrangler secret put ANTHROPIC_API_KEY --env staging
wrangler secret put APIFY_TOKEN --env staging
```

Optional provider secrets:

```bash
wrangler secret put OPENAI_API_KEY --env staging
wrangler secret put GEMINI_API_KEY --env staging
wrangler secret put CUSTOM_AI_API_KEY --env staging
wrangler secret put FIRECRAWL_API_KEY --env staging
wrangler secret put GETXAPI_KEY --env staging
```

GitHub Actions secrets for media processing:

| Secret | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Upload media into Telegram cache/staging chat. |
| `TELEGRAM_MEDIA_CACHE_CHAT_ID` | Target chat for staged media uploads. |
| `TELEGRAM_MEDIA_STAGING_CHAT_ID` | Optional separate staging chat. |
| `WORKER_INTERNAL_API_SECRET` | Must match Worker `INTERNAL_API_SECRET`. |
| `INSTAGRAM_COOKIES_B64` | Optional base64-encoded Instagram cookies. |
| `X_COOKIES_B64` | Optional base64-encoded X/Twitter cookies. |

`WORKER_INTERNAL_API_SECRET` in GitHub Actions must exactly match `INTERNAL_API_SECRET` in the Worker. The media processor sends it as `x-internal-api-secret` on callbacks.

---

## Safety switches

Important runtime switches:

| Key | Safe default | Purpose |
| --- | --- | --- |
| `PROVIDERS_MODE` | `mock` | Keeps provider behavior mocked unless intentionally changed. |
| `SCHEDULER_ENABLED` | `false` | Prevents automatic scheduled polling. |
| `SCHEDULER_DRY_RUN` | `true` | Keeps scheduled runs non-destructive. |
| `SCHEDULER_ALLOW_REAL_PROVIDERS` | `false` | Blocks real provider calls from scheduler. |
| `SCHEDULER_ALLOW_PUBLISHING` | `false` | Blocks scheduler publishing. |
| `MAX_AI_ITEMS_PER_RUN` | `0` | Prevents accidental AI batch runs. |
| `MAX_PUBLISH_ITEMS_PER_RUN` | `0` | Prevents accidental publish batch runs. |
| `TELEGRAM_REAL_REVIEW_ENABLED` | environment-specific | Allows real Telegram review messages when enabled. |
| `TELEGRAM_FINAL_PUBLISH_ENABLED` | `false` | Controls real final Telegram publishing. |
| `TELEGRAM_PUBLISH_SCHEDULER_ENABLED` | `false` | Controls due queue publishing. |
| `GITHUB_MEDIA_PROCESSOR_ENABLED` | environment-specific | Controls GitHub Actions media processing. |
| `APIFY_CURATION_ENABLED` | `false` | Controls autonomous Apify curation. |
| `APIFY_CURATION_DRY_RUN` | `true` | Keeps curation dry-run until verified. |

Do not enable final publishing until routes, bot permissions, media behavior, queue status, and staging smoke tests have been verified.

---

## Database and migrations

Apply local migrations:

```bash
pnpm db:migrate:local
```

Apply staging migrations:

```bash
wrangler d1 migrations apply your_database_name --remote --env staging --config wrangler.toml
```

Apply production migrations:

```bash
wrangler d1 migrations apply your_database_name --remote --env production --config wrangler.toml
```

Verify Apify/Claude curation tables after migration `0037`:

```bash
wrangler d1 execute your_database_name --remote --env staging --command "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'apify%' OR name LIKE 'claude%');"
```

Core D1 entities:

- `sources`
- `items`
- `dedupe_keys`
- `media_assets`
- `media_processing_jobs`
- `telegram_routes`
- `telegram_route_outputs`
- `telegram_generated_outputs`
- `telegram_review_messages`
- `telegram_publish_queue`
- `prompt_profiles`
- `prompt_bindings`
- `prompt_runs`
- `apify_curation_sources`
- `apify_crawl_runs`
- `claude_curation_decisions`
- `settings`
- `admin_config_audit`

---

## Telegram setup

Use one central Telegram bot.

Add the bot to:

1. An internal forum supergroup with source topics and review topics.
2. One or more final channels where approved posts may be published when final publishing is explicitly enabled.
3. A private media cache/staging chat or topic for media uploads.

Routing is deterministic and based on numeric Telegram IDs, not topic names:

```text
source_chat_id + source_thread_id
  -> telegram_routes row
  -> category
  -> prompt_profile
  -> telegram_route_outputs rows
  -> review topic(s)
  -> final channel(s)
```

Topic names are only for humans. The system uses numeric topic IDs.

Telegram update field mapping:

| Telegram update field | Route config field |
| --- | --- |
| `message.chat.id` | `sourceChatId` or `reviewChatId` |
| `message.message_thread_id` | `sourceThreadId` or `reviewThreadId` |

For setup, send a test message in the source topic and inspect Worker logs or safe internal tooling. Do not rely on visible topic names.

Set webhook:

```bash
pnpm telegram:set-webhook
```

For production and staging, configure `TELEGRAM_WEBHOOK_SECRET` and pass it to Telegram webhook registration so Telegram sends `x-telegram-bot-api-secret-token`.

---

## Telegram topic routes

Protected route-management APIs:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/internal/telegram/topic-routes` | `GET` | List route manager state and validation summary. |
| `/internal/telegram/topic-routes` | `POST` | Create or upsert a route. |
| `/internal/telegram/topic-routes/:id` | `PUT` | Update a route. |
| `/internal/telegram/topic-routes/:id/disable` | `POST` | Disable a route. |
| `/internal/telegram/topic-routes/:id/outputs` | `POST` | Create or upsert an output for a route. |
| `/internal/telegram/topic-route-outputs/:id` | `PUT` | Update a route output. |
| `/internal/telegram/topic-route-outputs/:id/disable` | `POST` | Disable a route output. |
| `/internal/telegram/topic-routes/validate` | `POST` | Validate stored route config. |
| `/internal/telegram/outputs/recent` | `GET` | Read recent generated Telegram outputs with redacted errors. |

Example route config:

```json
{
  "id": "crypto",
  "category": "crypto",
  "sourceChatId": "-1001111111111",
  "sourceThreadId": 101,
  "promptProfile": "crypto_editorial",
  "enabled": true
}
```

Example output config:

```json
{
  "id": "crypto_fa",
  "language": "fa",
  "reviewChatId": "-1001111111111",
  "reviewThreadId": 201,
  "finalChatId": "@crypto_fa",
  "enabled": true,
  "publishEnabled": true,
  "publishMode": "queued",
  "timezone": "Europe/Sofia",
  "allowedPublishWindows": [],
  "minimumGapMinutes": 30,
  "maxPostsPerHour": 2,
  "maxPostsPerDay": 10
}
```

Validation checks include:

- Source chat ID is present.
- Source topic ID is numeric.
- Review chat ID is present.
- Review topic ID is numeric.
- Final chat/channel ID is present.
- Enabled route has at least one enabled output.
- Duplicate source chat/topic is rejected.
- Duplicate output ID is rejected.

---

## Telegram review workflow

Each configured route output creates one language/channel-specific generated output.

Important statuses:

| Status | Meaning |
| --- | --- |
| `ready_for_review` | Draft was generated and sent to review. |
| `approved` | Reviewer pressed Send or Schedule and the output was approved. |
| `queued_for_publish` | Output is queued while final publishing is disabled or waiting. |
| `scheduled` | Output has a future scheduled time. |
| `publishing` | Real final publish is being attempted. |
| `published` | Telegram returned a final message ID. |
| `failed` | Generation, media, or publish failed with a redacted error. |
| `cancelled` | Reviewer cancelled this output. |

Review controls use output-level callback data:

```text
tgout:send:<generated_output_id>
tgout:schedule:<generated_output_id>
tgout:edit:<generated_output_id>
tgout:cancel:<generated_output_id>
tgout:status:<generated_output_id>
```

`Send` creates or reuses a `telegram_publish_queue` row.

If final publishing is disabled, the callback queues the output safely and returns a message such as:

```text
Queued. Final Telegram publishing is disabled.
```

If final publishing is enabled server-side and the schedule allows immediate publishing, the Worker attempts final Telegram publishing and updates generated output and queue statuses.

Edit behavior:

- Edit is allowed only before a publish queue row exists.
- The reviewer taps **Edit**.
- The reviewer replies to the review controls message with the revised caption.
- Channel signatures are still applied automatically.
- Once a queue row exists, the output is locked from review-caption edits.

---

## Final publishing

Final publishing is controlled by:

```text
TELEGRAM_FINAL_PUBLISH_ENABLED=false
```

Default is false.

Required for real final Telegram publishing:

- `TELEGRAM_FINAL_PUBLISH_ENABLED=true`.
- `TELEGRAM_BOT_TOKEN` configured as Worker secret or encrypted admin secret.
- Bot has admin/posting permission in the final channel.
- Route output has a valid `finalChatId`.
- Queue item is actionable.
- Media requirements are satisfied when media exists or is expected.

Publish-related endpoints:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/internal/telegram/publish/queue` | `GET` | List queue rows. |
| `/internal/telegram/publish/queue` | `POST` | Cancel, reschedule, or bulk publish queue rows. |
| `/internal/telegram/publish/preview` | `POST` | Preview one queue item before publish. |
| `/internal/telegram/publish/now` | `POST` | Publish one queue item now, if enabled and ready. |
| `/internal/telegram/publish/due` | `POST` | Process due queue items, if scheduler publishing is enabled. |
| `/internal/telegram/publish/retry` | `POST` | Retry failed queue item. |

Retry behavior:

- Retries only rows in `telegram_publish_queue` with `status = failed`.
- Does not enable final publishing by itself.
- Returns skipped if `TELEGRAM_FINAL_PUBLISH_ENABLED=false`.
- Redacts Telegram API errors before storing or returning them.
- Never exposes bot tokens or raw Telegram API descriptions.

---

## Media processing

Media behavior has two modes:

1. Telegram file ID reuse for media already received from Telegram source messages.
2. GitHub Actions processing for external media URLs.

Incoming Telegram source messages store:

- `file_id`
- `file_unique_id`
- media type
- MIME type when present
- size when present
- width, height, duration when present
- `media_group_id` when present

External media processing flow:

```text
Worker creates media_processing_jobs row
        ↓
Worker dispatches .github/workflows/media-processor.yml
        ↓
GitHub Actions runs scripts/media_processor.py
        ↓
Processor downloads/prepares media
        ↓
Processor uploads media to Telegram cache/staging chat
        ↓
Processor calls Worker callback
        ↓
Worker stores media_assets with Telegram file IDs
        ↓
Worker sends review when media readiness policy is satisfied
```

Media processor provider chain is configurable:

- Direct download.
- `gallery-dl`.
- `instaloader`.
- `yt-dlp`.
- External fallback provider.

Important media settings:

| Key | Purpose |
| --- | --- |
| `MEDIA_PROCESSING_MODE` | `telegram_file_id_reuse` or `github_actions`. |
| `GITHUB_MEDIA_PROCESSOR_ENABLED` | Enables GitHub workflow dispatch. |
| `GITHUB_MEDIA_PROCESSOR_REPOSITORY` | Repo that owns the media workflow. |
| `GITHUB_MEDIA_PROCESSOR_WORKFLOW_ID` | Usually `media-processor.yml`. |
| `WORKER_PUBLIC_BASE_URL` | Used to build callback URL. |
| `TELEGRAM_MEDIA_CACHE_CHAT_ID` | Telegram media cache/staging chat. |
| `TELEGRAM_MEDIA_CACHE_THREAD_ID` | Optional media cache topic. |
| `MEDIA_REVIEW_WAIT_MODE` | Controls when review is sent relative to terminal media jobs. |
| `MEDIA_REVIEW_ALLOW_PARTIAL` | Allows or blocks partial review behavior. |
| `MEDIA_FINAL_REQUIRE_READY` | Blocks final publish until media is ready. |
| `MEDIA_FINAL_ALLOW_TEXT_FALLBACK` | Allows text fallback when media fails. |
| `MEDIA_MAX_ASSETS` | Max assets per source, capped by Telegram album constraints. |

Known media limitations:

- External social media extraction can fail because platforms rate-limit, block, or change behavior.
- Cookies for Instagram/X may expire and must be rotated operationally.
- R2 media archive is not currently the primary path.
- Mixed albums and full media-group final publishing should be treated carefully unless the current branch explicitly supports them.

---

## Admin Control Center dashboard

Open the dashboard, enter the Worker URL, enter the Admin secret locally, then click **Save & Connect**.

The dashboard stores connection data in browser storage. Secret values must not be shown back to the operator.

Recommended operator flow:

1. Start with **Overview** to inspect readiness, routes, outputs, backlog, media state, failures, and trends.
2. Use **Setup** for guided launch checks.
3. Use **Settings** for metadata-driven config edits.
4. Use **AI** to configure provider/model behavior and run safe tests.
5. Use **Providers** to check Firecrawl, Apify, GetXAPI, metadata, and quotas.
6. Use **Telegram** to verify bot, review topic, media registry topic, and final channel reachability.
7. Use **Routes** to create, update, or disable source routes and output channels.
8. Use **Media** to inspect jobs and media registry behavior.
9. Use **Prompts** to edit prompt profiles, bindings, previews, activation, archive, diff, and run history.
10. Use **Publishing** to inspect queue rows and run explicit queue actions.
11. Use **Diagnostics** for issue hints, timeline lookup, dedupe search, and config import preview.
12. Use **Technical** only for raw redacted payload debugging.

Dashboard safe tests include:

- Worker connection check.
- Admin auth probe.
- Telegram bot token check.
- Telegram chat action permission checks.
- AI mock/provider readiness check.
- Provider readiness checks.
- Route validation.
- Publish preview.
- Scheduler dry run.
- Mock E2E run.

Manual publish actions are real when enabled. They must remain explicit and confirmation-gated.

---

## Prompt Studio

Prompt Studio supports:

- Prompt profile editing.
- Prompt library.
- Prompt activation and rollback by activating an older version.
- Archive.
- Prompt bindings.
- Visual line diff.
- Prompt preview.
- Prompt run history.

Prompt profiles can be resolved at runtime by route, route output, category, language, content type, and prompt profile key.

Prompt run logging should never block ingestion or review delivery.

Known limitations:

- Visual diff is line-based, not semantic side-by-side diff.
- Config import preview is read-only and does not apply changes.
- Provider-specific Apify/GetXAPI tests are not full official-contract tests.
- Setup wizard is not fully transactional with persisted per-step completion state.

---

## Apify + Claude curation pipeline

The autonomous curation pipeline is disabled by default.

Important settings:

| Key | Safe default | Purpose |
| --- | --- | --- |
| `APIFY_CURATION_ENABLED` | `false` | Enables autonomous curation. |
| `APIFY_CURATION_DRY_RUN` | `true` | Runs without publishing side effects. |
| `APIFY_DATASET_ID` | empty | Optional shared dataset ID. |
| `APIFY_MAX_ITEMS_PER_RUN` | `100` | Max fetched candidate items. |
| `APIFY_ENABLED_PLATFORMS` | `instagram,x,linkedin` | Platform allowlist. |
| `CLAUDE_CURATION_MODEL` | configured in env | Claude model for scoring/selection. |
| `CLAUDE_CURATION_THRESHOLD_SCORE` | `75` | Selection threshold. |
| `CLAUDE_CURATION_MAX_CANDIDATES_PER_RUN` | `50` | Max candidates sent to Claude. |
| `CLAUDE_CURATION_MAX_TEXT_CHARS_PER_ITEM` | `400` | Input truncation control. |
| `CLAUDE_CURATION_MAX_CALLS_PER_DAY` | `3` | Cost guard. |
| `CLAUDE_CURATION_DAILY_TOKEN_BUDGET` | `100000` | Token budget guard. |

Register at least one source per category:

```sql
INSERT INTO apify_curation_sources (id, category, platform, apify_dataset_id, label, enabled)
VALUES
  ('src_crypto_ig', 'crypto', 'instagram', '<your-apify-dataset-id>', 'Crypto Instagram', 1),
  ('src_crypto_x',  'crypto', 'x',         '<your-apify-dataset-id>', 'Crypto X',         1);
```

Verify at least one enabled route per curation category:

```sql
SELECT id, category, enabled FROM telegram_routes WHERE enabled = 1;
```

Dry-run trigger:

```bash
curl -X POST https://<staging-worker>.workers.dev/internal/apify/curation/trigger \
  -H "x-internal-api-secret: <INTERNAL_API_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

Enable Claude curation only after dry-run validation:

```toml
APIFY_CURATION_ENABLED = "true"
APIFY_CURATION_DRY_RUN = "false"
TELEGRAM_FINAL_PUBLISH_ENABLED = "false"
```

Keep final publishing off until queue and media behavior are verified.

---

## Staging launch checklist

Before enabling real integrations in staging:

1. Set Worker secrets.
2. Fill required `wrangler.toml` placeholders.
3. Set GitHub Actions secrets.
4. Run D1 migrations.
5. Register Apify curation sources if autonomous curation is needed.
6. Create and validate Telegram routes and outputs.
7. Deploy staging Worker.
8. Connect dashboard to staging Worker.
9. Run admin auth probe.
10. Run Telegram bot and chat action tests.
11. Run route validation.
12. Run AI/provider readiness tests.
13. Run media processing smoke test.
14. Run Telegram review dry-run.
15. Inspect recent outputs and media jobs.
16. Inspect publish queue preview.
17. Enable Claude curation only after dry-run success.
18. Enable final publishing only as the final step.

Deploy staging:

```bash
pnpm worker:deploy:staging
```

Run staging smoke endpoints:

```text
/health
/status
/ready
/internal/admin/config
/internal/admin/summary
/internal/admin/validate
/internal/admin/metrics/overview
/internal/admin/prompts
/internal/admin/ai/test
/internal/admin/providers/test
/internal/admin/telegram/test
/internal/telegram/topic-routes/validate
/internal/telegram/publish/queue
```

---

## Rollback

To stop autonomous curation and final publishing:

```toml
APIFY_CURATION_ENABLED = "false"
APIFY_CURATION_DRY_RUN = "true"
TELEGRAM_FINAL_PUBLISH_ENABLED = "false"
TELEGRAM_PUBLISH_SCHEDULER_ENABLED = "false"
SCHEDULER_ALLOW_PUBLISHING = "false"
```

Redeploy:

```bash
pnpm worker:deploy:staging
```

If needed, also remove or rotate relevant secrets through Cloudflare and GitHub Actions settings.

---

## GitHub Actions workflows

### CI

`ci.yml` runs on pull requests to `main` and pushes to `main`, `dev`, and `phase-*` branches.

It runs:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dashboard:build
```

### Media processor

`media-processor.yml` is triggered through `workflow_dispatch` by the Worker.

Required dispatch inputs include:

- `job_id`
- `item_id`
- `source_url`
- `callback_url`

Optional inputs include:

- `media_asset_id`
- `kind`
- Telegram staging chat/thread overrides.
- photo/file MB limits.
- max assets.
- strict missing media behavior.

The workflow installs Python dependencies and runs:

```bash
python scripts/media_processor.py \
  --job-id <job_id> \
  --item-id <item_id> \
  --source-url <source_url> \
  --callback-url <callback_url> \
  --media-asset-id <media_asset_id> \
  --expected-kind <kind>
```

---

## Testing and validation

Run before opening or merging a PR:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm dashboard:build
```

Recommended staging smoke tests:

- `/health`
- `/status`
- `/ready`
- `/internal/admin/config`
- `/internal/admin/summary`
- `/internal/admin/validate`
- `/internal/admin/metrics/overview`
- `/internal/admin/prompts`
- `/internal/admin/ai/test`
- `/internal/admin/providers/test`
- `/internal/admin/telegram/test`
- `/internal/telegram/topic-routes/validate`
- `/internal/telegram/outputs/recent`
- `/internal/media/jobs`
- `/internal/telegram/publish/queue`
- `/internal/telegram/publish/preview`

Manual review before production:

- Confirm no raw secret values appear in dashboard pages or API responses.
- Confirm `INTERNAL_API_SECRET` is configured.
- Confirm `TELEGRAM_WEBHOOK_SECRET` is configured.
- Confirm reviewer allowlist is correct.
- Confirm route source chat/topic IDs are numeric and correct.
- Confirm review topics and final channels are correct.
- Confirm bot permissions in review topics, media cache, and final channels.
- Confirm final publishing is intentionally enabled.
- Confirm media cache/staging uploads work.
- Confirm failed publish rows cannot be accidentally duplicated.
- Confirm published rows are not actionable.
- Confirm config import preview cannot mutate D1.

---

## Operational safety rules

- Never commit real secrets.
- Keep final publishing disabled until staging validation is complete.
- Keep scheduler publishing disabled unless explicitly supported by the active phase.
- Do not rely on Telegram topic names for routing.
- Do not give the dashboard Cloudflare deployment tokens.
- Do not expose raw Telegram API errors to operators or users.
- Do not expose bot tokens, provider API keys, cookies, or internal secrets in API responses.
- Treat media extraction from social platforms as best-effort.
- Treat real publish actions as irreversible external side effects.
- Keep destructive config import disabled unless a transactional import workflow exists.

---

## Known limitations

- The project is staging-operational, not automatically production-ready.
- Local development does not fully reproduce Cloudflare, Telegram, GitHub Actions, and remote D1 behavior.
- Final Telegram publishing is disabled by default.
- Scheduler publishing is disabled by default.
- Real provider execution requires explicit credentials and validation.
- AI fallback model execution is not a substitute for provider-specific testing.
- External media extraction can fail because of platform rate limits, login walls, cookies, or upstream changes.
- R2 media archiving is not the primary implemented path.
- Dashboard orchestration still has a large app shell and should continue to be decomposed.
- Config names include legacy aliases and should be canonicalized over time.
- Config import preview is read-only.
- Setup wizard is practical but not fully transactional.

---

## Recommended next hardening work

1. Require internal auth for all `/internal/*` routes in production even if `INTERNAL_API_SECRET` is missing.
2. Require `TELEGRAM_WEBHOOK_SECRET` in staging and production.
3. Canonicalize media, AI, provider, and scheduler config into typed config readers.
4. Replace the route `if` chain in `apps/worker-api/src/index.ts` with a route registry.
5. Split `ModernDashboardApp.tsx` into domain hooks and page containers.
6. Add E2E staging smoke tests for source topic -> review -> edit -> queue -> preview -> publish path.
7. Add media analytics by platform/provider/failure reason.
8. Add provider-specific Apify/GetXAPI contract tests.
9. Add richer prompt diff and production prompt-run logging verification.
10. Add documented cookie rotation procedure for Instagram/X media extraction.

---

## Glossary

| Term | Meaning |
| --- | --- |
| Source topic | Telegram forum topic where source content is posted. |
| Review topic | Telegram forum topic where generated review cards are sent. |
| Route | Mapping from source chat/topic to category and prompt profile. |
| Route output | Language/review/final-channel configuration for a route. |
| Generated output | AI or fallback output created for a route output. |
| Review card | Telegram message shown to human reviewers with controls. |
| Publish queue | D1 queue table for approved Telegram outputs. |
| Media cache/staging chat | Private Telegram chat/topic used to upload and reuse media file IDs. |
| Final channel | Telegram channel where approved content is finally published. |
| Prompt profile | Versioned system/user prompt configuration. |
| Prompt binding | Mapping that determines which prompt applies to a category/language/output. |
| Curation run | Apify + Claude pipeline execution for candidate selection. |
| Safe default | Configuration that prevents real external side effects unless explicitly enabled. |
