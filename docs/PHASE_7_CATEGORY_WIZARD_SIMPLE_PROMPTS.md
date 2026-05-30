# Phase 7: Category Wizard and Simple Prompt Manager

## Goal

The dashboard should be usable without knowing database IDs or internal prompt binding concepts.

Operators should be able to:

- Create a category.
- Add languages to a category.
- Set prompts for a category/language.
- Edit prompt settings.
- Save and connect prompts automatically.

## Daily prompt fields

The simple prompt editor keeps only useful daily fields:

- Prompt text / system instruction
- User prompt template
- Negative prompt
- Temperature
- Max tokens
- Risk policy
- Style guide

Advanced fields such as profile ID, version, binding ID, status, and content type are hidden from simple mode.

## Category wizard

The category wizard creates:

- Telegram route
- Telegram route outputs
- Prompt profiles
- Prompt bindings
- Default publish policy
- Default signature settings

## Add language

For an existing category, the Add Language flow creates:

- New route output, such as `crypto_ar`
- Prompt profile, such as `crypto_ar_editorial`
- Prompt binding from the output to the profile

## Backend endpoints

- `GET /internal/admin/categories`
- `POST /internal/admin/categories/preview`
- `POST /internal/admin/categories/create`
- `POST /internal/admin/categories/:category/add-language`
- `GET /internal/admin/prompt-map`
- `POST /internal/admin/prompt-map/upsert`

## Migration

`packages/db/migrations/0036_prompt_negative_prompt.sql` adds optional negative prompt support.

Apply before using negative prompt in production/staging:

```bash
pnpm d1:migrate:production
# or staging/local equivalent
```
