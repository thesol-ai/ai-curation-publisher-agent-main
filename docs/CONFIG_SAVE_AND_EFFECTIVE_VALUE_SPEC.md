# Config Save and Effective Value Spec

Settings must not report only that a save request succeeded. Operators need to know whether the saved value is now effective.

## UI states

- `clean`
- `dirty`
- `saving`
- `saved`
- `saved_but_not_effective`
- `failed`

## Required row metadata

Each setting row should expose:

- effective value
- draft value
- source: `d1`, `env`, `default`, `missing`, or secret source
- secret configured/missing state
- safety level
- where used

## Rules

- Secret values are write-only and never displayed.
- Numeric values such as `0` are valid and must not be treated as empty.
- Boolean metadata must be strict, for example `isSecret === true`.
- After save, refresh admin config and readiness only. Do not perform a full dashboard refresh unless the operator explicitly requests it.
