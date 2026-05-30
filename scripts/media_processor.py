#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests

WORK_DIR = Path(os.getenv("RUNNER_TEMP", "/tmp")) / "curator-media-processor"
WORK_DIR.mkdir(parents=True, exist_ok=True)
MAX_ASSETS = max(1, min(int(os.getenv("MEDIA_MAX_ASSETS", "10")), 10))
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm", ".gif"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
PROVIDER_ATTEMPTS: list[dict[str, Any]] = []
SELECTED_PROVIDER: str | None = None


def video_output_profile() -> dict[str, Any]:
    return {
        "profile": os.getenv("MEDIA_VIDEO_OUTPUT_PROFILE", "telegram_review_optimized"),
        "transcodePolicy": os.getenv("MEDIA_VIDEO_TRANSCODE_POLICY", "copy_if_possible"),
        "maxSide": int(os.getenv("MEDIA_MAX_VIDEO_SIDE", "1920")),
        "maxFps": int(os.getenv("MEDIA_VIDEO_MAX_FPS", "30")),
        "crf": int(os.getenv("MEDIA_VIDEO_CRF", "23")),
        "audioBitrate": os.getenv("MEDIA_VIDEO_AUDIO_BITRATE", "128k"),
        "preserveAspectRatio": True,
        "noCrop": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Download external media, preserve aspect ratio, stage it in Telegram, and callback the Worker.")
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--item-id", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--callback-url", required=True)
    parser.add_argument("--media-asset-id", default="")
    parser.add_argument("--expected-kind", default="")
    args = parser.parse_args()

    try:
        started_at = time.perf_counter()
        validate_env()
        cookie_file = write_cookie_file(args.source_url)
        callback(args.callback_url, {
            "jobId": args.job_id,
            "mediaAssetId": args.media_asset_id or None,
            "status": "processing",
            "raw": {**github_run_metadata(), "sourceUrl": args.source_url, "processor": "github_actions_v3_media_reliability"},
            "timings": {"workflowStartedAt": iso_now()}
        })

        download_started_at = time.perf_counter()
        media_paths = download_media(args.source_url, cookie_file)
        download_ms = elapsed_ms(download_started_at)
        if not media_paths:
            message = "No downloadable media was found for this source URL."
            if strict_missing_media():
                raise RuntimeError(message)
            callback(args.callback_url, {
                "jobId": args.job_id,
                "mediaAssetId": args.media_asset_id or None,
                "status": "skipped",
                "errorMessage": message,
                "raw": {**github_run_metadata(), "sourceUrl": args.source_url, "reason": "no_media", "processor": "github_actions_v3_media_reliability", "providerAttempts": PROVIDER_ATTEMPTS, "selectedProvider": SELECTED_PROVIDER, "videoOutputPolicy": video_output_profile()},
                "timings": {"downloadMs": download_ms, "totalMs": elapsed_ms(started_at), "callbackSentAt": iso_now()}
            })
            print(json.dumps({"ok": True, "jobId": args.job_id, "status": "skipped", "reason": message}, ensure_ascii=False))
            return 0

        assets: list[dict[str, Any]] = []
        raw_assets: list[dict[str, Any]] = []
        group_id = f"media_group_{stable_hash(args.job_id)}" if len(media_paths) > 1 else None

        for index, media_path in enumerate(media_paths[:MAX_ASSETS]):
            try:
                media_type = classify_media(media_path)
                original_metadata = probe_media(media_path)
                original_media_type = media_type
                prepare_started_at = time.perf_counter()

                still_photo_path = maybe_convert_still_video_to_photo(
                    media_path,
                    media_type,
                    original_metadata,
                    source_asset_count=len(media_paths)
                )
                if still_photo_path is not None:
                    prepared_path = still_photo_path
                    prepared_type = "photo"
                else:
                    prepared_path = prepare_media_for_telegram(media_path, media_type)
                    prepared_type = classify_media(prepared_path)

                prepare_ms = elapsed_ms(prepare_started_at)
                validate_size(prepared_path, prepared_type)
                metadata = probe_media(prepared_path)
                thumbnail_path = generate_thumbnail(prepared_path) if prepared_type == "video" else None
                upload_started_at = time.perf_counter()
                telegram_payload = upload_to_telegram(prepared_path, prepared_type, thumbnail_path, args.source_url, metadata)
                upload_ms = elapsed_ms(upload_started_at)
                telegram_payload.update(asset_diagnostics(media_path, prepared_path, original_metadata, metadata, telegram_payload, prepare_ms, upload_ms))
                if original_media_type == "video" and prepared_type == "image":
                    telegram_payload["convertedStillVideoToPhoto"] = True
                    telegram_payload["originalDetectedKind"] = "video"
                    telegram_payload["preparedKind"] = "photo"
                if args.media_asset_id and index == 0:
                    telegram_payload["id"] = args.media_asset_id
                if group_id is not None:
                    telegram_payload["telegramMediaGroupId"] = group_id
                assets.append(telegram_payload)
                raw_assets.append({
                    "fileName": prepared_path.name,
                    "sourceFileName": media_path.name,
                    "mediaType": prepared_type,
                    "sizeBytes": prepared_path.stat().st_size,
                    "width": telegram_payload.get("width"),
                    "height": telegram_payload.get("height"),
                    "durationSeconds": telegram_payload.get("durationSeconds"),
                    "thumbnailGenerated": thumbnail_path is not None,
                    "prepareMs": prepare_ms,
                    "telegramUploadMs": upload_ms,
                    "aspectDrift": telegram_payload.get("aspectDrift"),
                    "transcoded": telegram_payload.get("transcoded"),
                    "remuxed": telegram_payload.get("remuxed")
                })
            except Exception as asset_error:  # noqa: BLE001
                if strict_missing_media():
                    raise
                print(f"Skipping one media asset: {safe_error(str(asset_error))}", file=sys.stderr)

        if not assets:
            message = "Media was detected, but no asset could be prepared under Telegram limits."
            raise RuntimeError(message)

        callback(args.callback_url, {
            "jobId": args.job_id,
            "mediaAssetId": args.media_asset_id or None,
            "status": "ready",
            "assets": assets,
            "raw": {
                **github_run_metadata(),
                "sourceUrl": args.source_url,
                "assetCount": len(assets),
                "assets": raw_assets,
                "processor": "github_actions_v3_media_reliability",
                "providerAttempts": PROVIDER_ATTEMPTS,
                "selectedProvider": SELECTED_PROVIDER,
                "videoOutputPolicy": video_output_profile()
            },
            "timings": {
                "downloadMs": download_ms,
                "totalMs": elapsed_ms(started_at),
                "callbackSentAt": iso_now()
            }
        })
        print(json.dumps({"ok": True, "jobId": args.job_id, "assetCount": len(assets)}, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001
        message = safe_error(str(exc))
        try:
            callback(args.callback_url, {
                "jobId": args.job_id,
                "mediaAssetId": args.media_asset_id or None,
                "status": "failed",
                "errorMessage": message,
                "raw": {**github_run_metadata(), "sourceUrl": args.source_url, "processor": "github_actions_v3_media_reliability", "providerAttempts": PROVIDER_ATTEMPTS, "selectedProvider": SELECTED_PROVIDER, "videoOutputPolicy": video_output_profile()},
                "timings": {"totalMs": elapsed_ms(started_at) if 'started_at' in locals() else None, "callbackSentAt": iso_now()}
            })
        except Exception as callback_exc:  # noqa: BLE001
            print(f"Callback failed after media failure: {safe_error(str(callback_exc))}", file=sys.stderr)
        print(json.dumps({"ok": False, "jobId": args.job_id, "error": message}, ensure_ascii=False), file=sys.stderr)
        return 1


def validate_env() -> None:
    missing = [name for name in ["TELEGRAM_BOT_TOKEN", "TELEGRAM_MEDIA_CACHE_CHAT_ID", "WORKER_INTERNAL_API_SECRET"] if not os.getenv(name)]
    if missing:
        raise RuntimeError(f"Missing required secret(s): {', '.join(missing)}")


def strict_missing_media() -> bool:
    return os.getenv("MEDIA_PROCESSING_STRICT", "false").lower() == "true"


def write_cookie_file(source_url: str) -> Path | None:
    host = urlparse(source_url).hostname or ""
    value = None
    name = None
    if "instagram" in host:
        value = os.getenv("INSTAGRAM_COOKIES_B64")
        name = "instagram-cookies.txt"
    elif "x.com" in host or "twitter.com" in host:
        value = os.getenv("X_COOKIES_B64")
        name = "x-cookies.txt"
    if not value or not name:
        return None
    path = WORK_DIR / name
    path.write_bytes(base64.b64decode(value))
    return path


def download_media(source_url: str, cookie_file: Path | None) -> list[Path]:
    global SELECTED_PROVIDER
    PROVIDER_ATTEMPTS.clear()
    SELECTED_PROVIDER = None
    if os.getenv("MEDIA_FALLBACK_ENABLED", "true").lower() == "false":
        return attempt_provider("yt_dlp", source_url, cookie_file)

    for provider in provider_chain(source_url):
        paths = attempt_provider(provider, source_url, cookie_file)
        if paths:
            SELECTED_PROVIDER = provider
            return paths
    return []


def provider_chain(source_url: str) -> list[str]:
    host = (urlparse(source_url).hostname or "").lower().replace("www.", "")
    if host in {"x.com", "twitter.com"} or host.endswith(".x.com") or host.endswith(".twitter.com"):
        raw = os.getenv("MEDIA_FALLBACK_PROVIDER_ORDER_X", "direct,gallery_dl,yt_dlp,external")
    elif "instagram.com" in host:
        raw = os.getenv("MEDIA_FALLBACK_PROVIDER_ORDER_INSTAGRAM", "direct,gallery_dl,instaloader,yt_dlp,external")
    else:
        raw = os.getenv("MEDIA_FALLBACK_PROVIDER_ORDER", "direct,yt_dlp,external")
    providers: list[str] = []
    for entry in raw.split(","):
        name = normalize_provider_name(entry)
        if name and name not in providers:
            providers.append(name)
    if "yt_dlp" not in providers:
        providers.append("yt_dlp")
    return providers


def normalize_provider_name(value: str) -> str:
    normalized = value.strip().lower().replace("-", "_")
    aliases = {"ytdlp": "yt_dlp", "yt-dlp": "yt_dlp", "gallerydl": "gallery_dl", "gallery-dl": "gallery_dl", "fallback": "external", "fallback_provider": "external", "cobalt": "external"}
    return aliases.get(normalized, normalized)


def attempt_provider(provider: str, source_url: str, cookie_file: Path | None) -> list[Path]:
    started = time.perf_counter()
    try:
        if provider == "direct":
            path = try_direct_download(source_url)
            paths = [] if path is None else [path]
        elif provider == "gallery_dl":
            paths = download_with_gallery_dl(source_url, cookie_file)
        elif provider == "instaloader":
            paths = download_with_instaloader(source_url)
        elif provider == "yt_dlp":
            paths = download_with_ytdlp(source_url, cookie_file)
        elif provider == "external":
            paths = download_with_fallback_provider(source_url)
        else:
            record_provider_attempt(provider, "skipped", elapsed_ms(started), error="unknown provider")
            return []
        record_provider_attempt(provider, "success" if paths else "no_candidates", elapsed_ms(started), candidate_count=len(paths))
        return paths
    except Exception as exc:  # noqa: BLE001
        record_provider_attempt(provider, "failed", elapsed_ms(started), error=safe_error(str(exc)))
        if provider == "yt_dlp" and strict_missing_media():
            raise
        return []


def record_provider_attempt(provider: str, status: str, duration_ms: int, candidate_count: int = 0, error: str | None = None, selected: str | None = None) -> None:
    PROVIDER_ATTEMPTS.append({
        "provider": provider,
        "status": status,
        "durationMs": duration_ms,
        "candidateCount": candidate_count,
        **({"errorMessage": error} if error else {}),
        **({"selected": selected} if selected else {})
    })


def command_available(module_or_command: str) -> bool:
    if shutil.which(module_or_command) is not None:
        return True
    completed = subprocess.run([sys.executable, "-m", module_or_command, "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    return completed.returncode == 0


def download_with_gallery_dl(source_url: str, cookie_file: Path | None) -> list[Path]:
    if os.getenv("MEDIA_GALLERY_DL_ENABLED", "true").lower() == "false":
        return []
    if not command_available("gallery_dl") and shutil.which("gallery-dl") is None:
        return []
    command = [sys.executable, "-m", "gallery_dl", "-g", source_url]
    if cookie_file is not None:
        command[3:3] = ["--cookies", str(cookie_file)]
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=int(os.getenv("MEDIA_GALLERY_DL_TIMEOUT_SECONDS", "25")), check=False)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or "gallery-dl failed")[-500:])
    urls = [line.strip() for line in completed.stdout.splitlines() if line.strip().startswith("http")]
    paths: list[Path] = []
    for index, direct_url in enumerate(urls[:MAX_ASSETS]):
        path = try_direct_download_url(direct_url, target_prefix=f"gallerydl_{index}")
        if path is not None:
            paths.append(path)
    return paths


def download_with_instaloader(source_url: str) -> list[Path]:
    if os.getenv("MEDIA_INSTALOADER_ENABLED", "true").lower() == "false":
        return []
    host = (urlparse(source_url).hostname or "").lower()
    if "instagram.com" not in host:
        return []
    shortcode = instagram_shortcode(source_url)
    if not shortcode:
        return []
    if not command_available("instaloader"):
        return []
    target_dir = WORK_DIR / f"instaloader_{stable_hash(shortcode)}"
    target_dir.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable, "-m", "instaloader",
        "--no-metadata-json", "--no-captions", "--no-compress-json",
        f"--dirname-pattern={target_dir}",
        "--filename-pattern={shortcode}_{date_utc}",
    ]
    session_file = os.getenv("MEDIA_INSTALOADER_SESSION_FILE", "").strip()
    if session_file:
        command.append(f"--sessionfile={session_file}")
    command.append(shortcode)
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=int(os.getenv("MEDIA_INSTALOADER_TIMEOUT_SECONDS", "30")), check=False)
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or "instaloader failed")[-500:])
    return collect_media_files(target_dir)


def instagram_shortcode(source_url: str) -> str | None:
    match = re.search(r"/(?:p|reel|tv)/([A-Za-z0-9_-]+)", urlparse(source_url).path)
    return match.group(1) if match else None


def collect_media_files(directory: Path) -> list[Path]:
    files = [path for path in directory.rglob("*") if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS and path.stat().st_size > 0]
    return sorted(files, key=media_order_key)[:MAX_ASSETS]


def download_with_fallback_provider(source_url: str) -> list[Path]:
    endpoint = os.getenv("MEDIA_FALLBACK_PROVIDER_ENDPOINT", "").strip()
    if not endpoint:
        return []
    try:
        response = requests.post(endpoint, json={"url": source_url, "maxAssets": MAX_ASSETS}, timeout=(10, 90), headers={"user-agent": "ai-curation-publisher-agent-media/3.0"})
        if not response.ok:
            return []
        payload = response.json()
    except Exception:
        return []
    direct_urls = payload.get("directUrls") if isinstance(payload, dict) else None
    if not isinstance(direct_urls, list):
        return []
    paths: list[Path] = []
    for index, direct_url in enumerate(direct_urls[:MAX_ASSETS]):
        if not isinstance(direct_url, str):
            continue
        path = try_direct_download_url(direct_url, target_prefix=f"fallback_{index}")
        if path is not None:
            paths.append(path)
    return paths


def source_download_candidates(source_url: str) -> list[str]:
    candidates = [source_url]
    try:
        parsed = urlparse(source_url)
        host = (parsed.hostname or "").lower().replace("www.", "")
        path = parsed.path + (("?" + parsed.query) if parsed.query else "")
        if host in {"x.com", "twitter.com"}:
            candidates.append(f"https://vxtwitter.com{path}")
            candidates.append(f"https://fxtwitter.com{path}")
    except Exception:
        pass
    seen: set[str] = set()
    unique: list[str] = []
    for candidate in candidates:
        if candidate not in seen:
            seen.add(candidate)
            unique.append(candidate)
    return unique


def try_direct_download(source_url: str, target_prefix: str = "direct") -> Path | None:
    parsed = urlparse(source_url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix not in MEDIA_EXTENSIONS:
        return None
    return try_direct_download_url(source_url, target_prefix=target_prefix)


def try_direct_download_url(source_url: str, target_prefix: str = "direct") -> Path | None:
    parsed = urlparse(source_url)
    suffix = Path(parsed.path).suffix.lower()
    with requests.get(source_url, stream=True, timeout=(12, int(os.getenv("MEDIA_DIRECT_DOWNLOAD_TIMEOUT_SECONDS", "60"))), headers={"user-agent": "ai-curation-publisher-agent-media/3.0"}) as response:
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
        if suffix not in MEDIA_EXTENSIONS:
            suffix = extension_for_content_type(content_type)
        if suffix not in MEDIA_EXTENSIONS:
            return None
        target = WORK_DIR / f"{target_prefix}_{stable_hash(source_url)}{suffix}"
        with target.open("wb") as handle:
            for chunk in response.iter_content(chunk_size=2 * 1024 * 1024):
                if chunk:
                    handle.write(chunk)
    return target if target.exists() and target.stat().st_size > 0 else None


def extension_for_content_type(content_type: str) -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm",
    }
    return mapping.get(content_type, mimetypes.guess_extension(content_type) or "")


def download_with_ytdlp(source_url: str, cookie_file: Path | None) -> list[Path]:
    try:
        import yt_dlp  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("yt-dlp is not available in this runner.") from exc

    max_file_bytes = media_limit_bytes("video")
    max_file_mb = max(1, math.floor(max_file_bytes / (1024 * 1024)))
    output_template = str(WORK_DIR / "download_%(playlist_index)s_%(id)s.%(ext)s")
    # Prefer already-muxed mp4/progressive files first. The old format selected split
    # bestvideo+bestaudio first, which is slower on social video and can force extra ffmpeg work.
    fast_format = (
        f"best[ext=mp4][vcodec!=none][filesize<={max_file_bytes}]/"
        f"best[ext=mp4][vcodec!=none][filesize_approx<={max_file_bytes}]/"
        f"b[ext=mp4][filesize<={max_file_bytes}]/"
        f"b[ext=mp4][filesize_approx<={max_file_bytes}]/"
        "best[ext=mp4][vcodec!=none]/"
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/"
        "bestvideo+bestaudio/best"
    )
    options: dict[str, Any] = {
        "outtmpl": output_template,
        "noplaylist": False,
        "playlistend": MAX_ASSETS,
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
        "format": fast_format,
        "format_sort": ["ext:mp4:m4a", "vcodec:h264", "res", "br"],
        "retries": 3,
        "fragment_retries": 3,
        "concurrent_fragment_downloads": int(os.getenv("YTDLP_CONCURRENT_FRAGMENTS", "8")),
        "socket_timeout": int(os.getenv("YTDLP_SOCKET_TIMEOUT", "20")),
        "http_chunk_size": int(os.getenv("YTDLP_HTTP_CHUNK_SIZE", str(10 * 1024 * 1024))),
        "max_filesize": max_file_bytes,
        "overwrites": True,
    }
    if cookie_file is not None:
        options["cookiefile"] = str(cookie_file)
    last_error: Exception | None = None
    for candidate_url in source_download_candidates(source_url):
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.extract_info(candidate_url, download=True)
            last_error = None
            break
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            continue
    if last_error is not None:
        if strict_missing_media():
            raise RuntimeError("yt-dlp could not download media for this source URL.") from last_error
        return []

    media_files: list[Path] = []
    seen_resolved: set[str] = set()
    for candidate in sorted(WORK_DIR.glob("download_*.*"), key=media_order_key):
        suffix = candidate.suffix.lower()
        if not candidate.is_file() or candidate.stat().st_size <= 0 or suffix in {".part", ".json", ".description"}:
            continue
        if suffix not in MEDIA_EXTENSIONS:
            continue
        if looks_like_generated_thumbnail(candidate):
            continue
        normalized = normalize_video_container(candidate) if classify_media(candidate) == "video" else candidate
        resolved = str(normalized.resolve())
        if resolved in seen_resolved:
            continue
        seen_resolved.add(resolved)
        media_files.append(normalized)
        if len(media_files) >= MAX_ASSETS:
            break
    return media_files




def maybe_convert_still_video_to_photo(path: Path, media_type: str, metadata: dict[str, Any], source_asset_count: int) -> Path | None:
    if media_type != "video":
        return None
    if shutil.which("ffmpeg") is None:
        return None

    duration = media_duration_seconds(metadata)
    if duration is None or duration > float(os.getenv("MEDIA_STILL_VIDEO_MAX_DURATION_SECONDS", "1.5")):
        return None

    if has_audio_stream(metadata):
        return None

    size_bytes = path.stat().st_size if path.exists() else 0
    max_still_video_bytes = int(os.getenv("MEDIA_STILL_VIDEO_MAX_BYTES", str(2 * 1024 * 1024)))

    # Conservative guard:
    # - multi-asset social posts often encode still images as 1s mp4/webm files
    # - very small silent 1s videos are usually generated still wrappers
    if source_asset_count <= 1 and size_bytes > max_still_video_bytes:
        return None

    target = WORK_DIR / f"still_{path.stem}.jpg"
    completed = subprocess.run([
        "ffmpeg",
        "-y",
        "-i",
        str(path),
        "-frames:v",
        "1",
        "-q:v",
        "2",
        str(target)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)

    if completed.returncode != 0 or not target.exists() or target.stat().st_size <= 0:
        return None

    return target


def media_duration_seconds(metadata: dict[str, Any]) -> float | None:
    stream = video_stream(metadata)
    for value in [stream.get("duration"), metadata.get("format", {}).get("duration") if isinstance(metadata.get("format"), dict) else None]:
        try:
            if value is not None:
                return float(value)
        except (TypeError, ValueError):
            continue
    return None


def has_audio_stream(metadata: dict[str, Any]) -> bool:
    streams = metadata.get("streams")
    if not isinstance(streams, list):
        return False
    return any(isinstance(stream, dict) and stream.get("codec_type") == "audio" for stream in streams)


def media_order_key(path: Path) -> tuple[int, int, str]:
    # Keep carousel/source order whenever yt-dlp exposes playlist_index in the filename.
    match = re.match(r"download_(\d+|NA|None)_", path.name)
    raw_index = match.group(1) if match else "NA"
    index = int(raw_index) if raw_index.isdigit() else 0
    try:
        mtime_ns = path.stat().st_mtime_ns
    except OSError:
        mtime_ns = 0
    return (index, mtime_ns, path.name)


def looks_like_generated_thumbnail(path: Path) -> bool:
    lower = path.name.lower()
    return any(marker in lower for marker in ["thumb", "thumbnail", "poster"])


def normalize_video_container(path: Path) -> Path:
    if shutil.which("ffmpeg") is None:
        return path
    metadata = probe_media(path)

    if needs_video_reencode_for_telegram(metadata):
        return transcode_video(path, media_limit_bytes("video"), reason="telegram_safe")

    if needs_video_reencode_for_display(metadata):
        return transcode_video(path, media_limit_bytes("video"), reason="display_aspect")

    if path.suffix.lower() == ".mp4" and os.getenv("MEDIA_FASTSTART_COPY", "true").lower() != "false":
        return remux_video_faststart(path)
    if path.suffix.lower() == ".mp4":
        return path
    target = path.with_suffix(".mp4")
    run(["ffmpeg", "-y", "-i", str(path), "-map", "0", "-c", "copy", "-movflags", "+faststart", str(target)], allow_fail=True)
    return target if target.exists() and target.stat().st_size > 0 else path


def remux_video_faststart(path: Path) -> Path:
    target = WORK_DIR / f"faststart_{path.stem}.mp4"
    run(["ffmpeg", "-y", "-i", str(path), "-map", "0", "-c", "copy", "-movflags", "+faststart", str(target)], allow_fail=True)
    return target if target.exists() and target.stat().st_size > 0 else path


def probe_media(path: Path) -> dict[str, Any]:
    if shutil.which("ffprobe") is None:
        return {}
    completed = subprocess.run([
        "ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if completed.returncode != 0:
        return {}
    try:
        parsed = json.loads(completed.stdout or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def video_stream(metadata: dict[str, Any]) -> dict[str, Any]:
    streams = metadata.get("streams")
    if not isinstance(streams, list):
        return {}
    for stream in streams:
        if isinstance(stream, dict) and stream.get("codec_type") == "video":
            return stream
    return {}


def needs_video_reencode_for_telegram(metadata: dict[str, Any]) -> bool:
    if os.getenv("MEDIA_FORCE_TELEGRAM_SAFE_VIDEO", "true").lower() == "false":
        return False

    stream = video_stream(metadata)
    if not stream:
        return False

    codec = str(stream.get("codec_name") or "").lower()
    pix_fmt = str(stream.get("pix_fmt") or "").lower()
    profile = str(stream.get("profile") or "").lower()
    fps = video_fps(stream)

    # Telegram clients are most reliable with H.264 + yuv420p + sane FPS.
    if codec not in {"h264", "avc1"}:
        return True
    if pix_fmt and pix_fmt not in {"yuv420p", "yuvj420p"}:
        return True
    if fps is not None and fps > float(os.getenv("MEDIA_VIDEO_MAX_FPS", "30")) + 0.5:
        return True

    # Avoid formats/profiles that commonly play as frozen thumbnail/audio-only in Telegram clients.
    if any(marker in profile for marker in ["high 4:4:4", "high 4:2:2", "main 10", "high 10"]):
        return True

    return False


def video_fps(stream: dict[str, Any]) -> float | None:
    raw = stream.get("avg_frame_rate") or stream.get("r_frame_rate")
    if not isinstance(raw, str) or "/" not in raw:
        return None
    left, right = raw.split("/", 1)
    try:
        numerator = float(left)
        denominator = float(right)
        if denominator <= 0:
            return None
        return numerator / denominator
    except (TypeError, ValueError):
        return None


def needs_video_reencode_for_display(metadata: dict[str, Any]) -> bool:
    stream = video_stream(metadata)
    if not stream:
        return False
    sar = str(stream.get("sample_aspect_ratio") or "1:1")
    if sar not in {"1:1", "0:1", "N/A"}:
        return True
    side_data = stream.get("side_data_list")
    if isinstance(side_data, list):
        for entry in side_data:
            if isinstance(entry, dict) and entry.get("rotation") not in (None, 0, "0"):
                return True
    tags = stream.get("tags")
    if isinstance(tags, dict) and tags.get("rotate") not in (None, "0", 0):
        return True
    return False


def classify_media(path: Path) -> str:
    metadata = probe_media(path)
    if video_stream(metadata):
        return "video"
    mime_type = mimetypes.guess_type(path.name)[0] or ""
    if mime_type.startswith("image/"):
        return "photo"
    if path.suffix.lower() in VIDEO_EXTENSIONS:
        return "video"
    return "document"


def validate_size(path: Path, media_type: str) -> None:
    size = path.stat().st_size
    limit = media_limit_bytes(media_type)
    if size > limit:
        raise RuntimeError(f"Downloaded {media_type} is too large after processing: {size} bytes, limit {limit} bytes.")


def media_limit_bytes(media_type: str) -> int:
    photo_limit = int(float(os.getenv("MAX_PHOTO_MB", "9")) * 1024 * 1024)
    file_limit = int(float(os.getenv("MAX_FILE_MB", "49")) * 1024 * 1024)
    return photo_limit if media_type == "photo" else file_limit


def prepare_media_for_telegram(path: Path, media_type: str) -> Path:
    if media_type == "video":
        normalized = normalize_video_container(path)
        if normalized.stat().st_size <= media_limit_bytes("video"):
            return normalized
        return transcode_video_to_limit(normalized)
    if media_type == "photo":
        if path.stat().st_size <= media_limit_bytes("photo"):
            return path
        return recompress_photo_to_limit(path)
    return path


def transcode_video_to_limit(path: Path) -> Path:
    return transcode_video(path, media_limit_bytes("video"), reason="size_limit")


def transcode_video(path: Path, limit: int, reason: str) -> Path:
    if shutil.which("ffmpeg") is None:
        return path
    policy = video_output_profile()
    base_crf = int(policy["crf"])
    max_side = int(policy["maxSide"])
    max_fps = int(policy.get("maxFps", 30))
    attempts = [(base_crf, max_side), (base_crf + 2, min(max_side, 1600)), (base_crf + 4, min(max_side, 1280)), (base_crf + 6, min(max_side, 1080)), (base_crf + 8, min(max_side, 960)), (base_crf + 10, min(max_side, 854))]
    best = path
    for crf, max_side in attempts:
        target = WORK_DIR / f"prepared_{reason}_crf{crf}_{max_side}_{path.stem}.mp4"
        vf_parts = [
            (
                "scale='if(gt(iw,ih),min({max_side},iw),-2)':"
                "'if(gt(iw,ih),-2,min({max_side},ih))'"
            ).format(max_side=max_side),
            "setsar=1"
        ]
        if reason == "telegram_safe":
            vf_parts.append(f"fps={max_fps}")
        vf_parts.append("format=yuv420p")
        vf = ",".join(vf_parts)
        run([
            "ffmpeg", "-y", "-i", str(path),
            "-map", "0:v:0", "-map", "0:a?",
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf),
            "-c:a", "aac", "-b:a", str(video_output_profile()["audioBitrate"]),
            "-movflags", "+faststart", str(target)
        ], allow_fail=True)
        if target.exists() and target.stat().st_size > 0:
            best = target
            if target.stat().st_size <= limit:
                return target
    return best


def recompress_photo_to_limit(path: Path) -> Path:
    if shutil.which("ffmpeg") is None:
        return path
    target = WORK_DIR / f"compressed_photo_{path.stem}.jpg"
    run(["ffmpeg", "-y", "-i", str(path), "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'", "-q:v", "5", str(target)], allow_fail=True)
    return target if target.exists() and target.stat().st_size > 0 else path


def generate_thumbnail(video_path: Path) -> Path | None:
    if shutil.which("ffmpeg") is None:
        return None
    thumb = WORK_DIR / f"thumb_{video_path.stem}.jpg"
    for quality in [4, 7, 10, 14, 18, 24, 30]:
        run(["ffmpeg", "-y", "-ss", "00:00:01", "-i", str(video_path), "-vframes", "1", "-vf", "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))',setsar=1", "-q:v", str(quality), str(thumb)], allow_fail=True)
        if thumb.exists() and 0 < thumb.stat().st_size <= 200 * 1024:
            return thumb
    return None


def upload_to_telegram(path: Path, media_type: str, thumbnail_path: Path | None, source_url: str, metadata: dict[str, Any]) -> dict[str, Any]:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_MEDIA_CACHE_CHAT_ID"]
    thread_id = os.getenv("TELEGRAM_MEDIA_CACHE_THREAD_ID")
    method = "sendPhoto" if media_type == "photo" else "sendVideo" if media_type == "video" else "sendDocument"
    field_name = "photo" if media_type == "photo" else "video" if media_type == "video" else "document"
    data: dict[str, Any] = {"chat_id": chat_id, "disable_notification": "true"}
    if thread_id:
        data["message_thread_id"] = thread_id
    if media_type == "video":
        width, height, duration = media_dimensions_and_duration(metadata)
        data["supports_streaming"] = "true"
        if width:
            data["width"] = str(width)
        if height:
            data["height"] = str(height)
        if duration:
            data["duration"] = str(int(round(duration)))
    files: dict[str, Any] = {field_name: (path.name, path.open("rb"), mimetypes.guess_type(path.name)[0] or "application/octet-stream")}
    if thumbnail_path is not None and media_type == "video":
        files["thumbnail"] = (thumbnail_path.name, thumbnail_path.open("rb"), "image/jpeg")
    try:
        response = requests.post(f"https://api.telegram.org/bot{token}/{method}", data=data, files=files, timeout=(20, 240))
        payload = response.json()
    finally:
        for handle_tuple in files.values():
            handle_tuple[1].close()
    if not response.ok or payload.get("ok") is not True:
        raise RuntimeError("Telegram staging upload failed.")
    message = payload.get("result") or {}
    telegram_media = message.get("photo")[-1] if media_type == "photo" and message.get("photo") else message.get("video") if media_type == "video" else message.get("document")
    if not isinstance(telegram_media, dict) or not telegram_media.get("file_id"):
        raise RuntimeError("Telegram upload response did not include a reusable file_id.")
    width, height, duration = media_dimensions_and_duration(metadata)
    return {
        "kind": media_type,
        "telegramFileType": media_type if media_type != "photo" else "photo",
        "telegramFileId": telegram_media.get("file_id"),
        "telegramFileUniqueId": telegram_media.get("file_unique_id"),
        "telegramMimeType": telegram_media.get("mime_type") or mimetypes.guess_type(path.name)[0],
        "telegramFileSize": telegram_media.get("file_size") or path.stat().st_size,
        "sizeBytes": path.stat().st_size,
        "mimeType": telegram_media.get("mime_type") or mimetypes.guess_type(path.name)[0],
        "width": telegram_media.get("width") or width,
        "height": telegram_media.get("height") or height,
        "durationSeconds": telegram_media.get("duration") or duration,
        "sourceUrl": source_url
    }


def asset_diagnostics(original_path: Path, prepared_path: Path, original_metadata: dict[str, Any], prepared_metadata: dict[str, Any], telegram_payload: dict[str, Any], prepare_ms: int, upload_ms: int) -> dict[str, Any]:
    original_width, original_height, _ = media_dimensions_and_duration(original_metadata)
    prepared_width, prepared_height, _ = media_dimensions_and_duration(prepared_metadata)
    telegram_width = to_int(telegram_payload.get("width"))
    telegram_height = to_int(telegram_payload.get("height"))
    original_ratio = aspect_ratio(original_width, original_height)
    prepared_ratio = aspect_ratio(prepared_width, prepared_height)
    telegram_ratio = aspect_ratio(telegram_width, telegram_height)
    aspect_drift = ratio_drift(original_ratio, telegram_ratio or prepared_ratio)
    original_video = video_stream(original_metadata)
    prepared_video = video_stream(prepared_metadata)
    return {
        "originalWidth": original_width,
        "originalHeight": original_height,
        "preparedWidth": prepared_width,
        "preparedHeight": prepared_height,
        "telegramWidth": telegram_width,
        "telegramHeight": telegram_height,
        "originalAspectRatio": original_ratio,
        "preparedAspectRatio": prepared_ratio,
        "telegramAspectRatio": telegram_ratio,
        "aspectDrift": aspect_drift,
        "originalVideoCodec": original_video.get("codec_name"),
        "originalVideoProfile": original_video.get("profile"),
        "originalPixelFormat": original_video.get("pix_fmt"),
        "originalFrameRate": video_fps(original_video),
        "preparedVideoCodec": prepared_video.get("codec_name"),
        "preparedVideoProfile": prepared_video.get("profile"),
        "preparedPixelFormat": prepared_video.get("pix_fmt"),
        "preparedFrameRate": video_fps(prepared_video),
        "telegramSafeVideoTranscodeRequired": needs_video_reencode_for_telegram(original_metadata),
        "transcoded": prepared_path.name.startswith("prepared_"),
        "remuxed": prepared_path.name.startswith("faststart_") or (prepared_path.suffix.lower() == ".mp4" and original_path.resolve() != prepared_path.resolve()),
        "rotationApplied": needs_video_reencode_for_display(original_metadata),
        "warnings": aspect_warnings(aspect_drift),
        "timings": {"prepareMs": prepare_ms, "telegramUploadMs": upload_ms},
        "videoOutputPolicy": video_output_profile()
    }


def aspect_ratio(width: int | None, height: int | None) -> float | None:
    if width is None or height is None or height <= 0:
        return None
    return round(width / height, 6)


def ratio_drift(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    return round(abs(left - right), 6)


def aspect_warnings(drift: float | None) -> list[str]:
    if drift is not None and drift > float(os.getenv("MEDIA_ASPECT_DRIFT_THRESHOLD", "0.02")):
        return [f"aspect_drift:{drift}"]
    return []


def github_run_metadata() -> dict[str, Any]:
    repository = os.getenv("GITHUB_REPOSITORY", "").strip()
    run_id = os.getenv("GITHUB_RUN_ID", "").strip()
    return {
        **({"githubRunId": run_id} if run_id else {}),
        **({"githubRunUrl": f"https://github.com/{repository}/actions/runs/{run_id}"} if repository and run_id else {}),
        **({"githubRepository": repository} if repository else {})
    }


def elapsed_ms(started_at: float) -> int:
    return max(0, int(round((time.perf_counter() - started_at) * 1000)))


def iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def media_dimensions_and_duration(metadata: dict[str, Any]) -> tuple[int | None, int | None, float | None]:
    stream = video_stream(metadata)
    width = to_int(stream.get("width"))
    height = to_int(stream.get("height"))
    duration = to_float(stream.get("duration"))
    if duration is None:
        format_info = metadata.get("format")
        if isinstance(format_info, dict):
            duration = to_float(format_info.get("duration"))
    return width, height, duration


def to_int(value: Any) -> int | None:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def to_float(value: Any) -> float | None:
    try:
        parsed = float(value)
        return parsed if parsed > 0 else None
    except Exception:
        return None


def callback(callback_url: str, payload: dict[str, Any]) -> None:
    response = requests.post(callback_url, json=payload, headers={"x-internal-api-secret": os.environ["WORKER_INTERNAL_API_SECRET"]}, timeout=(20, 90))
    if not response.ok:
        raise RuntimeError(f"Worker callback failed with HTTP {response.status_code}.")


def run(command: list[str], allow_fail: bool = False) -> None:
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if completed.returncode != 0 and not allow_fail:
        raise RuntimeError(completed.stderr[-500:] or f"Command failed: {' '.join(command)}")


def safe_error(value: str) -> str:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if token:
        value = value.replace(token, "[redacted-token]")
    return value[:500]


def stable_hash(value: str) -> str:
    hash_value = 5381
    for character in value:
        hash_value = ((hash_value << 5) + hash_value) ^ ord(character)
    return f"{hash_value & 0xFFFFFFFF:08x}"


if __name__ == "__main__":
    raise SystemExit(main())
