# shadcn-style Dashboard and Prompt Studio Upgrade

This version moves the dashboard toward an operator-friendly control center without changing the core Telegram Media Cache architecture.

## Dashboard direction

The dashboard now uses an internal shadcn/ui-inspired component layer under:

```text
apps/dashboard/src/shared/ui.tsx
apps/dashboard/src/shared/charts.tsx
apps/dashboard/src/modern.css
apps/dashboard/src/ModernDashboardApp.tsx
```

The implementation intentionally keeps dependencies stable for this ZIP delivery. It does not fetch the shadcn CLI or new packages during generation because the execution environment cannot access the npm registry. The component layer mirrors shadcn patterns: cards, badges, alerts, progress, inputs, tables, and chart cards as source-owned primitives that can later be swapped for generated shadcn/ui components.

Recommended future dependency upgrade when npm access is available:

```bash
pnpm --filter @curator/dashboard add class-variance-authority clsx tailwind-merge lucide-react recharts @tanstack/react-query @tanstack/react-table react-hook-form zod
pnpm --filter @curator/dashboard add -D tailwindcss postcss autoprefixer
```

## New dashboard areas

- Overview with readiness score, KPI cards, status distributions, language breakdown, and media funnel.
- Routes and Outputs as operator tables.
- Internal Media Registry view, keeping Telegram Media Cache as the default multi-language-safe mode.
- Prompt Studio with prompt profile creation, activation, binding, and preview.
- Diagnostics with actionable issues and configured/missing secret flags.
- Activity for media jobs and publish queue.
- Technical payloads for debugging.

## Media Cache decision

Telegram Media Cache remains the default. It is presented as an Internal Media Registry because it is not a public product output. The current architecture is still the safest default for multi-language outputs: one external media download/upload produces reusable Telegram `file_id` values that can be attached to multiple review outputs and final channel publishes.

Future modes can be added without breaking current behavior:

```text
telegram_cache        current default, best for multi-language outputs
direct_review_upload  optional single-output shortcut, not default
external_storage      future Cloudflare R2 / signed URL mode
```

## Prompt Studio backend

New migration:

```text
packages/db/migrations/0035_prompt_studio.sql
```

New repository:

```text
packages/db/src/repositories/prompt-profiles.repository.ts
```

New protected APIs:

```text
GET  /internal/admin/prompts
POST /internal/admin/prompts
PUT  /internal/admin/prompts/:id
POST /internal/admin/prompts/:id/activate
POST /internal/admin/prompts/:id/archive
GET  /internal/admin/prompts/bindings
POST /internal/admin/prompts/bindings
POST /internal/admin/prompts/preview
GET  /internal/admin/metrics/overview
```

## Prompt resolution order

Runtime AI output generation now tries D1-managed prompts before falling back to code defaults:

```text
1. route_output_id exact binding
2. route_id + language binding
3. route_id binding
4. category + language binding
5. category binding
6. active prompt profile matching category/language
7. existing code prompt profile fallback
```

## Template variables

Prompt templates can use:

```text
{{category}}
{{language}}
{{sourceText}}
{{sourceUrl}}
{{canonicalUrl}}
{{authorHandle}}
{{links}}
{{mediaCount}}
{{contentType}}
{{tonePreset}}
{{channelSignature}}
{{targetAudience}}
{{riskPolicy}}
{{hashtagPolicy}}
{{sourceAttributionText}}
```

## Operational notes

Apply migrations before using Prompt Studio:

```bash
pnpm d1:migrate:local
pnpm d1:migrate:remote
```

For staging/production, use the existing environment-specific migration/deploy commands.
