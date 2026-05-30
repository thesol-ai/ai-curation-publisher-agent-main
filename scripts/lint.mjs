import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["apps", "packages", "scripts"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".toml", ".yaml", ".yml"]);
const ignoredDirectories = new Set(["node_modules", "dist", "coverage", ".turbo", ".wrangler"]);

function hasSupportedExtension(filePath) {
  return [...extensions].some((extension) => filePath.endsWith(extension));
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...await collectFiles(path));
      continue;
    }
    if (entry.isFile() && hasSupportedExtension(path)) files.push(path);
  }
  return files;
}

const files = [];
for (const root of roots) {
  try { files.push(...await collectFiles(root)); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

const failures = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  if (content.includes("\r\n")) failures.push(`${file}: contains CRLF line endings`);
  if (!content.endsWith("\n")) failures.push(`${file}: must end with a newline`);
}

if (failures.length > 0) { console.error(failures.join("\n")); process.exit(1); }
console.log(`lint passed for ${files.length} files`);
