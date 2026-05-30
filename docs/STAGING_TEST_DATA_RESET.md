# Staging Test Data Reset

The dashboard now includes a staging-only operational reset tool.

## Endpoint

```text
GET  /internal/admin/test-data/counts
POST /internal/admin/test-data/reset
```

Both routes require internal admin authentication.

## Safety

`POST /internal/admin/test-data/reset` is rejected unless:

```text
ENVIRONMENT=staging
confirm=RESET STAGING
```

The reset endpoint is intentionally unavailable in production.

## Supported scopes

- `dedupe_only`
- `outputs_only`
- `media_only`
- `queue_only`
- `reviews_only`
- `all_operational`
- `url_history`

## Preserved data

- `admin_config`
- `admin_config_audit`
- `settings`
- `sources`
- prompt profiles and bindings
- `telegram_routes`
- `telegram_route_outputs`
- D1 migrations
- secrets and deployment configuration

## Operational data cleared

The endpoint safely attempts to clear operational/test tables such as:

- `items`
- `dedupe_keys`
- `media_assets`
- `media_processing_jobs`
- `outputs`
- `provider_logs`
- `publish_queue`
- `review_actions`
- `review_messages`
- `telegram_generated_outputs`
- `telegram_publish_queue`
- `telegram_review_messages`
- `wordpress_posts`

Missing tables are skipped safely and reported as skipped/missing rather than crashing the reset.
