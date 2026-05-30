#!/usr/bin/env python3
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib import request, parse

MAX_DIRECT_BYTES = 200 * 1024 * 1024


def env(name, default=""):
    return os.environ.get(name, default).strip()


def run(cmd, check=True):
    return subprocess.run(cmd, text=True, capture_output=True, check=check)


def callback(status, **extra):
    callback_url = env("CALLBACK_URL")
    secret = env("INTERNAL_API_SECRET")
    payload = {
        "jobId": env("JOB_ID"),
        "mediaAssetId": env("MEDIA_ASSET_ID"),
        "itemId": env("ITEM_ID"),
        "status": status,
        **extra,
    }
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(callback_url, data=data, method="POST", headers={
        "content-type": "application/json",
        "x-internal-api-secret": secret,
        "user-agent": "ai-curation-publisher-agent-media-processor",
    })
    with request.urlopen(req, timeout=30) as response:
        print(response.read().decode("utf-8", "replace"))


def fail(message):
    safe = str(message).replace(env("TELEGRAM_BOT_TOKEN"), "[redacted-token]")[:500]
    callback("failed", errorMessage=safe, result={"processor": "github_actions"})
    print(safe, file=sys.stderr)
    sys.exit(1)


def download(source_url, out_dir):
    output_template = str(out_dir / "source.%(ext)s")
    try:
        result = run(["yt-dlp", "--max-filesize", "200M", "--concurrent-fragments", env("YTDLP_CONCURRENT_FRAGMENTS", "8"), "--merge-output-format", "mp4", "-f", "best[ext=mp4][vcodec!=none]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best", "-o", output_template, source_url], check=False)
        if result.returncode == 0:
            files = [p for p in out_dir.iterdir() if p.is_file() and p.name.startswith("source.")]
            if files:
                return max(files, key=lambda p: p.stat().st_size)
    except FileNotFoundError:
        pass

    # Direct HTTP fallback for image/video URLs.
    parsed = parse.urlparse(source_url)
    suffix = Path(parsed.path).suffix or ".bin"
    target = out_dir / f"source{suffix}"
    req = request.Request(source_url, headers={"user-agent": "ai-curation-publisher-agent-media-processor"})
    with request.urlopen(req, timeout=60) as response:
        size = int(response.headers.get("content-length") or "0")
        if size > MAX_DIRECT_BYTES:
            raise RuntimeError("Source file is larger than the safe direct download limit.")
        target.write_bytes(response.read(MAX_DIRECT_BYTES + 1))
    return target


def probe(path):
    result = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)], check=False)
    if result.returncode != 0:
        return {}
    try:
        return json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {}


def media_kind(path, metadata):
    mime, _ = mimetypes.guess_type(path.name)
    streams = metadata.get("streams") or []
    has_video = any(stream.get("codec_type") == "video" for stream in streams)
    if mime and mime.startswith("image/") and not has_video:
        return "photo"
    if has_video:
        return "video"
    return "document"


def first_video_stream(metadata):
    for stream in metadata.get("streams") or []:
        if stream.get("codec_type") == "video":
            return stream
    return {}


def compress_if_needed(path, kind, max_photo_mb, max_file_mb, out_dir):
    limit = int((max_photo_mb if kind == "photo" else max_file_mb) * 1024 * 1024)
    if path.stat().st_size <= limit:
        return path
    if kind == "photo":
        target = out_dir / "prepared.jpg"
        run(["ffmpeg", "-y", "-i", str(path), "-vf", "scale='min(1920,iw)':-2", "-q:v", "4", str(target)])
    elif kind == "video":
        target = out_dir / "prepared.mp4"
        run(["ffmpeg", "-y", "-i", str(path), "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',setsar=1,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-b:v", "1300k", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(target)])
    else:
        return path
    if target.stat().st_size > limit:
        raise RuntimeError(f"Prepared {kind} is still too large for Telegram safe limit.")
    return target


def make_thumbnail(path, out_dir):
    target = out_dir / "thumbnail.jpg"
    result = run(["ffmpeg", "-y", "-ss", "00:00:01", "-i", str(path), "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))',setsar=1", "-q:v", "5", str(target)], check=False)
    return target if result.returncode == 0 and target.exists() and target.stat().st_size > 0 else None


def upload_to_telegram(path, kind, thumb=None):
    token = env("TELEGRAM_BOT_TOKEN")
    chat_id = env("TELEGRAM_STAGING_CHAT_ID")
    thread_id = env("TELEGRAM_STAGING_THREAD_ID")
    if not token or not chat_id:
        raise RuntimeError("TELEGRAM_BOT_TOKEN or telegram staging chat id is missing.")
    if kind == "photo":
        method, field = "sendPhoto", "photo"
    elif kind == "video":
        method, field = "sendVideo", "video"
    else:
        method, field = "sendDocument", "document"
    cmd = ["curl", "-sS", "-X", "POST", f"https://api.telegram.org/bot{token}/{method}", "-F", f"chat_id={chat_id}", "-F", f"{field}=@{path}"]
    if thread_id:
        cmd.extend(["-F", f"message_thread_id={thread_id}"])
    if kind == "video":
        cmd.extend(["-F", "supports_streaming=true"])
    if thumb and kind == "video":
        cmd.extend(["-F", f"thumbnail=@{thumb}"])
    cmd.extend(["-F", "caption=media cache upload for curator workflow"])
    result = run(cmd, check=False)
    if result.returncode != 0:
        raise RuntimeError("Telegram upload request failed before receiving a response.")
    payload = json.loads(result.stdout or "{}")
    if payload.get("ok") is not True:
        raise RuntimeError("Telegram upload returned an API error.")
    message = payload.get("result") or {}
    if kind == "photo":
        photos = message.get("photo") or []
        media = photos[-1] if photos else {}
        file_type = "photo"
    elif kind == "video":
        media = message.get("video") or {}
        file_type = "video"
    else:
        media = message.get("document") or {}
        file_type = "document"
    if not media.get("file_id"):
        raise RuntimeError("Telegram upload did not return a file_id.")
    return media, file_type


def main():
    try:
        max_photo_mb = float(env("MAX_PHOTO_MB", "9"))
        max_file_mb = float(env("MAX_FILE_MB", "49"))
        source_url = env("SOURCE_URL")
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            downloaded = download(source_url, out_dir)
            metadata = probe(downloaded)
            kind = media_kind(downloaded, metadata)
            prepared = compress_if_needed(downloaded, kind, max_photo_mb, max_file_mb, out_dir)
            prepared_metadata = probe(prepared)
            video = first_video_stream(prepared_metadata)
            thumb = make_thumbnail(prepared, out_dir) if kind == "video" else None
            media, file_type = upload_to_telegram(prepared, kind, thumb)
            asset = {
                "telegramFileId": media.get("file_id"),
                "telegramFileUniqueId": media.get("file_unique_id"),
                "telegramFileType": file_type,
                "telegramMimeType": media.get("mime_type") or mimetypes.guess_type(prepared.name)[0],
                "telegramFileSize": media.get("file_size") or prepared.stat().st_size,
                "sizeBytes": media.get("file_size") or prepared.stat().st_size,
                "mimeType": media.get("mime_type") or mimetypes.guess_type(prepared.name)[0],
                "width": media.get("width") or video.get("width"),
                "height": media.get("height") or video.get("height"),
                "durationSeconds": media.get("duration") or safe_float((prepared_metadata.get("format") or {}).get("duration")),
            }
            callback("ready", **asset, result={"processor": "github_actions", "sourceUrl": source_url, "preparedBytes": prepared.stat().st_size})
    except Exception as exc:
        fail(str(exc))


def safe_float(value):
    try:
        return float(value)
    except Exception:
        return None


if __name__ == "__main__":
    main()
