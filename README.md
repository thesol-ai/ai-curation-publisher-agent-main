# AI Curation Publisher Agent

AI Curation Publisher Agent is a provider-agnostic content curation, AI rewriting, Telegram review, media staging, and publishing pipeline built on Cloudflare Workers, Cloudflare D1, Telegram, GitHub Actions, and a safe admin dashboard.

The system is designed for controlled social publishing workflows: ingest content, normalize it, deduplicate it, generate localized editorial output, stage media, send it to a Telegram review topic, allow human edits and approvals, then publish to a final Telegram channel or downstream publishing target.

This repository follows a PR-first workflow. Real provider calls, real publishing, scheduler side effects, and public-channel publishing are intentionally gated by runtime configuration and secrets.

---

## Contents

- [What this project does](#what-this-project-does)
- [Current status](#current-status)
- [Architecture](#architecture)
- [Repository structure](#repository-structure)
- [End-to-end workflow](#end-to-end-workflow)
- [Core modules](#core-modules)
- [Runtime environments](#runtime-environments)
- [Local development](#local-development)
- [Cloudflare setup](#cloudflare-setup)
- [Database and migrations](#database-and-migrations)
- [Telegram setup](#telegram-setup)
- [AI provider setup](#ai-provider-setup)
- [Media processing](#media-processing)
- [Dashboard](#dashboard)
- [Configuration and secrets](#configuration-and-secrets)
- [GitHub Actions workflows](#github-actions-workflows)
- [Testing and validation](#testing-and-validation)
- [Deployment runbooks](#deployment-runbooks)
- [Debugging and troubleshooting](#debugging-and-troubleshooting)
- [Operational safety rules](#operational-safety-rules)
- [Known limitations](#known-limitations)
- [Roadmap and follow-ups](#roadmap-and-follow-ups)
- [Glossary](#glossary)

---

## What this project does

The project supports a review-first publishing pipeline for social and web content.

It can:

- Accept content from Telegram source topics or configured sources.
- Normalize source content into internal `items`.
- Deduplicate repeated source URLs or previously seen content.
- Resolve source metadata from external links.
- Generate localized AI output through prompt profiles.
- Dispatch media processing through GitHub Actions.
- Download, prepare, and stage media in Telegram cache/staging chats.
- Send review cards to Telegram review topics.
- Support reviewer actions such as edit, approve, send, and queue.
- Publish approved output to final Telegram channels when explicitly enabled.
- Expose an admin dashboard for config, prompt profiles, routes, status, and diagnostics.
- Keep dangerous operations behind internal authentication and environment switches.

The default posture is safe:

- Mock providers by default.
- Scheduler publishing disabled by default.
- Final Telegram publishing disabled unless explicitly enabled.
- Production-sensitive secrets kept outside source control.
- Dashboard does not receive Cloudflare deployment tokens.

---

## Current status

Current status: **MVP / staging-operational**.

Implemented areas include:

- Cloudflare Worker API.
- Cloudflare D1 persistence.
- Admin Control Center dashboard.
- Telegram source-topic ingest.
- Telegram review controls.
- Reply-based Telegram edit workflow.
- Telegram final publish queue.
- Media processing through GitHub Actions.
- Media staging through Telegram cache chat/topic.
- AI prompt profiles and output validation.
- Internal diagnostics for timelines, outputs, media jobs, and publish previews.
- Staging-only operational reset endpoints.
- CI, deploy, D1 migration, dashboard deploy, smoke, and media processor workflows.

Not guaranteed by default:

- Real production scraping.
- Real final public-channel publishing.
- Fully automated production scheduling.
- Guaranteed media extraction from rate-limited social platforms.
- Local runtime parity with Cloudflare + Telegram + GitHub Actions.

---

## Architecture

High-level flow:

```text
Telegram source topic / configured sources
        ↓
Cloudflare Worker
        ↓
Normalize item + dedupe
        ↓
Resolve source text and metadata
        ↓
Run AI prompt profile
        ↓
Dispatch media processor, when media is expected
        ↓
GitHub Actions media processor
        ↓
Telegram media cache/staging chat
        ↓
Telegram review topic
        ↓
Reviewer edit / approve / send
        ↓
Publish queue
        ↓
Final Telegram channel
```

The Worker owns orchestration, internal API routes, authentication checks, config resolution, D1 persistence, and publish decisions.

GitHub Actions owns expensive or platform-dependent media work such as `yt-dlp`, `gallery-dl`, `instaloader`, `ffmpeg`, Telegram media staging, and callback to the Worker.

Telegram is used for three distinct roles:

1. Source input.
2. Human review UI.
3. Media cache/staging before final publish.

The dashboard is an operator interface over the protected Worker Admin API. It does not talk directly to Cloudflare APIs and does not mutate Cloudflare Worker Secrets.

---

## Repository structure

```text
.
├── apps/
│   ├── dashboard/                  # React/Vite operator dashboard
│   └── worker-api/                 # Cloudflare Worker API and orchestration
├── packages/
│   ├── ai/                         # AI output schemas, normalization, validation
│   ├── core/                       # Shared core types/utilities
│   ├── db/                         # D1 migrations and repositories
│   ├── media/                      # Media-related shared package
│   ├── observability/              # Logging/diagnostic utilities
│   ├── providers/                  # Provider adapters and mocks
│   ├── scheduler/                  # Polling/scheduling support
│   ├── telegram/                   # Telegram client, message builders, review controls
│   └── wordpress/                  # WordPress draft/publish integration
├── scripts/
│   ├── media_processor.py          # GitHub Actions media processor
│   ├── media-processor.mjs         # Legacy/helper media processor script
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
├── wrangler.toml                   # Cloudflare Worker environments and D1 bindings
├── .env.example                    # Sanitized local/runtime config template
├── package.json                    # Monorepo scripts
└── README.md
```

Important Worker areas:

```text
apps/worker-api/src/index.ts
apps/worker-api/src/routes/
apps/worker-api/src/telegram-topic-workflow/
apps/worker-api/src/operations/
```

Important Telegram review files:

```text
apps/worker-api/src/telegram-topic-workflow/review-edit-orchestrator.ts
apps/worker-api/src/telegram-topic-workflow/review-message-state.ts
apps/worker-api/src/telegram-topic-workflow/callback-orchestrator.ts
apps/worker-api/src/telegram-topic-workflow/publish-runner.ts
packages/telegram/src/
```

Important dashboard files:

```text
apps/dashboard/src/ModernDashboardApp.tsx
apps/dashboard/src/modern.css
apps/dashboard/src/storage.ts
```

Important media files:

```text
scripts/media_processor.py
.github/workflows/media-processor.yml
```

---

## End-to-end workflow

### 1. Source ingest

A user or source posts text, a social link, or a web link into a configured Telegram source topic.

The Telegram webhook receives the update and routes it into the topic workflow.

### 2. Item creation

The Worker creates an internal `item` or reuses an existing one when dedupe finds a match.

The item stores normalized source information such as canonical URL, text, provider/platform/source type, author handle, and timestamps.

### 3. Source content resolution

The Worker resolves text and metadata from the source.

For social links, the resolver attempts to extract usable text/caption/metadata. For Instagram and X, media download is handled separately by the media processor.

### 4. AI generation

The route output selects a prompt profile, such as a localized editorial profile.

The AI package validates the provider response against the expected output shape. If the model returns invalid JSON or a structurally invalid response, the system can produce a safe fallback caption rather than publishing broken output.

### 5. Media processing

If media is expected and GitHub Actions media processing is enabled, the Worker dispatches `.github/workflows/media-processor.yml`.

The media processor downloads media, prepares it for Telegram limits, uploads it to a Telegram cache/staging chat, and calls back the Worker with asset metadata and Telegram file IDs.

### 6. Telegram review

The Worker sends a review card to the configured Telegram review topic.

Review cards include generated text, media when ready, metadata, and review controls.

### 7. Reviewer edit workflow

Reviewers can tap **Edit** and then reply to the review controls message with the corrected caption/text.

The edit is stored on the generated output and used for final send/publish.

Important behavior:

```text
Reply to the review controls message, not a random media/content message.
```

### 8. Send / publish queue

When reviewers tap **Send**, the system queues or publishes depending on runtime switches.

Final publishing requires:

- Final publish enabled.
- Bot token configured.
- Final channel configured.
- Queue status actionable.
- Media requirements satisfied, when required.

### 9. Final Telegram publish

If final publishing is enabled, the Worker sends the final text/media to the configured final Telegram channel.

If final publishing is disabled, the output can remain queued or dry-run safe depending on config.

---

## Core modules

### Worker API

Location:

```text
apps/worker-api/
```

Responsibilities:

- Public health/status routes.
- Telegram webhook handling.
- Internal admin routes.
- Internal media callback.
- Topic workflow orchestration.
- Review/edit callbacks.
- Publish preview and publish runner.
- Runtime config resolution.
- D1 repository usage.
- Internal auth enforcement.

### Dashboard

Location:

```text
apps/dashboard/
```

Responsibilities:

- Admin Control Center UI.
- Critical publishing controls.
- Telegram status.
- Bot token configured/missing status.
- Prompt profile editing.
- Route and output visibility.
- Admin config editing.
- Secret configured/missing indicators.
- Recent output diagnostics.
- Operational state visibility.

### AI package

Location:

```text
packages/ai/
```

Responsibilities:

- Output schema handling.
- AI output normalization.
- Validation.
- Safe fallback behavior.
- Prompt profile expectations.

### DB package

Location:

```text
packages/db/
```

Responsibilities:

- D1 migrations.
- Repository wrappers.
- Items, outputs, review messages, media jobs, media assets, publish queue, admin config, audit, and secrets persistence.

### Telegram package

Location:

```text
packages/telegram/
```

Responsibilities:

- Telegram client abstraction.
- Real Telegram client.
- Review controls.
- Message rendering.
- Media payload helpers.
- Final publish helpers.

### Media processor

Location:

```text
scripts/media_processor.py
.github/workflows/media-processor.yml
```

Responsibilities:

- Download external media.
- Use direct requests, `gallery-dl`, `instaloader`, `yt-dlp`, or external fallback providers depending on config.
- Prepare media with `ffmpeg`.
- Respect Telegram size/aspect constraints.
- Upload staged media to Telegram.
- Callback the Worker with assets and diagnostics.

---

## Runtime environments

### Local

Used for development, static checks, unit tests, dashboard development, and limited Worker testing.

Local does not fully reproduce Cloudflare + Telegram + GitHub Actions behavior.

### Staging

Used for realistic Telegram review, media processor, D1, and dashboard checks.

Staging may enable real review and GitHub Actions media processing while still keeping provider/scheduler behavior controlled.

### Production

Production should be enabled cautiously.

Production publishing requires explicit secrets and runtime switches. Do not assume production is ready just because staging works.

---

## Local development

Requirements:

- Node.js 22+
- pnpm 9.15.4
- Wrangler 3.x or compatible project version
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

Load local shell values when needed:

```bash
set -a
source .env.local
set +a
```

Common checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm dashboard:build
```

Run dashboard locally:

```bash
pnpm dashboard:dev
```

Run Worker locally:

```bash
pnpm worker:dev
```

Local smoke checks:

```bash
pnpm worker:health
pnpm worker:smoke
```

Local D1 migration:

```bash
pnpm d1:migrate:local
```

Real Telegram/media flows are usually tested against staging because they depend on public webhooks, Cloudflare Worker runtime, GitHub Actions workflow dispatch, and Telegram API access.

---

## Cloudflare setup

Cloudflare provides:

- Worker runtime.
- D1 database.
- Worker vars.
- Worker secrets.
- Scheduled triggers.

Main config:

```text
wrangler.toml
```

Common scripts:

```bash
pnpm setup:cloudflare
pnpm worker:deploy
pnpm worker:deploy:staging
pnpm worker:deploy:production
pnpm d1:migrate:remote
pnpm d1:migrate:production
pnpm check:production
```

Production commands:

```bash
pnpm worker:deploy:production
pnpm d1:migrate:production
pnpm check:production
```

Do not run production commands casually. They require Cloudflare auth and production-ready secrets/config.

D1 database IDs in `wrangler.toml` identify Cloudflare resources. They are not authentication secrets, but deployment credentials and tokens must never be committed.

---

## Database and migrations

D1 stores operational and configuration state.

Common data areas:

- `items`
- generated outputs
- review messages
- review actions
- publish queues
- media processing jobs
- media assets
- provider logs
- WordPress posts
- dedupe keys
- admin config
- admin config audit
- prompt profiles
- prompt bindings
- Telegram routes
- Telegram route outputs
- secrets
- D1 migration state

Apply local migrations:

```bash
pnpm d1:migrate:local
```

Apply remote migrations:

```bash
pnpm d1:migrate:remote
```

Apply production migrations:

```bash
pnpm d1:migrate:production
```

### Staging operational reset

Staging includes internal reset endpoints for test data.

Useful endpoints:

```text
GET  /internal/admin/test-data/counts
POST /internal/admin/test-data/reset
```

The operational reset clears test data such as items, outputs, media jobs, media assets, review messages, queues, provider logs, WordPress posts, and dedupe keys.

It preserves configuration/state such as:

- `admin_config`
- `admin_config_audit`
- `settings`
- `sources`
- `prompt_profiles`
- `prompt_bindings`
- `telegram_routes`
- `telegram_route_outputs`
- `d1_migrations`
- `secrets`

Never run destructive/reset endpoints outside staging.

---

## Telegram setup

Telegram is central to the workflow.

You need:

- A Telegram bot.
- A source topic or source chat.
- A review topic.
- A media cache/staging topic.
- A final publish channel.
- Reviewer user IDs.
- Bot permissions for the chats/channels involved.

Required or common settings:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_ALLOWED_REVIEWER_IDS
TELEGRAM_REVIEW_CHAT_ID
TELEGRAM_FINAL_CHAT_ID
TELEGRAM_REAL_REVIEW_ENABLED
TELEGRAM_FINAL_PUBLISH_ENABLED
TELEGRAM_PUBLISH_SCHEDULER_ENABLED
TELEGRAM_PUBLISH_DUE_LIMIT
TELEGRAM_MEDIA_STAGING_CHAT_ID
TELEGRAM_MEDIA_STAGING_THREAD_ID
TELEGRAM_MEDIA_CACHE_CHAT_ID
TELEGRAM_MEDIA_CACHE_THREAD_ID
```

The bot must be able to:

- Receive webhook updates.
- Read source topic messages, depending on Telegram privacy settings and group configuration.
- Send messages to review topics.
- Send media to cache/staging topics.
- Send final posts to the final channel.
- Reach forum topics when thread IDs are used.

Useful validation checks:

```text
GET /internal/admin/summary
GET /internal/admin/config
GET /internal/telegram/outputs/recent
GET /internal/media/jobs
```

Telegram final publishing is controlled by runtime config and is not safe to assume enabled.

---

## AI provider setup

The project is mock-first.

Common AI settings:

```text
AI_PROVIDER=mock
AI_MODEL=mock
AI_MODEL_FALLBACKS=[]
AI_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
CUSTOM_AI_API_KEY=
```

Supported dashboard-level provider modes include:

```text
mock
openai
gemini
custom
```

Prompt profiles can define:

- Provider/model hint.
- Temperature.
- Max tokens.
- Output schema reference.
- Route/language/category behavior.

AI output safety:

- Model output is validated.
- Invalid or truncated JSON can trigger fallback output.
- If real AI output appears missing, inspect prompt profile settings and generated output diagnostics.

Useful endpoint:

```text
GET /internal/telegram/outputs/debug?generatedOutputId=...
```

This endpoint is internal-only and requires `x-internal-api-secret`.

---

## Media processing

Media processing can run in different modes.

Common settings:

```text
MEDIA_PROCESSING_MODE=telegram_file_id_reuse
MEDIA_PROCESSING_MODE=github_actions
GITHUB_MEDIA_PROCESSOR_ENABLED=true
GITHUB_MEDIA_PROCESSOR_REPOSITORY=pourebadi/ai-curation-publisher-agent
GITHUB_MEDIA_PROCESSOR_WORKFLOW_ID=media-processor.yml
GITHUB_MEDIA_PROCESSOR_REF=main
GITHUB_MEDIA_PROCESSOR_CALLBACK_URL=https://your-worker.workers.dev/internal/media/processing/callback
GITHUB_MEDIA_PROCESSOR_TOKEN=
```

The GitHub Actions media processor workflow is:

```text
.github/workflows/media-processor.yml
```

The processor script is:

```text
scripts/media_processor.py
```

Workflow dispatch inputs include:

- `job_id`
- `item_id`
- `source_url`
- `callback_url`
- `media_asset_id`
- `kind`
- Telegram staging overrides
- media size/asset limits
- strict missing media mode

The processor uses:

- direct download attempts
- `gallery-dl`
- `instaloader`
- `yt-dlp`
- optional external fallback provider
- `ffmpeg`
- Telegram upload APIs

Provider order is configurable:

```text
MEDIA_FALLBACK_PROVIDER_ORDER_X=direct,gallery_dl,yt_dlp,external
MEDIA_FALLBACK_PROVIDER_ORDER_INSTAGRAM=direct,gallery_dl,instaloader,yt_dlp,external
MEDIA_FALLBACK_PROVIDER_ORDER=direct,yt_dlp,external
```

Other media settings:

```text
TELEGRAM_MEDIA_MAX_PHOTO_MB=9
TELEGRAM_MEDIA_MAX_FILE_MB=49
MEDIA_MAX_ASSETS=10
YTDLP_CONCURRENT_FRAGMENTS=8
MEDIA_FASTSTART_COPY=true
MEDIA_REVIEW_WAIT_MODE=all_terminal
MEDIA_REVIEW_ALLOW_PARTIAL=false
MEDIA_FINAL_REQUIRE_READY=true
MEDIA_FINAL_ALLOW_TEXT_FALLBACK=false
MEDIA_ASPECT_DRIFT_THRESHOLD=0.02
MEDIA_GALLERY_DL_ENABLED=true
MEDIA_GALLERY_DL_TIMEOUT_SECONDS=25
MEDIA_INSTALOADER_ENABLED=true
MEDIA_INSTALOADER_TIMEOUT_SECONDS=30
MEDIA_VIDEO_OUTPUT_PROFILE=telegram_review_optimized
MEDIA_VIDEO_TRANSCODE_POLICY=copy_if_possible
MEDIA_MAX_VIDEO_SIDE=1920
MEDIA_VIDEO_CRF=23
MEDIA_VIDEO_AUDIO_BITRATE=128k
MEDIA_PROCESSING_STRICT=false
```

### Social media cookies

The project already supports optional cookies for social media download reliability.

GitHub Actions secrets:

```text
INSTAGRAM_COOKIES_B64
X_COOKIES_B64
```

These are passed to the media processor workflow and decoded into temporary cookie files at runtime.

The project does not provide cookies. Do not use stolen/shared public cookies. If needed, use a dedicated test account, export `cookies.txt` locally, base64 encode it, and store it as a GitHub Actions secret.

Example:

```bash
base64 -i instagram-cookies.txt | tr -d '\n' | pbcopy
```

Then create a repository secret:

```text
Name: INSTAGRAM_COOKIES_B64
Value: copied base64 value
```

Important Instagram limitation:

```text
Some Instagram Reels require login or hit anonymous rate limits. Caption extraction can still work while media download is skipped.
```

In that case, media jobs may show:

```text
No downloadable media was found for this source URL.
```

or logs may show:

```text
Requested content is not available, rate-limit reached or login required.
```

---

## Dashboard

The dashboard is the operator-facing Admin Control Center.

Common commands:

```bash
pnpm dashboard:dev
pnpm dashboard:build
pnpm dashboard:preview
```

Dashboard responsibilities:

- Setup guidance.
- Critical publishing controls.
- Telegram status.
- Bot token configured/missing status.
- Prompt profile editing.
- Route and output visibility.
- Admin config editing.
- Secret configured/missing indicators.
- Recent output diagnostics.
- Operational state visibility.

The dashboard talks to protected Worker Admin API routes. It does not call the Cloudflare API directly and does not receive Cloudflare API tokens.

---

## Configuration and secrets

Never commit real secrets.

Do not commit:

```text
.env.local
.dev.vars
cookies.txt
instagram-cookies.txt
x-cookies.txt
real API keys
real bot tokens
raw application passwords
Cloudflare API tokens
```

### Secret/config locations

| Location | Purpose |
|---|---|
| `.env.local` | Local shell convenience only. Do not commit. |
| `.dev.vars` | Local Wrangler Worker secrets. Do not commit. |
| Cloudflare Worker Secrets | Runtime secrets for deployed Worker. |
| Cloudflare Worker vars / `wrangler.toml` | Non-secret environment config. |
| D1 admin config | Editable allowlisted runtime config. |
| D1 encrypted secrets | Selected dashboard-editable credentials encrypted with `CONFIG_ENCRYPTION_KEY`. |
| GitHub Actions Secrets | CI/deploy/media workflow secrets. |
| GitHub Actions Variables | Non-secret workflow config. |

### Bootstrap secrets

These are not dashboard-editable:

```text
INTERNAL_API_SECRET
CONFIG_ENCRYPTION_KEY
```

`INTERNAL_API_SECRET` protects internal endpoints.

`CONFIG_ENCRYPTION_KEY` is required for dashboard-managed encrypted secrets.

Set Cloudflare Worker secrets manually:

```bash
pnpm wrangler secret put INTERNAL_API_SECRET --env staging
pnpm wrangler secret put CONFIG_ENCRYPTION_KEY --env staging
```

Use the correct environment for production:

```bash
pnpm wrangler secret put INTERNAL_API_SECRET --env production
pnpm wrangler secret put CONFIG_ENCRYPTION_KEY --env production
```

### Common Worker secrets

| Key | Required | Purpose |
|---|---:|---|
| `INTERNAL_API_SECRET` | Yes | Protects internal API routes. |
| `CONFIG_ENCRYPTION_KEY` | Required for dashboard secret editing | Encrypts dashboard-managed secret values in D1. |
| `TELEGRAM_BOT_TOKEN` | Required for real Telegram review/publish | Telegram bot API token. |
| `TELEGRAM_WEBHOOK_SECRET` | Recommended | Verifies Telegram webhook secret header when configured. |
| `AI_API_KEY` | Optional | Generic AI API key. |
| `OPENAI_API_KEY` | If using OpenAI | OpenAI provider credential. |
| `GEMINI_API_KEY` | If using Gemini | Gemini provider credential. |
| `CUSTOM_AI_API_KEY` | If using custom AI | Custom provider credential. |
| `WORDPRESS_APPLICATION_PASSWORD` | If using WordPress | WordPress application password. |
| `FIRECRAWL_API_KEY` | If using Firecrawl | External provider credential. |
| `APIFY_TOKEN` | If using Apify | External provider credential. |
| `GETXAPI_KEY` | If using GetXAPI | External provider credential. |
| `GITHUB_MEDIA_PROCESSOR_TOKEN` | If Worker dispatches GitHub workflow directly | GitHub token with workflow dispatch permissions. |

### Common GitHub Actions secrets

| Key | Required | Purpose |
|---|---:|---|
| `CLOUDFLARE_API_TOKEN` | Deploy workflows | Deploy Worker through Wrangler. |
| `CLOUDFLARE_ACCOUNT_ID` | Deploy workflows | Cloudflare account target. |
| `TELEGRAM_BOT_TOKEN` | Media processor | Upload/stage media to Telegram. |
| `TELEGRAM_MEDIA_CACHE_CHAT_ID` | Media processor | Telegram chat/channel used for media cache. |
| `TELEGRAM_MEDIA_CACHE_THREAD_ID` | Optional | Telegram forum topic/thread for media cache. |
| `TELEGRAM_MEDIA_STAGING_CHAT_ID` | Fallback | Alternate staging chat. |
| `TELEGRAM_MEDIA_STAGING_THREAD_ID` | Optional fallback | Alternate staging topic. |
| `WORKER_INTERNAL_API_SECRET` | Media processor | Callback auth to Worker. |
| `INTERNAL_API_SECRET` | Fallback for workflow | Callback auth fallback. |
| `INSTAGRAM_COOKIES_B64` | Optional | Base64 encoded Instagram cookies.txt. |
| `X_COOKIES_B64` | Optional | Base64 encoded X/Twitter cookies.txt. |

### Common non-secret vars

| Key | Purpose |
|---|---|
| `ENVIRONMENT` | local, staging, production. |
| `LOG_LEVEL` | Logging verbosity. |
| `PROVIDERS_MODE` | mock/provider mode. |
| `SCHEDULER_ENABLED` | Enables scheduler behavior. |
| `SCHEDULER_DRY_RUN` | Keeps scheduler safe. |
| `SCHEDULER_ALLOW_REAL_PROVIDERS` | Allows real provider calls. |
| `SCHEDULER_ALLOW_PUBLISHING` | Allows scheduler to publish. |
| `TELEGRAM_REAL_REVIEW_ENABLED` | Enables real Telegram review messages. |
| `TELEGRAM_FINAL_PUBLISH_ENABLED` | Enables final Telegram publishing. |
| `TELEGRAM_PUBLISH_SCHEDULER_ENABLED` | Enables due queue scheduler. |
| `TELEGRAM_PUBLISH_DUE_LIMIT` | Limits due publish batch size. |
| `MAX_AI_ITEMS_PER_RUN` | AI processing limit. |
| `MAX_PROVIDER_ITEMS_PER_RUN` | Provider ingestion limit. |
| `MAX_PUBLISH_ITEMS_PER_RUN` | Publish limit. |

### Dashboard editable settings

The dashboard can edit allowlisted non-secret settings and selected encrypted credentials. It rejects protected deployment credentials, unknown keys, Cloudflare tokens, and direct publishing/scheduler safety overrides that are intentionally protected.

Secret values are never returned by admin config routes. They are shown as configured/missing only.

---

## GitHub Actions workflows

| Workflow | Purpose |
|---|---|
| `.github/workflows/ci.yml` | CI checks. |
| `.github/workflows/deploy-cloudflare.yml` | Validate and deploy staging Worker. |
| `.github/workflows/deploy-dashboard-pages.yml` | Dashboard Pages deployment. |
| `.github/workflows/d1-migrations.yml` | D1 migration workflow. |
| `.github/workflows/backup-d1.yml` | D1 backup/export support. |
| `.github/workflows/media-processor.yml` | Download, prepare, stage media, and callback Worker. |
| `.github/workflows/smoke-test.yml` | Smoke checks. |
| `.github/workflows/agent-task.yml` | Agent task workflow. |
| `.github/workflows/auto-merge-safe.yml` | Safe auto-merge support. |

The Cloudflare deploy workflow runs:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm worker:deploy:staging
```

The media processor workflow runs through `workflow_dispatch` and is usually triggered by the Worker after a media job is created.

---

## Testing and validation

Core checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm dashboard:build
```

Focused checks used often:

```bash
pnpm test -- --run apps/worker-api/src/routes/internal-telegram-topic-routes.test.ts packages/ai/src/ai-output.service.test.ts
```

Worker smoke:

```bash
pnpm worker:health
pnpm worker:smoke
```

Telegram smoke helper:

```bash
pnpm telegram:mvp-smoke
```

Production readiness:

```bash
pnpm check:production
```

Manual staging test checklist:

```text
1. Send plain text to source topic.
2. Confirm review card appears.
3. Tap Edit and reply to review controls.
4. Confirm updated text appears/gets stored.
5. Tap Send.
6. Confirm publish queue/final channel behavior.
7. Send X URL with media.
8. Confirm media job ready and review media appears.
9. Send Instagram URL with media.
10. Confirm caption generation and media job behavior.
11. Check recent outputs.
12. Check media jobs.
13. Check publish preview.
```

---

## Deployment runbooks

### Deploy staging Worker

Use GitHub Actions when possible:

```text
Actions → Deploy Cloudflare Worker → Run workflow
Branch: target branch
```

Local fallback:

```bash
pnpm worker:deploy:staging
```

Pre-checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Post-checks:

```text
GET /health
GET /status
GET /ready
GET /internal/admin/summary
GET /internal/admin/config
```

### Deploy dashboard

Build locally:

```bash
pnpm dashboard:build
```

Deploy through the dashboard Pages workflow when configured:

```text
Actions → Deploy dashboard pages
```

### Deploy production Worker

Use production only after staging validation:

```bash
pnpm check:production
pnpm d1:migrate:production
pnpm worker:deploy:production
```

Production safety checklist:

```text
- Required Cloudflare secrets exist.
- Required Telegram secrets exist.
- Final channel is correct.
- Reviewer IDs are correct.
- Publishing switches are intentionally configured.
- Media cache chat is correct.
- AI provider is intentionally configured.
- Scheduler switches are intentionally configured.
- Rollback plan is known.
```

---

## Debugging and troubleshooting

### Internal auth

Most internal routes require:

```text
x-internal-api-secret: $INTERNAL_API_SECRET
```

Example:

```bash
curl -s \
  -H "x-internal-api-secret: $INTERNAL_API_SECRET" \
  "$WORKER_URL/internal/admin/summary"
```

### Useful internal endpoints

| Endpoint | Purpose |
|---|---|
| `GET /internal/admin/summary` | Effective runtime summary and secret configured/missing status. |
| `GET /internal/admin/config` | Admin config items and safe metadata. |
| `GET /internal/admin/timeline?sourceUrl=...` | Timeline for an item by source URL. |
| `GET /internal/admin/timeline?generatedOutputId=...` | Timeline for an output. |
| `GET /internal/telegram/outputs/recent?limit=...` | Recent Telegram generated outputs. |
| `GET /internal/telegram/outputs/debug?generatedOutputId=...` | Internal output diagnostics. |
| `GET /internal/media/jobs?limit=...` | Recent media jobs. |
| `POST /internal/telegram/publish/preview` | Publish preview and blockers. |
| `GET /internal/admin/test-data/counts` | Staging test data counts. |
| `POST /internal/admin/test-data/reset` | Staging operational reset. |

### Bot token shows missing in dashboard

Check backend truth first:

```bash
curl -s \
  -H "x-internal-api-secret: $INTERNAL_API_SECRET" \
  "$WORKER_URL/internal/admin/summary"
```

Then check admin config:

```bash
curl -s \
  -H "x-internal-api-secret: $INTERNAL_API_SECRET" \
  "$WORKER_URL/internal/admin/config"
```

If backend is correct but dashboard is stale:

```bash
pnpm dashboard:build
```

Then redeploy/refresh the dashboard.

### Instagram caption fallback

Inspect generated output:

```bash
curl -s \
  -H "x-internal-api-secret: $INTERNAL_API_SECRET" \
  "$WORKER_URL/internal/telegram/outputs/debug?generatedOutputId=YOUR_OUTPUT_ID"
```

Look for:

```text
validationErrors
rawText
caption
headline
summary
sourceAttributionDebug
```

Common causes:

- AI returned invalid JSON.
- AI output was truncated.
- Prompt profile max tokens too low.
- Output schema mismatch.
- Source text was empty or low quality.

### Instagram media skipped

Check recent media jobs:

```bash
curl -s \
  -H "x-internal-api-secret: $INTERNAL_API_SECRET" \
  "$WORKER_URL/internal/media/jobs?limit=10"
```

Open the GitHub run URL from the media job.

Common causes:

- Instagram requires login.
- Anonymous requests are rate-limited.
- `yt-dlp` or `gallery-dl` could not access the post.
- Cookie secret missing/expired.
- Media was detected but failed Telegram constraints.
- Callback received skipped/failed status.

If logs show login/rate-limit required, configure:

```text
INSTAGRAM_COOKIES_B64
```

### Review edit not applied

Expected flow:

```text
1. Tap Edit on review controls.
2. Reply to the review controls message with the new caption/text.
3. The system stores the edit on the generated output.
4. Send uses the edited output.
```

Do not reply to an unrelated media message.

### Publish preview blocked

Use:

```bash
curl -s \
  -H "x-internal-api-secret: $INTERNAL_API_SECRET" \
  -H "content-type: application/json" \
  -X POST \
  "$WORKER_URL/internal/telegram/publish/preview" \
  --data '{"generatedOutputId":"YOUR_OUTPUT_ID"}'
```

Common blockers:

- Queue row not found.
- Queue status already published.
- Final publishing disabled.
- Bot token missing.
- Media not ready.
- Final chat/channel missing.
- Output not actionable.

### D1 binding not found during deploy

This usually means the active Cloudflare account does not contain the D1 database ID configured in `wrangler.toml`.

Check:

```bash
pnpm wrangler d1 list
```

Confirm Cloudflare account credentials, selected environment, and D1 database ID.

---

## Operational safety rules

- Never commit secrets.
- Never commit cookies.
- Never put Cloudflare API tokens in dashboard config.
- Use staging for destructive tests.
- Do not run production deploys casually.
- Do not enable final publishing until bot, final channel, reviewer IDs, and media behavior are verified.
- Keep scheduler publishing disabled unless intentionally launching automation.
- Treat GitHub Actions logs as operationally sensitive.
- Use a dedicated test account for social media cookies.
- Rotate cookies/API tokens if they were exposed.
- Prefer PRs and small reviewable changes.

---

## Known limitations

- Some Instagram Reels require login/cookies or hit rate limits. Caption extraction may still work while media download is skipped.
- Social media extractors are inherently flaky because platforms change behavior and rate limits.
- Local development does not fully reproduce Cloudflare Worker + Telegram webhook + GitHub Actions runtime.
- AI output can be invalid or truncated; fallback behavior is intentional but should be monitored.
- Media processor reliability depends on GitHub Actions availability and external platform access.
- Production scheduler/publishing must be enabled carefully and intentionally.
- WordPress integration is available but should be treated separately from Telegram launch readiness.

---

## Roadmap and follow-ups

Recommended follow-ups:

- Clearer review-card messaging when media is skipped because login/rate-limit is required.
- Optional retry path for media jobs.
- Better AI invalid JSON retry/repair path.
- More dashboard diagnostics for media processor failures.
- Dedicated cookie setup guide for Instagram/X test accounts.
- Production launch checklist.
- Stronger separation between staging and production docs.
- More route-level and prompt-profile examples.
- Expanded runbooks for rollback and incident response.

---

## Glossary

| Term | Meaning |
|---|---|
| Item | Normalized source content record. |
| Source URL | External URL from Telegram/source input. |
| Dedupe key | Key used to prevent repeated processing. |
| Route | Category/topic routing configuration. |
| Route output | Output target/language/channel configuration for a route. |
| Prompt profile | AI prompt/model/output configuration. |
| Generated output | AI-created output prepared for review/publish. |
| Review message | Telegram message sent to review topic. |
| Review controls | Telegram inline controls for edit/approve/send actions. |
| Edit workflow | Reviewer replies to controls message to update output text. |
| Media job | D1 record tracking external media processing. |
| Media asset | Prepared/staged media result with Telegram file metadata. |
| Cache chat | Telegram chat/channel used to stage media and store file IDs. |
| Source topic | Telegram topic where input content is submitted. |
| Review topic | Telegram topic where human review happens. |
| Final channel | Telegram destination for approved published output. |
| Publish queue | Queue of outputs waiting for final publish. |
| Internal API secret | Header secret protecting internal admin/debug routes. |

---

## Quick command reference

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm dashboard:build
pnpm dashboard:dev
pnpm worker:dev
pnpm worker:deploy:staging
pnpm worker:deploy:production
pnpm d1:migrate:local
pnpm d1:migrate:remote
pnpm d1:migrate:production
pnpm check:production
```

---

## Maintainer notes

This project is intentionally safety-first.

When adding new capabilities:

1. Keep mock/default behavior safe.
2. Add config gates for real side effects.
3. Keep secrets out of source control.
4. Add internal diagnostics before guessing.
5. Prefer staging validation before production.
6. Keep PRs focused.
7. Update this README when operational behavior changes.
