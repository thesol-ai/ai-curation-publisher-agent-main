# Media Processor V2: Fast Download, Aspect-Safe Video, and Albums

This patch hardens the most important production path in the publisher workflow: external media download, Telegram cache upload, review playback, and final publish reuse.

## Problems addressed

- Social video downloads could be slow because yt-dlp preferred split `bestvideo+bestaudio` formats before progressive MP4.
- Videos could lose correct display behavior in Telegram when sample aspect ratio, rotation metadata, or missing streaming metadata was not normalized.
- Telegram review/final sends did not pass `supports_streaming`, width, height, or duration metadata when reusing cached file IDs.
- Multi-asset posts needed clearer album behavior and a higher cap aligned with Telegram's 10-item media group limit.
- Media job dashboard rows did not expose detected/stored asset counts.

## Download strategy

The GitHub Actions processor now prefers already-muxed MP4/progressive files first:

1. Best progressive MP4 under the configured Telegram file limit.
2. Best estimated-size progressive MP4.
3. Fallback progressive MP4.
4. Split video/audio only when needed.

It also enables concurrent fragment downloads via `YTDLP_CONCURRENT_FRAGMENTS` and supports `MEDIA_MAX_ASSETS`, capped at Telegram's 10-item album limit.

## Aspect-ratio strategy

The processor preserves the original display shape. It does not crop or square videos. For videos, it:

- remuxes MP4 files with `+faststart` for streaming-friendly playback;
- re-encodes only when needed for size limits, non-1:1 sample aspect ratio, or rotation metadata;
- uses longest-side scaling with `setsar=1`, not square scaling;
- generates thumbnails without square cropping;
- stores width, height, duration, mime type, file size, and Telegram file IDs in the callback payload.

## Telegram send strategy

When reusing cached Telegram file IDs, the Telegram client now includes streaming and dimension metadata for video sends and video media groups:

- `supports_streaming: true`
- `width`
- `height`
- `duration`

This improves inline video playback behavior in review topics and final channels.

## Multi-asset posts

A single social source URL can now return up to 10 assets. The callback stores all asset file IDs. Review and final publish reuse those file IDs as a Telegram media group when multiple assets are present.

Supported album cases:

- multiple photos;
- multiple videos;
- mixed photo/video albums;
- documents are still protected by Telegram policy and are not mixed with photo/video albums.

## Operational notes

Recommended GitHub Actions vars:

```text
MEDIA_MAX_ASSETS=10
YTDLP_CONCURRENT_FRAGMENTS=8
MEDIA_FASTSTART_COPY=true
MAX_FILE_MB=49
MAX_PHOTO_MB=9
```

For Instagram/X reliability, keep platform cookies configured when needed:

```text
INSTAGRAM_COOKIES_B64
X_COOKIES_B64
```

## Remaining future improvements

- Persist GitHub workflow run URLs in the dashboard.
- Add retry/cancel actions for individual media jobs.
- Add a source URL media debug screen showing yt-dlp extractor info, asset count, and selected formats.
- Add a fallback provider if yt-dlp fails for a platform-specific post.
