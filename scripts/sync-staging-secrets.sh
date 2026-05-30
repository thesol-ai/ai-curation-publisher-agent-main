#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Missing CLOUDFLARE_ACCOUNT_ID}"
: "${TELEGRAM_BOT_TOKEN:?Missing TELEGRAM_BOT_TOKEN}"
: "${INTERNAL_API_SECRET:?Missing INTERNAL_API_SECRET}"
: "${CONFIG_ENCRYPTION_KEY:?Missing CONFIG_ENCRYPTION_KEY}"
: "${MEDIA_PROCESSOR_GH_TOKEN:?Missing MEDIA_PROCESSOR_GH_TOKEN}"

printf "%s" "$INTERNAL_API_SECRET" | pnpm dlx wrangler@4 secret put INTERNAL_API_SECRET --env staging --config wrangler.toml
printf "%s" "$CONFIG_ENCRYPTION_KEY" | pnpm dlx wrangler@4 secret put CONFIG_ENCRYPTION_KEY --env staging --config wrangler.toml
printf "%s" "$TELEGRAM_BOT_TOKEN" | pnpm dlx wrangler@4 secret put TELEGRAM_BOT_TOKEN --env staging --config wrangler.toml
printf "%s" "$MEDIA_PROCESSOR_GH_TOKEN" | pnpm dlx wrangler@4 secret put MEDIA_PROCESSOR_GH_TOKEN --env staging --config wrangler.toml

echo "Staging secrets synced."
