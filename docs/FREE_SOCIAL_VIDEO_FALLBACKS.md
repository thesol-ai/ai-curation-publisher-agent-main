# Free Social Video Fallbacks

## Purpose

The system should not rely only on `yt-dlp` for Twitter/X and Instagram media extraction. This phase adds a free provider chain that can discover direct media URLs before falling back to slower/heavier `yt-dlp` formats.

## Provider order

Twitter/X:

```text
direct -> gallery-dl -> yt-dlp -> optional external endpoint
```

Instagram:

```text
direct -> gallery-dl -> instaloader -> yt-dlp -> optional external endpoint
```

## Tools

- `gallery-dl`: used primarily to print direct URLs with `-g`.
- `instaloader`: Instagram-specific fallback.
- `yt-dlp`: still the broad fallback and final extractor.
- optional external endpoint: disabled by default.

## Configuration

```text
MEDIA_FALLBACK_ENABLED=true
MEDIA_FALLBACK_PROVIDER_ORDER_X=direct,gallery_dl,yt_dlp,external
MEDIA_FALLBACK_PROVIDER_ORDER_INSTAGRAM=direct,gallery_dl,instaloader,yt_dlp,external
MEDIA_GALLERY_DL_ENABLED=true
MEDIA_GALLERY_DL_TIMEOUT_SECONDS=25
MEDIA_GALLERY_DL_COOKIES_PATH=
MEDIA_INSTALOADER_ENABLED=true
MEDIA_INSTALOADER_TIMEOUT_SECONDS=30
MEDIA_INSTALOADER_SESSION_FILE=
MEDIA_COBALT_ENABLED=false
MEDIA_COBALT_ENDPOINT=
MEDIA_DIRECT_DOWNLOAD_TIMEOUT_SECONDS=60
```

## Provider attempt logging

Each provider attempt records:

- provider name
- status
- duration
- candidate count
- error message when available

These records are attached to media job output JSON and are shown in analytics/provider health.

## Operational notes

Instagram may require session/cookies for reliable access. The system should show explicit failure reasons such as login required, cookie missing, timeout, or extractor failure instead of treating all failures as generic download errors.
