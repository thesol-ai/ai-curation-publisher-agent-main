#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = createInterface({ input, output });
const summary = { reachable: "no", environment: "unknown", ready: "fail", secret: "not provided", auth: "not checked", scheduler: "unknown", publishing: "unknown", missing: new Set(), next: "Fix failed checks, then run this command again." };
function heading(text) { console.log(`\n${text}\n${"-".repeat(text.length)}`); }
async function ask(text, fallback = "") { const answer = (await rl.question(`${text}${fallback ? ` (${fallback})` : ""}: `)).trim(); return answer || fallback; }
async function yes(text) { return ["y", "yes"].includes((await rl.question(`${text} [y/N]: `)).trim().toLowerCase()); }
async function secretPrompt() {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.platform === "win32") {
    console.log("Hidden secret input is not available in this terminal. Set INTERNAL_API_SECRET in the environment instead.");
    return "";
  }
  process.stdout.write("Enter INTERNAL_API_SECRET: ");
  try { execFileSync("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] }); return (await rl.question("")).trim(); }
  finally { execFileSync("stty", ["echo"], { stdio: ["inherit", "ignore", "ignore"] }); process.stdout.write("\n"); }
}
async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { ok: response.ok, status: response.status, body };
  } catch (error) { return { ok: false, status: 0, body: { error: error instanceof Error ? error.message : String(error) } }; }
}
function inspect(statusBody, readyBody) {
  const text = JSON.stringify({ statusBody, readyBody }).toLowerCase();
  const readySummary = readyBody?.summary ?? {};
  summary.environment = String(readySummary.environment ?? statusBody?.environment ?? "unknown");
  summary.ready = readyBody?.ready === true || readyBody?.ok === true ? "ok" : readyBody?.ok === false ? "warning/fail" : summary.ready;
  summary.secret = readySummary.hasInternalSecret === true ? "yes" : readySummary.hasInternalSecret === false ? "no" : summary.secret;
  summary.scheduler = text.includes('"schedulerenabled":true') ? "unsafe: enabled" : text.includes('"schedulerenabled":false') || text.includes('"scheduler_enabled":"false"') ? "safe: disabled" : summary.scheduler;
  summary.publishing = text.includes('"publishingallowed":true') ? "unsafe: enabled" : text.includes('"publishingallowed":false') || text.includes('"scheduler_allow_publishing":"false"') ? "safe: disabled" : summary.publishing;
  if (readySummary.hasTelegramConfig === false || text.includes("telegram runtime configuration is incomplete")) summary.missing.add("Telegram review configuration");
  if (readySummary.hasWordPressConfig === false || text.includes("wordpress_application_password is not configured")) summary.missing.add("WordPress draft configuration");
}
function chooseNext() {
  if (summary.reachable !== "yes") summary.next = "Deploy or fix WORKER_BASE_URL, then run `pnpm check:production` again.";
  else if (summary.auth.startsWith("fail")) summary.next = "Configure INTERNAL_API_SECRET as a Cloudflare Worker Secret before using internal routes.";
  else if (summary.ready !== "ok") summary.next = "Review `/ready` warnings, configure only the optional pilot integrations you need, then recheck.";
  else summary.next = "Worker readiness looks safe. Deploy and protect the operator dashboard next.";
}
async function main() {
  heading("Production readiness checker");
  const baseUrl = (process.env.WORKER_BASE_URL || await ask("Enter WORKER_BASE_URL")).replace(/\/+$/, "");
  if (!baseUrl) throw new Error("WORKER_BASE_URL is required.");
  let secret = process.env.INTERNAL_API_SECRET || "";
  if (secret) console.log("Using INTERNAL_API_SECRET from environment. The value will not be printed.");
  else if (await yes("Do you want to enter INTERNAL_API_SECRET for authenticated checks?")) secret = await secretPrompt();
  heading("Safe production checks");
  const health = await requestJson(`${baseUrl}/health`); console.log(`GET /health -> ${health.status || "failed"}`); summary.reachable = health.ok ? "yes" : "no";
  const status = await requestJson(`${baseUrl}/status`); console.log(`GET /status -> ${status.status || "failed"}`);
  const ready = await requestJson(`${baseUrl}/ready`); console.log(`GET /ready -> ${ready.status || "failed"}`); inspect(status.body, ready.body);
  const without = await requestJson(`${baseUrl}/internal/e2e/mock-pipeline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  console.log(`POST /internal/e2e/mock-pipeline without secret -> ${without.status || "failed"}`);
  summary.auth = without.status === 401 ? "ok: internal routes reject missing secret" : without.status === 200 ? "fail: internal route allowed request without secret" : `warning: unexpected ${without.status || "network failure"}`;
  if (secret) {
    summary.secret = "provided for this check";
    const withSecret = await requestJson(`${baseUrl}/internal/e2e/mock-pipeline`, { method: "POST", headers: { "content-type": "application/json", "x-internal-api-secret": secret }, body: JSON.stringify({}) });
    console.log(`POST /internal/e2e/mock-pipeline with secret -> ${withSecret.status || "failed"}`);
    if (without.status === 401 && withSecret.status === 200) summary.auth = "ok: protected and valid secret works";
    const pilot = await requestJson(`${baseUrl}/internal/pilot/real-integrations`, { method: "POST", headers: { "content-type": "application/json", "x-internal-api-secret": secret }, body: JSON.stringify({}) });
    console.log(`POST /internal/pilot/real-integrations with empty body -> ${pilot.status || "failed"}`);
  }
  chooseNext();
  heading("Plain-English summary");
  console.log(`Worker reachable: ${summary.reachable}`);
  console.log(`Environment: ${summary.environment}`);
  console.log(`Ready status: ${summary.ready}`);
  console.log(`Internal secret configured: ${summary.secret}`);
  console.log(`Auth protection result: ${summary.auth}`);
  console.log(`Scheduler safety: ${summary.scheduler}`);
  console.log(`Publishing safety: ${summary.publishing}`);
  console.log(`Missing integrations: ${summary.missing.size ? Array.from(summary.missing).join(", ") : "none detected"}`);
  console.log(`Recommended next action: ${summary.next}`);
}
main().catch((error) => { console.error(`\nReadiness check failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }).finally(() => rl.close());
