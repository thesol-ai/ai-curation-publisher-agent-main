# Staging Setup Guide

This document lists every step required before enabling real integrations in staging.
Follow these in order. Do not enable `APIFY_CURATION_ENABLED=true` or `TELEGRAM_FINAL_PUBLISH_ENABLED=true`
until all steps are verified.

---

## 1. Cloudflare Worker secrets (set via `wrangler secret put`)

Run for the staging environment (`--env staging`):

```bash
wrangler secret put INTERNAL_API_SECRET --env staging
wrangler secret put TELEGRAM_BOT_TOKEN --env staging
wrangler secret put GITHUB_MEDIA_PROCESSOR_TOKEN --env staging   # PAT with workflow dispatch scope
wrangler secret put ANTHROPIC_API_KEY --env staging              # Required for curation
wrangler secret put APIFY_TOKEN --env staging                    # Required for fetching datasets
```

## 2. wrangler.toml — fill in placeholder values

Open `wrangler.toml` and set these under `[env.staging.vars]`:

| Key | Value |
|-----|-------|
| `GITHUB_MEDIA_PROCESSOR_REPOSITORY` | `thesol-ai/ai-curation-publisher-agent-main` |
| `WORKER_PUBLIC_BASE_URL` | `https://<your-staging-worker>.workers.dev` |
| `TELEGRAM_MEDIA_CACHE_CHAT_ID` | Private supergroup chat ID (e.g. `-100xxxxxxxxxx`) |
| `TELEGRAM_MEDIA_STAGING_CHAT_ID` | Same or a separate staging chat |

Leave `GITHUB_MEDIA_PROCESSOR_CALLBACK_URL` blank — it is built automatically from `WORKER_PUBLIC_BASE_URL`.

## 3. GitHub Actions secrets (set in repo Settings → Secrets and variables → Actions)

| Secret | Value |
|--------|-------|
| `TELEGRAM_BOT_TOKEN` | Same bot token as above |
| `TELEGRAM_MEDIA_CACHE_CHAT_ID` | Same staging chat ID |
| `WORKER_INTERNAL_API_SECRET` | Same value as `INTERNAL_API_SECRET` above |
| `INSTAGRAM_COOKIES_B64` | Optional — Base64-encoded Instagram cookies |
| `X_COOKIES_B64` | Optional — Base64-encoded X/Twitter cookies |

> **Critical**: `WORKER_INTERNAL_API_SECRET` in GitHub Actions must exactly match `INTERNAL_API_SECRET` in the Worker.
> The media processor sends this as the `x-internal-api-secret` header on callbacks.

## 4. Run D1 migration

```bash
wrangler d1 migrations apply your_database_name --remote --env staging --config wrangler.toml
```

Verify migration 0037 ran:
```bash
wrangler d1 execute your_database_name --remote --env staging --command "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'apify%' OR name LIKE 'claude%';"
```

## 5. Register category sources in D1

Insert at least one source per category you want to curate. Example:

```sql
INSERT INTO apify_curation_sources (id, category, platform, apify_dataset_id, label, enabled)
VALUES
  ('src_crypto_ig', 'crypto', 'instagram', '<your-apify-dataset-id>', 'Crypto Instagram', 1),
  ('src_crypto_x',  'crypto', 'x',         '<your-apify-dataset-id>', 'Crypto X',         1);
```

## 6. Ensure category routes exist

The curation pipeline routes selected items to a Telegram route by `category` name.
Verify at least one enabled route per category:

```sql
SELECT id, category, enabled FROM telegram_routes WHERE enabled = 1;
```

## 7. Dry-run test

Deploy staging:
```bash
pnpm worker:deploy:staging
```

Trigger a dry-run (no Claude call, no publishing):
```bash
curl -X POST https://<staging-worker>.workers.dev/internal/apify/curation/trigger \
  -H "x-internal-api-secret: <INTERNAL_API_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

Check crawl runs in D1:
```bash
wrangler d1 execute your_database_name --remote --env staging --command "SELECT id, category, status, total_items FROM apify_crawl_runs ORDER BY created_at DESC LIMIT 10;"
```

## 8. Test media processing

Trigger a manual media processing job:
```bash
curl -X POST https://<staging-worker>.workers.dev/internal/media/process \
  -H "x-internal-api-secret: <INTERNAL_API_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"sourceUrl": "https://x.com/example/status/123", "itemId": "test_item_1"}'
```

Monitor the GitHub Actions workflow run in your repo's Actions tab.
Verify the callback arrives at `/internal/media/processing/callback`.

## 9. Enable Claude curation (with publish still off)

In `wrangler.toml` staging vars, set:
```toml
APIFY_CURATION_ENABLED = "true"
APIFY_CURATION_DRY_RUN = "false"
TELEGRAM_FINAL_PUBLISH_ENABLED = "false"   # Keep this false
```

Deploy and trigger:
```bash
pnpm worker:deploy:staging
curl -X POST https://<staging-worker>.workers.dev/internal/apify/curation/trigger \
  -H "x-internal-api-secret: <INTERNAL_API_SECRET>"
```

Check `claude_curation_decisions` and `apify_crawl_runs` tables to verify Claude is selecting items correctly.

## 10. Enable publishing (final step)

Only after all of the above verifies correctly:
```toml
TELEGRAM_FINAL_PUBLISH_ENABLED = "true"
```

Redeploy and monitor the source topic log and `telegram_publish_queue` table closely.

---

## Rollback

To immediately stop all publishing and curation:
```bash
# Disable curation
wrangler secret put APIFY_CURATION_ENABLED --env staging   # set to "false"
# Or in wrangler.toml:
# APIFY_CURATION_ENABLED = "false"
# TELEGRAM_FINAL_PUBLISH_ENABLED = "false"
pnpm worker:deploy:staging
```
