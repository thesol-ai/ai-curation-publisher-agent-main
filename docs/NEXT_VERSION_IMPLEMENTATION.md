# Next Version Implementation Notes

This build adds the first production-oriented slice of the Admin Config Center roadmap.

## Implemented

- Admin Summary API: `GET /internal/admin/summary`
  - Safe runtime overview for routes, outputs, media settings, AI settings, publish queue counts, generated output counts, recent media jobs, recent queue rows, configured-secret flags, and launch readiness.
- Admin Validation API: `GET /internal/admin/validate`
  - Actionable issues with `severity`, `area`, `code`, `message`, and `action`.
  - Covers security, routes, outputs, media cache, GitHub media processor, AI credentials, publishing scheduler, and channel signatures.
- Safe Config Export: `GET /internal/admin/config/export`
  - Exports routes, outputs, media settings, AI settings, publishing settings, validation, and configured-secret flags.
  - Secret values are never exported.
- Admin Media Settings API: `GET/PATCH /internal/admin/media/settings`
  - Allows dashboard-managed D1 overrides for media processor and media cache settings.
  - Secrets still remain Worker Secrets or encrypted admin secrets.
- Route output channel signatures
  - New migration: `packages/db/migrations/0034_telegram_output_signatures.sql`.
  - New output fields: `signatureEnabled`, `signatureText`, `signatureChannelHandle`, `signaturePosition`.
  - Signatures are appended to review preview captions and final Telegram publishing captions.
  - Validation requires public handles to start with `@` and use Telegram-safe characters.
- Dashboard additions
  - New Diagnostics tab backed by the admin summary/validation/export APIs.
  - Route builder now supports per-output channel signatures.
  - Telegram route summaries expose signature state.

## Migration

Apply D1 migrations before using signatures:

```bash
pnpm d1:migrate:local
pnpm d1:migrate:remote
pnpm d1:migrate:production
```

## New channel signature behavior

For an output such as `crypto_fa`, the final caption becomes:

```text
<generated caption>

<signature text if configured>
@public_channel_handle
```

The same rendered caption is used in:

- text-only review previews
- media review captions
- final Telegram publishing

Review controls remain separate and do not contain the signature.

## Guardrails preserved

- Media Cache remains an internal technical target, not a product output.
- Secrets are represented as configured/missing only.
- Source links remain buttons in review controls, not raw text in captions.
- External media pending still avoids duplicate text-only reviews.
- Final publishing remains controlled by server-side flags.
