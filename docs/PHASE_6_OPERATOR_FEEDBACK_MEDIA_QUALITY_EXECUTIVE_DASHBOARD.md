# Phase 6: Operator Feedback, Media Quality, Free Fallbacks, and Operations Overview

## Summary

This phase turns the previous operational-safety work into a more manager/operator friendly control layer.

It adds four practical capabilities:

1. A lightweight toast feedback system for important dashboard actions.
2. A visible media/video quality policy so vertical social videos remain vertical and are prepared for Telegram without unnecessary transcoding.
3. A free fallback extractor chain for social media downloads: direct URL detection, `gallery-dl`, `instaloader`, then `yt-dlp`, with optional external endpoint disabled by default.
4. An Operations Overview dashboard for management KPIs, funnel health, category performance, media performance, prompt health, provider attempts, queue blockers, and recent failures.

## Product goals

- Operators should know exactly what happened after each action.
- Managers should see system health without reading raw debug tables.
- Video media should preserve aspect ratio and use copy/remux before transcode whenever possible.
- Twitter/X and Instagram download fallback should be free/self-contained by default.
- Provider attempts and timing should be visible so slow/failing extraction can be diagnosed.

## Delivered scope

### Toast feedback

A dashboard-level toast stack was added for success, warning, error, and info events. It is wired into major actions such as refresh, save, route/output edits, media retry/cancel, dedupe search/reset, publish preview, publish now, and run-due publishing.

### Media quality policy

The media processor now exposes a video output policy through environment settings:

- `MEDIA_VIDEO_OUTPUT_PROFILE`
- `MEDIA_VIDEO_TRANSCODE_POLICY`
- `MEDIA_MAX_VIDEO_SIDE`
- `MEDIA_VIDEO_CRF`
- `MEDIA_VIDEO_AUDIO_BITRATE`

The default profile is intended for Telegram review/final publishing: preserve aspect ratio, avoid crop/square conversion, prefer copy/remux, fast-start MP4, transcode only when required.

### Free social fallback chain

The media processor attempts providers in configurable order.

Twitter/X default:

```text
direct,gallery_dl,yt_dlp,external
```

Instagram default:

```text
direct,gallery_dl,instaloader,yt_dlp,external
```

`gallery-dl` and `instaloader` are free/open-source command-line tools installed in the GitHub Actions media workflow. The external endpoint hook remains optional and disabled unless configured.

### Operations Overview

A new internal API endpoint was added:

```text
GET /internal/admin/analytics/overview?rangeDays=30&category=all
```

It powers a new Operations tab with:

- KPI cards
- publishing funnel
- queue health
- provider attempt chart
- media performance
- prompt performance
- category performance
- provider health
- top blockers / recent failures

## Acceptance checklist

- Important dashboard actions produce visible feedback.
- Operations tab loads from a backend aggregation endpoint.
- Media fallback provider attempts are captured in media job output JSON.
- Media debug displays provider order and quality policy.
- GitHub Actions installs `gallery-dl` and `instaloader` in addition to `yt-dlp`.
- Video policy is configurable from env/admin settings.

## Known limitations

- Real Instagram reliability may require cookies/session files. This remains free but operationally fragile.
- The Operations Overview aggregates from currently available tables; older rows without timing/provider metadata will show partial information.
- Toasts are lightweight in-app notifications, not a full persistent audit trail.
- Cobalt/self-hosted fallback remains optional and disabled by default.
