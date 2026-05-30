#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SAFE_VARS = {
  ENVIRONMENT: "production",
  LOG_LEVEL: "info",
  PROVIDERS_MODE: "mock",
  SCHEDULER_ENABLED: "false",
  SCHEDULER_DRY_RUN: "true",
  SCHEDULER_ALLOW_REAL_PROVIDERS: "false",
  SCHEDULER_ALLOW_PUBLISHING: "false",
  SCHEDULER_MAX_SOURCES_PER_RUN: "1",
  SCHEDULER_MAX_ITEMS_PER_RUN: "2",
  MAX_AI_ITEMS_PER_RUN: "0",
  MAX_PROVIDER_ITEMS_PER_RUN: "5",
  MAX_PUBLISH_ITEMS_PER_RUN: "0",
  TELEGRAM_REAL_REVIEW_ENABLED: "false",
  WORDPRESS_REAL_DRY_RUN_ENABLED: "false",
  WORDPRESS_DEFAULT_STATUS: "draft"
};
const SECRET_KEYS = new Set(["INTERNAL_API_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "WORDPRESS_APPLICATION_PASSWORD", "FIRECRAWL_API_KEY", "APIFY_TOKEN", "GETXAPI_KEY", "AI_API_KEY", "CLOUDFLARE_API_TOKEN"]);
const rl = createInterface({ input, output });
const root = process.cwd();
const wranglerPath = join(root, "wrangler.toml");
const report = { deployed: "no", health: "fail", ready: "not checked", auth: "not checked", scheduler: "unknown", publishing: "unknown", telegram: "unknown", wordpress: "unknown" };

function heading(text) { console.log(`\n${text}\n${"-".repeat(text.length)}`); }
function toml(value) { return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }
function parseToml(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}
function verifyRoot() {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath) || !existsSync(wranglerPath)) throw new Error("Run this from the repository root, where package.json and wrangler.toml exist.");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  if (pkg.name !== "ai-curation-publisher-agent") throw new Error("This does not look like the ai-curation-publisher-agent repository root.");
}
function varsBlock(lines) {
  const start = lines.findIndex((line) => line.trim() === "[vars]");
  if (start < 0) return { start: -1, end: -1 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^\[.*\]$/.test(lines[i].trim())) { end = i; break; }
  return { start, end };
}
function readVars(content) {
  const lines = content.split(/\r?\n/);
  const block = varsBlock(lines);
  const vars = new Map();
  if (block.start < 0) return vars;
  for (const line of lines.slice(block.start + 1, block.end)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) continue;
    const parsed = parseToml(match[2]);
    if (parsed !== null) vars.set(match[1], parsed);
  }
  return vars;
}
function writeSafeVars(content) {
  const lines = content.split(/\r?\n/);
  const block = varsBlock(lines);
  const merged = readVars(content);
  for (const [key, value] of Object.entries(SAFE_VARS)) {
    if (SECRET_KEYS.has(key)) throw new Error(`Refusing to write secret ${key} to wrangler.toml.`);
    merged.set(key, value);
  }
  const rendered = ["[vars]", ...Array.from(merged, ([key, value]) => `${key} = ${toml(value)}`)];
  if (block.start < 0) return [...rendered, "", ...lines].join("\n");
  return [...lines.slice(0, block.start), ...rendered, ...lines.slice(block.end)].join("\n");
}
async function ask(text, fallback = "") {
  const answer = (await rl.question(`${text}${fallback ? ` (${fallback})` : ""}: `)).trim();
  return answer || fallback;
}
async function yes(text, defaultYes = true) {
  const answer = (await rl.question(`${text} [${defaultYes ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
  return answer ? ["y", "yes"].includes(answer) : defaultYes;
}
function pnpm() { return process.platform === "win32" ? "pnpm.cmd" : "pnpm"; }
function run(args, stdin = "") {
  return new Promise((resolve) => {
    const child = spawn(pnpm(), args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let all = "";
    child.stdout.on("data", (chunk) => { all += String(chunk); process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { all += String(chunk); process.stderr.write(chunk); });
    child.on("error", (error) => resolve({ ok: false, text: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, text: all }));
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}
async function putSecret(secret) {
  heading("INTERNAL_API_SECRET");
  console.log("Generated secret. It is shown once. Save it securely now. Do not commit it or paste it into chat.");
  console.log(`\nINTERNAL_API_SECRET=${secret}\n`);
  if (!await yes("Run `pnpm wrangler secret put INTERNAL_API_SECRET` now?", true)) {
    console.log("Manual command: pnpm wrangler secret put INTERNAL_API_SECRET");
    return;
  }
  const result = await run(["wrangler", "secret", "put", "INTERNAL_API_SECRET"], `${secret}\n`);
  if (!result.ok) console.log("Automatic secret upload failed. Run manually: pnpm wrangler secret put INTERNAL_API_SECRET");
}
async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}
function infer(statusBody, readyBody) {
  const text = JSON.stringify({ statusBody, readyBody }).toLowerCase();
  report.scheduler = text.includes('"schedulerenabled":true') ? "enabled" : text.includes('"schedulerenabled":false') || text.includes('"scheduler_enabled":"false"') ? "disabled" : report.scheduler;
  report.publishing = text.includes('"publishingallowed":true') ? "enabled" : text.includes('"publishingallowed":false') || text.includes('"scheduler_allow_publishing":"false"') ? "disabled" : report.publishing;
  const summary = readyBody?.summary ?? {};
  report.telegram = summary.hasTelegramConfig === false || text.includes("telegram runtime configuration is incomplete") ? "yes" : summary.hasTelegramConfig === true ? "no" : report.telegram;
  report.wordpress = summary.hasWordPressConfig === false ? "yes" : summary.hasWordPressConfig === true ? "no" : report.wordpress;
}
async function checks(baseUrl, secret) {
  heading("Safe Worker checks");
  const base = baseUrl.replace(/\/+$/, "");
  const health = await requestJson(`${base}/health`); console.log(`GET /health -> ${health.status || "failed"}`); report.health = health.ok ? "ok" : "fail";
  const status = await requestJson(`${base}/status`); console.log(`GET /status -> ${status.status || "failed"}`);
  const ready = await requestJson(`${base}/ready`); console.log(`GET /ready -> ${ready.status || "failed"}`); report.ready = ready.ok ? "ok" : ready.status === 503 ? "warning" : "fail";
  infer(status.body, ready.body);
  if (secret) {
    const without = await requestJson(`${base}/internal/e2e/mock-pipeline`, { method: "POST" });
    const withSecret = await requestJson(`${base}/internal/e2e/mock-pipeline`, { method: "POST", headers: { "x-internal-api-secret": secret } });
    console.log(`POST /internal/e2e/mock-pipeline without secret -> ${without.status || "failed"}`);
    console.log(`POST /internal/e2e/mock-pipeline with secret -> ${withSecret.status || "failed"}`);
    report.auth = without.status === 401 && withSecret.status === 200 ? "ok" : "fail";
  }
}
async function main() {
  heading("Cloudflare setup bootstrap");
  verifyRoot();
  const before = readFileSync(wranglerPath, "utf8");
  const diff = Object.entries(SAFE_VARS).filter(([key, value]) => readVars(before).get(key) !== value);
  if (diff.length) {
    console.log("wrangler.toml needs these safe non-secret production vars:");
    for (const [key, value] of diff) console.log(`- ${key} = ${toml(value)}`);
    if (await yes("Update wrangler.toml now?", true)) { writeFileSync(wranglerPath, writeSafeVars(before)); console.log("wrangler.toml updated. No secrets were written."); }
  } else console.log("wrangler.toml already has the required safe production vars.");
  const secret = process.env.INTERNAL_API_SECRET || randomBytes(32).toString("hex");
  if (process.env.INTERNAL_API_SECRET) console.log("Using INTERNAL_API_SECRET from environment. It will not be printed."); else await putSecret(secret);
  if (await yes("Run `pnpm worker:deploy` now?", false)) {
    const deployed = await run(["worker:deploy"]);
    report.deployed = deployed.ok ? "yes" : "no";
  }
  const baseUrl = process.env.WORKER_BASE_URL || await ask("Enter WORKER_BASE_URL for checks, or leave blank to skip", "");
  if (baseUrl) await checks(baseUrl, secret); else console.log("Skipping Worker checks because WORKER_BASE_URL was not provided.");
  heading("Final setup report");
  console.log(`Worker deployed: ${report.deployed}`);
  console.log(`Health: ${report.health}`);
  console.log(`Ready: ${report.ready}`);
  console.log(`Internal auth: ${report.auth}`);
  console.log(`Scheduler: ${report.scheduler}`);
  console.log(`Publishing: ${report.publishing}`);
  console.log(`Missing Telegram config: ${report.telegram}`);
  console.log(`Missing WordPress config: ${report.wordpress}`);
  console.log("Dashboard next step: deploy the dashboard after Worker readiness passes, then protect it with Cloudflare Access or equivalent.");
}
main().catch((error) => { console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }).finally(() => rl.close());
