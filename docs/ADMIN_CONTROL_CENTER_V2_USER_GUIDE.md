# Admin Control Center V2 User Guide

## 1. Connect safely

1. Open the dashboard.
2. Paste the Worker URL.
3. Paste the Admin secret locally.
4. Click **Save & Connect**.
5. If the wrong Worker URL was saved before, click **Clear connection** and reconnect.

The dashboard stores connection data only in the browser session/local storage. Secret values are never shown back to the user.

## 2. Use Overview first

The Overview page shows readiness, active routes, enabled outputs, review backlog, media state, failures, and recent trend cards. Use it to decide whether the system is blocked, needs attention, or is ready for pilot operation.

## 3. Use Setup for guided launch

The Setup page shows a launch checklist and practical tests:

- Worker connection
- Admin access
- Telegram bot
- Internal Media Registry
- Routes
- Outputs
- AI readiness
- Publishing readiness

The Telegram permission matrix can test configured review and final targets using a safe `sendChatAction` call.

## 4. Manage settings

The Settings page is metadata-driven from the Worker Admin Config API.

Each setting shows:

- source: D1 override, environment, default, or missing
- safety level
- production requirement
- configured/missing for secrets
- Save and Reset controls

Secrets are write-only. Paste a new secret only when replacing or adding it.

## 5. Configure AI

The AI page shows provider/model controls, model presets, output behavior, and API key status. Use the AI test action to verify mock behavior or provider credential readiness. Live calls are explicit and should be used carefully.

## 6. Configure providers

The Providers page covers Firecrawl, Apify, GetXAPI, external metadata, and provider quotas. Provider tests verify credential readiness. Firecrawl supports a built-in live test. Apify/GetXAPI support an optional generic live probe when a URL is supplied through the API.

## 7. Configure Telegram

The Telegram page explains the difference between:

- Source topic
- Review topic
- Internal Media Registry topic
- Final channel

Use bot/review/final test buttons to check reachability. These tests do not publish visible posts; they use Telegram chat actions.

## 8. Build routes and outputs

The Routes page lets you create/update/disable routes and outputs.

Route = category and source topic.
Output = language, review topic, final channel, publishing policy, and channel signature.

Be careful when editing production routes. A bad topic ID or final channel ID can route content to the wrong place.

## 9. Manage Media Registry

The Media page keeps the Internal Media Registry visible and editable. Do not remove Media Registry for multi-language workflows. It lets one downloaded file produce reusable Telegram file IDs for several review/final outputs.

## 10. Use Prompt Studio

Prompt Studio supports:

- prompt editor
- prompt library
- activation/rollback
- archive
- prompt bindings
- visual line diff
- prompt preview
- prompt run history

Rollback is done by activating an older prompt profile version. Preview runs are recorded in prompt run history.

## 11. Control publishing

The Publishing page has:

- scheduler/final publishing status
- queue filters
- queue search
- Publish now
- Cancel
- Reschedule
- Bulk publish selected

Publish now is real. It sends the selected queue item to the final Telegram channel after confirmation. Published rows are not actionable.

## 12. Diagnostics and config import preview

Diagnostics shows actionable issues and related setting hints. The config import preview lets you paste a safe export and inspect route/output/media/AI counts without mutating D1.

Import preview is intentionally safe and read-only in this version.

## 13. Technical page

The Technical page shows raw redacted payloads for debugging:

- Worker status
- Admin summary
- Admin config
- Metrics
- Time-series
- Prompt Studio

Use it for debugging only, not day-to-day operations.
