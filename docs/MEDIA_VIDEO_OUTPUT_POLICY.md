# Media Video Output Policy

## Goal

Prepare social videos for Telegram review/final publishing while preserving aspect ratio and avoiding unnecessary transcode.

## Default policy

```text
Profile: telegram_review_optimized
Container: mp4
Video: h264 preferred
Audio: aac preferred
Fast start: enabled
Max side: 1920
Base CRF: 23
Audio bitrate: 128k
Preserve aspect ratio: yes
Crop: no
Square conversion: no
Padding: no by default
```

## Processing strategy

1. Use direct/progressive MP4 when available.
2. Remux/copy when codecs and size are acceptable.
3. Add faststart without re-encoding when possible.
4. Transcode only when size, codec, SAR/rotation, or Telegram compatibility requires it.
5. Record original/prepared/Telegram dimensions and aspect drift.

## Important rules

- Vertical videos must remain vertical.
- A square candidate should be rejected or warned if the original video is vertical.
- No crop should happen unless explicitly configured in a future profile.
- Aspect drift above the configured threshold should produce warnings.

## Config

```text
MEDIA_VIDEO_OUTPUT_PROFILE=telegram_review_optimized
MEDIA_VIDEO_TRANSCODE_POLICY=copy_if_possible
MEDIA_MAX_VIDEO_SIDE=1920
MEDIA_VIDEO_CRF=23
MEDIA_VIDEO_AUDIO_BITRATE=128k
MEDIA_ASPECT_DRIFT_THRESHOLD=0.02
```

## Dashboard visibility

Media jobs and Operations Overview should show:

- original dimensions
- prepared dimensions
- Telegram dimensions
- duration
- file size
- aspect drift
- provider
- remux/transcode status
