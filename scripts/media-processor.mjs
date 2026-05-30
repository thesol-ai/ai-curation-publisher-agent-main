#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const workDir = resolve(".media-work");
mkdirSync(workDir, { recursive: true });

const jobId = requiredEnv("MEDIA_JOB_ID");
const itemId = requiredEnv("MEDIA_ITEM_ID");
const mediaAssetId = requiredEnv("MEDIA_ASSET_ID");
const sourceUrl = requiredEnv("MEDIA_SOURCE_URL");
const requestedKind = process.env.MEDIA_KIND || "video";
const callbackUrl = requiredEnv("MEDIA_CALLBACK_URL");
const callbackSecret = process.env.WORKER_INTERNAL_API_SECRET || "";
const telegramBotToken = requiredEnv("TELEGRAM_BOT_TOKEN");
const stagingChatId = requiredEnv("TELEGRAM_STAGING_CHAT_ID");
const stagingThreadId = process.env.TELEGRAM_STAGING_THREAD_ID || "";
const maxPhotoBytes = readMegabytes(process.env.MAX_PHOTO_MB, 9);
const maxFileBytes = readMegabytes(process.env.MAX_FILE_MB, 49);

await callback({ jobId, mediaAssetId, status: "processing", result: { sourceUrl, requestedKind } }).catch(() => undefined);

try {
  const downloaded = downloadMedia(sourceUrl);
  const mediaFiles = selectMediaFiles(downloaded, requestedKind);
  if (mediaFiles.length === 0) throw new Error("No downloadable media was found.");

  const filePath = mediaFiles[0];
  const kind = classifyFile(filePath);
  const size = statSync(filePath).size;
  const limit = kind === "photo" ? maxPhotoBytes : maxFileBytes;
  if (size <= 0) throw new Error(`${basename(filePath)} is empty.`);
  if (size > limit) throw new Error(`${basename(filePath)} exceeds safe Telegram limit (${formatMb(limit)} MB).`);
  const thumbnailPath = kind === "video" ? ensureThumbnail(filePath) : undefined;
  const uploaded = await uploadToTelegram({ filePath, kind, thumbnailPath });

  const payload = {
    jobId,
    mediaAssetId,
    status: "ready",
    kind: uploaded.kind,
    telegramFileId: uploaded.telegramFileId,
    telegramFileUniqueId: uploaded.telegramFileUniqueId,
    telegramFileType: uploaded.telegramFileType,
    telegramMimeType: uploaded.mimeType,
    telegramFileSize: uploaded.sizeBytes,
    sizeBytes: uploaded.sizeBytes,
    mimeType: uploaded.mimeType,
    width: uploaded.width,
    height: uploaded.height,
    durationSeconds: uploaded.durationSeconds,
    result: { itemId, sourceUrl, fileName: uploaded.fileName, thumbnailCreated: Boolean(thumbnailPath) }
  };
  writeFileSync(join(workDir, "output.json"), JSON.stringify(payload, null, 2));
  await callback(payload);
} catch (error) {
  const message = error instanceof Error ? error.message : "Media processor failed.";
  const payload = { jobId, mediaAssetId, status: "failed", errorMessage: redact(message), result: { itemId, sourceUrl } };
  writeFileSync(join(workDir, "output.json"), JSON.stringify(payload, null, 2));
  await callback(payload).catch(() => undefined);
  throw error;
}

function downloadMedia(url) {
  const outTemplate = join(workDir, "media.%(id)s.%(ext)s");
  const args = [
    "--no-warnings",
    "--concurrent-fragments", process.env.YTDLP_CONCURRENT_FRAGMENTS || "8",
    "--newline",
    "--max-filesize", `${Math.floor(maxFileBytes / (1024 * 1024))}M`,
    "--write-thumbnail",
    "--convert-thumbnails", "jpg",
    "--merge-output-format", "mp4",
    "-f", `best[ext=mp4][vcodec!=none][filesize<=${maxFileBytes}]/best[ext=mp4][vcodec!=none][filesize_approx<=${maxFileBytes}]/b[ext=mp4][filesize<=${maxFileBytes}]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best`,
    "-o", outTemplate,
    url
  ];
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  if (cookiesFile && existsSync(cookiesFile)) args.splice(args.length - 1, 0, "--cookies", cookiesFile);
  const result = spawnSync("yt-dlp", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`yt-dlp failed with exit code ${result.status ?? "unknown"}.`);
  return readdirSync(workDir).map((name) => join(workDir, name));
}

function selectMediaFiles(paths, preferredKind) {
  const files = paths
    .filter((path) => existsSync(path) && statSync(path).isFile())
    .filter((path) => /\.(mp4|m4v|mov|webm|jpg|jpeg|png|webp)$/i.test(path))
    .filter((path) => !/-telegram-thumb\.jpg$/i.test(path));
  const preferred = files.filter((path) => preferredKind === "image" ? classifyFile(path) === "photo" : classifyFile(path) !== "photo");
  return (preferred.length > 0 ? preferred : files).sort((a, b) => statSync(b).size - statSync(a).size);
}

function classifyFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return "photo";
  if ([".mp4", ".m4v", ".mov", ".webm"].includes(ext)) return "video";
  return "document";
}

function ensureThumbnail(videoPath) {
  const thumbPath = videoPath.replace(/\.[^.]+$/, "-telegram-thumb.jpg");
  const qualities = [6, 10, 14, 18, 24, 30];
  for (const quality of qualities) {
    const result = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "00:00:01", "-i", videoPath, "-frames:v", "1", "-vf", "scale='if(gt(iw,ih),min(640,iw),-2)':'if(gt(iw,ih),-2,min(640,ih))',setsar=1", "-q:v", String(quality), thumbPath], { stdio: "inherit" });
    if (result.status === 0 && existsSync(thumbPath) && statSync(thumbPath).size > 0 && statSync(thumbPath).size <= 200 * 1024) return thumbPath;
  }
  return undefined;
}

async function uploadToTelegram({ filePath, kind, thumbnailPath }) {
  const method = kind === "photo" ? "sendPhoto" : kind === "video" ? "sendVideo" : "sendDocument";
  const field = kind === "photo" ? "photo" : kind === "video" ? "video" : "document";
  const form = new FormData();
  form.append("chat_id", stagingChatId);
  if (stagingThreadId) form.append("message_thread_id", stagingThreadId);
  form.append("caption", `media staging upload for ${itemId}`);
  form.append(field, new Blob([readFileSync(filePath)], { type: mimeFor(filePath, kind) }), basename(filePath));
  if (kind === "video") form.append("supports_streaming", "true");
  if (thumbnailPath && existsSync(thumbnailPath)) {
    form.append("thumbnail", new Blob([readFileSync(thumbnailPath)], { type: "image/jpeg" }), basename(thumbnailPath));
  }
  const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true) throw new Error("Telegram staging upload failed.");
  const message = payload.result || {};
  const media = extractTelegramMediaFromMessage(message, kind);
  if (!media.fileId) throw new Error("Telegram staging upload did not return a reusable file_id.");
  return {
    kind,
    telegramFileId: media.fileId,
    telegramFileUniqueId: media.fileUniqueId,
    telegramFileType: kind === "photo" ? "photo" : kind === "video" ? "video" : "document",
    mimeType: media.mimeType || mimeFor(filePath, kind),
    sizeBytes: media.fileSize || statSync(filePath).size,
    width: media.width,
    height: media.height,
    durationSeconds: media.durationSeconds,
    fileName: basename(filePath)
  };
}

function extractTelegramMediaFromMessage(message, kind) {
  if (kind === "photo" && Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = [...message.photo].sort((a, b) => (b.file_size || b.width * b.height || 0) - (a.file_size || a.width * a.height || 0))[0];
    return { fileId: largest.file_id, fileUniqueId: largest.file_unique_id, fileSize: largest.file_size, width: largest.width, height: largest.height };
  }
  if (kind === "video" && message.video) {
    return { fileId: message.video.file_id, fileUniqueId: message.video.file_unique_id, fileSize: message.video.file_size, mimeType: message.video.mime_type, width: message.video.width, height: message.video.height, durationSeconds: message.video.duration };
  }
  if (message.document) {
    return { fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id, fileSize: message.document.file_size, mimeType: message.document.mime_type };
  }
  return {};
}

async function callback(payload) {
  const headers = { "content-type": "application/json" };
  if (callbackSecret) headers["x-internal-api-secret"] = callbackSecret;
  const response = await fetch(callbackUrl, { method: "POST", headers, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Worker callback failed with HTTP ${response.status}.`);
}

function mimeFor(filePath, kind) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (kind === "photo") return "image/jpeg";
  if (ext === ".webm") return "video/webm";
  if (kind === "video") return "video/mp4";
  return "application/octet-stream";
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || value.trim().length === 0) throw new Error(`${name} is required.`);
  return value.trim();
}

function readMegabytes(value, fallback) {
  const parsed = Number.parseFloat(value || "");
  return Math.floor((Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 1024 * 1024);
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function redact(value) {
  return String(value).replace(/[0-9]{6,}:[A-Za-z0-9_-]+/g, "[redacted-token]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
}
