# Media Pipeline V3 Reliability and Debug

This patch makes the media pipeline safer for social posts that contain videos, photo sets, reels, and multi-asset albums.

## What changed

- `/internal/media/processing/callback` is the canonical media processor callback.
- Legacy `/internal/media/jobs/complete` adapts modern callback payloads when possible.
- Media processing now waits at item level before sending media-ready reviews. A review is sent only after all media jobs for an item are terminal unless `MEDIA_REVIEW_WAIT_MODE=partial_ready` is explicitly configured.
- Duplicate media-ready reviews are guarded by checking existing Telegram review messages for each generated output.
- Telegram-native media sent directly into a source topic is stored as `ready`, because Telegram already supplied reusable `file_id` values.
- Dashboard-cancelled media jobs ignore late GitHub callbacks to avoid resurrecting cancelled jobs.
- The GitHub media workflow sends a first `processing` callback with `githubRunId` and `githubRunUrl` so the dashboard can link to the run.
- Media callbacks include timings and asset diagnostics.
- The dashboard media page now includes a metadata-only URL debug panel, GitHub run links, timing summaries, retry/cancel controls, and asset dimension summaries.

## Canonical callback shape

```json
{
  "jobId": "mediajob_x",
  "status": "processing | ready | failed | skipped",
  "assets": [
    {
      "index": 0,
      "kind": "photo | video | document",
      "sourceUrl": "https://...",
      "telegramFileId": "...",
      "telegramFileUniqueId": "...",
      "telegramFileType": "photo | video | document",
      "mimeType": "video/mp4",
      "sizeBytes": 123,
      "width": 1080,
      "height": 1920,
      "durationSeconds": 17,
      "originalWidth": 1080,
      "originalHeight": 1920,
      "preparedWidth": 1080,
      "preparedHeight": 1920,
      "telegramWidth": 1080,
      "telegramHeight": 1920,
      "aspectDrift": 0,
      "transcoded": false,
      "remuxed": true
    }
  ],
  "timings": {
    "downloadMs": 2200,
    "prepareMs": 300,
    "telegramUploadMs": 1100,
    "totalMs": 3600
  },
  "raw": {
    "githubRunId": "123",
    "githubRunUrl": "https://github.com/owner/repo/actions/runs/123",
    "processor": "github_actions_v3_media_reliability"
  }
}
```

## New or clarified settings

```text
MEDIA_REVIEW_WAIT_MODE=all_terminal
MEDIA_REVIEW_ALLOW_PARTIAL=false
MEDIA_FINAL_REQUIRE_READY=true
MEDIA_FINAL_ALLOW_TEXT_FALLBACK=false
MEDIA_ASPECT_DRIFT_THRESHOLD=0.02
MEDIA_FALLBACK_PROVIDER_ENDPOINT=
MEDIA_MAX_ASSETS=10
YTDLP_CONCURRENT_FRAGMENTS=8
MEDIA_FASTSTART_COPY=true
```

## Speed strategy

The processor now tries media sources in this order:

1. Direct media URL download when the source URL already points to a media file.
2. Optional fallback provider via `MEDIA_FALLBACK_PROVIDER_ENDPOINT`.
3. `yt-dlp` with progressive MP4 preferred.
4. `yt-dlp` split video/audio fallback when progressive MP4 is unavailable.

The GitHub workflow also skips `apt-get install ffmpeg` when ffmpeg is already available and uses pip cache for dependencies.

## Aspect strategy

The processor preserves vertical videos by default. It avoids square crop/padding and records original, prepared, and Telegram dimensions. If aspect drift exceeds `MEDIA_ASPECT_DRIFT_THRESHOLD`, the asset is marked with a warning in callback output.

## Review behavior

For external media jobs, text-only review is not sent immediately. The worker waits for all media jobs for an item to become terminal, then sends one media-ready review per generated output. If all media fails, it sends a text fallback review with media failure risk flags.

## Remaining work

- Persist a dedicated media asset diagnostics table if long-term historical audit is needed.
- Add real external provider adapters for fallback direct media extraction if the fallback endpoint is not enough.
- Add a full item media timeline in the dashboard.
- Add true remote GitHub cancellation; current cancel marks the local job skipped and ignores late callbacks.
