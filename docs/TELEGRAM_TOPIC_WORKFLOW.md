# Telegram Topic Workflow

Phase 35 polishes the Telegram topic-based operations experience for non-technical operators while keeping the system safe by default.

Safety defaults remain:

- One central Telegram bot is used.
- Routing is based on `chat.id` plus `message_thread_id`, not topic names or AI guesses.
- Review remains human-controlled.
- Final Telegram publishing is disabled unless `TELEGRAM_FINAL_PUBLISH_ENABLED=true` is explicitly configured server-side.
- WordPress remains optional.
- Scheduler publishing remains disabled.
- Raw route payloads belong in Technical only.

## Mental model

Use one central Telegram bot.

The bot is added to:

1. One internal forum supergroup with source topics and review topics.
2. One or more public channels where approved posts may be published when final publishing is explicitly enabled.

The bot is only the messenger. The system does not guess a category from message text or topic title. Routing is deterministic:

```text
source_chat_id + source_thread_id
  -> telegram_routes row
  -> category
  -> prompt_profile
  -> telegram_route_outputs rows
  -> review topic(s)
  -> final channel(s)
```

Topic names are only for humans. The system uses numeric topic IDs.

## Finding chat IDs and topic IDs

The Worker sees these values in Telegram webhook updates:

| Telegram update field | Route config field |
| --- | --- |
| `message.chat.id` | `sourceChatId` or `reviewChatId` |
| `message.message_thread_id` | `sourceThreadId` or `reviewThreadId` |

For setup, send a test message in the source topic and inspect the webhook/debug payload in Worker logs or safe internal tooling. Do not rely on the visible topic name.

Examples:

```text
source chat ID: -1001234567890
source topic ID: 101
review topic ID: 201
final channel: @crypto_fa
```

## Route manager

The dashboard route manager under Settings -> Telegram shows an operator-friendly summary:

- Telegram bot status: Configured or Missing
- Final publishing: Disabled or Enabled
- Route count
- Enabled output count
- Media mode
- WordPress: Optional

Route cards show:

- category
- source chat ID
- source topic/thread ID
- prompt profile
- enabled or disabled
- output count
- warning if an enabled route has no enabled outputs

Output summaries show:

- language
- review chat ID
- review topic/thread ID
- final channel/chat ID
- enabled or disabled
- latest status when available

The dashboard helper `telegram-route-manager.ts` keeps labels friendly and keeps technical field names in helper text. It does not define or expose secret inputs.

## Protected route management APIs

All endpoints require `x-internal-api-secret` when `INTERNAL_API_SECRET` is configured.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/internal/telegram/topic-routes` | `GET` | List route manager state and validation summary. |
| `/internal/telegram/topic-routes` | `POST` | Create or upsert a route. |
| `/internal/telegram/topic-routes/:id` | `PUT` | Update a route. |
| `/internal/telegram/topic-routes/:id/disable` | `POST` | Disable a route. |
| `/internal/telegram/topic-routes/:id/outputs` | `POST` | Create or upsert an output for a route. |
| `/internal/telegram/topic-route-outputs/:id` | `PUT` | Update a route output. |
| `/internal/telegram/topic-route-outputs/:id/disable` | `POST` | Disable a route output. |
| `/internal/telegram/topic-routes/validate` | `POST` | Validate stored route config. |
| `/internal/telegram/outputs/recent` | `GET` | Read recent generated Telegram outputs with redacted errors. |

Validation checks:

- source chat ID is present
- source topic ID is numeric
- review chat ID is present
- review topic ID is numeric
- final chat/channel ID is present
- enabled route has at least one enabled output
- duplicate source chat/topic is rejected
- duplicate output ID is rejected

## Example route config

```json
{
  "id": "crypto",
  "category": "crypto",
  "sourceChatId": "-1001111111111",
  "sourceThreadId": 101,
  "promptProfile": "crypto_editorial",
  "enabled": true
}
```

Example output config:

```json
{
  "id": "crypto_fa",
  "language": "fa",
  "reviewChatId": "-1001111111111",
  "reviewThreadId": 201,
  "finalChatId": "@crypto_fa",
  "enabled": true
}
```

## Outputs and statuses

Each configured route output creates one language/channel-specific generated output.

Important statuses:

| Status | Meaning |
| --- | --- |
| `ready_for_review` | Draft was generated and sent to review. |
| `approved` | Reviewer pressed Send. |
| `queued_for_publish` | Final publishing is disabled, so the output is safely queued. |
| `publishing` | Real final publish is being attempted. |
| `published` | Telegram returned a final message ID. |
| `failed` | Publish or generation failed with a redacted error. |
| `cancelled` | Reviewer cancelled this output. |

Recent output status is available from:

```text
GET /internal/telegram/outputs/recent?limit=20
```

The response includes item ID, category, language, review status, publish queue status, final channel, redacted last error, and update time.

## Safe tests

Dashboard safe tests include:

1. Check Telegram route config: validates stored route tables, does not call Telegram, does not publish.
2. Telegram publish queue dry-run: reviews queue safety and retry eligibility, does not send a final post.
3. Telegram review dry-run: may send or simulate review only after confirmation, never final-publishes.

Do not add casual final-public-publish controls. A final publish test must remain hidden/disabled unless `TELEGRAM_FINAL_PUBLISH_ENABLED=true`, and it must require explicit confirmation.

## Review buttons

Review drafts use output-level callback data:

```text
tgout:send:<generated_output_id>
tgout:cancel:<generated_output_id>
tgout:status:<generated_output_id>
```

`Send` creates or reuses a `telegram_publish_queue` row.

If final publishing is disabled, the callback response says:

```text
Queued. Final Telegram publishing is disabled.
```

If final publishing is enabled server-side, the Worker attempts final Telegram publishing and updates the generated output and queue statuses.

## Retry failed Telegram publishes

Protected retry route:

```text
POST /internal/telegram/publish/retry
```

Request body, choose one identifier:

```json
{ "queueId": "tgpub_abc123" }
```

or:

```json
{ "generatedOutputId": "tgout_abc123" }
```

Safety behavior:

- only retries rows in `telegram_publish_queue` with `status = failed`
- does not enable final publishing by itself
- returns `skipped` if `TELEGRAM_FINAL_PUBLISH_ENABLED=false`
- redacts Telegram API errors before storing or returning them
- never exposes bot tokens or raw Telegram API descriptions

## Final publishing flag

Final publishing is controlled by:

```text
TELEGRAM_FINAL_PUBLISH_ENABLED=false
```

Default is false in local and production Wrangler config.

Required for real final publishing:

- `TELEGRAM_FINAL_PUBLISH_ENABLED=true`
- `TELEGRAM_BOT_TOKEN` configured as a Worker Secret or encrypted admin secret
- bot admin/posting permission in the final channel
- configured `finalChatId` for the route output

## Media behavior

Phase 35 keeps metadata-only mode working.

Incoming Telegram source messages store:

- `file_id`
- `file_unique_id`
- media type
- MIME type when present
- size when present
- width/height/duration when present
- `media_group_id` when present

Current final publish can reuse Telegram `file_id` for:

- photo -> `sendPhoto`
- video or animation -> `sendVideo`
- document -> `sendDocument`

Known limitations now explicitly moved to Phase 36:

- R2 download/upload is not implemented yet.
- `sendMediaGroup` is reported as unsupported by `/status` for this branch.
- If a source message has multiple media assets, the current final publish path uses the first publishable Telegram file ID or fails clearly for unsupported groups.
- Media remains Telegram-file-id based. This is safe for Telegram-to-Telegram reuse, but not yet a full cross-platform media archive.

Status warning:

```text
Media storage is not configured. Telegram file_id reuse is active.
sendMediaGroup is not enabled in this Worker path yet; mixed albums publish one safe file or fail clearly.
```

## Status and readiness

`/status` and `/ready` include:

```text
telegram.topicWorkflow.routeManagerReady
telegram.topicWorkflow.routeValidation.valid
telegram.topicWorkflow.routeValidation.invalidRouteCount
telegram.topicWorkflow.routeValidation.issueCount
telegram.topicWorkflow.enabledRouteCount
telegram.topicWorkflow.enabledOutputCount
telegram.topicWorkflow.mediaMode
telegram.topicWorkflow.sendMediaGroupSupported
telegram.topicWorkflow.finalPublishingEnabled
telegram.topicWorkflow.wordpressOptional
telegram.topicWorkflow.routes
```

Final publishing disabled is not a readiness error. It is the safe default.

WordPress remains optional for the Telegram topic workflow.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Source message is ignored | Route exists, route is enabled, source chat ID matches `message.chat.id`, source topic ID matches `message_thread_id`. |
| Route shows warning | Enabled route needs at least one enabled output. |
| Review message is not sent | Bot token is configured, real review flag is intended, bot can post in review topic. |
| Send only queues | `TELEGRAM_FINAL_PUBLISH_ENABLED=false` is active. This is safe. |
| Publish retry returns skipped | Final publishing is still disabled. Enable only server-side and intentionally. |
| Media album does not publish as album | `sendMediaGroup` is not enabled in this branch; plan Phase 36. |
| WordPress missing | Safe for Telegram-only flow. WordPress is optional. |

## Phase 36 candidates

- R2 media download/upload.
- Full `sendMediaGroup` final publishing.
- Provider automation from Apify/X/Instagram into route IDs.
- Deeper album and mixed-media handling.

## Intentionally not included

- One-click public final publish controls.
- Scheduler publishing.
- Public WordPress publishing.
