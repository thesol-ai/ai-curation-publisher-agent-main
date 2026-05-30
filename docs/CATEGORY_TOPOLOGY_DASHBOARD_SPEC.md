# Category Topology Dashboard Spec

The dashboard should be understood through this chain:

```text
Category -> Source Topic -> Route -> Output -> Language -> Review Topic -> Prompt Binding -> Publish Policy -> Final Channel
```

## Implemented initial controls

- Global category scope selector.
- Category health table.
- Category workspace panel.
- Output matrix per category.
- Derived topic labels from route/output/media settings.
- Scoped routes, outputs, issues, and publishing queue where enough data is available.

## Future persistent topic registry

A future migration should add a persisted topic registry:

```text
id
label
chatId
threadId
role: source | review | media_cache | diagnostics | final | unknown
category
language
enabled
```

This will let the UI present human-readable Telegram topics instead of raw thread IDs and will enable better validation of source/review/cache topic role conflicts.
