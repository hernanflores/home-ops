#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function exists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }

export async function runCompatibilityCheck() {
  const checks = [
    ["canonical_skill", ".agents/skills/home-ops/SKILL.md"],
    ["codex_entrypoint", "CODEX.md"],
    ["claude_skill_wrapper", ".claude/skills/home-ops/SKILL.md"],
    ["opencode_router", ".opencode/commands/home-ops.md"],
    ["opencode_financing", ".opencode/commands/home-ops-financing.md"],
    ["scan_mode", "modes/scan.md"],
    ["evaluate_mode", "modes/evaluate.md"],
    ["valuation_mode", "modes/valuation.md"],
    ["financing_mode", "modes/financing.md"]
  ];
  const results = Object.fromEntries(await Promise.all(checks.map(async ([id, relative]) => [id, await exists(join(ROOT, relative)) ? "compatible" : "missing"])));
  const skill = await readFile(join(ROOT, ".agents/skills/home-ops/SKILL.md"), "utf8").catch(() => "");
  const warnings = [];
  if (!/^---\n[\s\S]*^name:\s*home-ops\s*$/m.test(skill)) warnings.push("Canonical skill frontmatter is missing name: home-ops");
  return { schema_version: 1, checked_at: new Date().toISOString(), tools: { codex: results.codex_entrypoint === "compatible" ? "compatible" : "missing", claude_code: results.claude_skill_wrapper === "compatible" ? "compatible" : "missing", opencode: results.opencode_router === "compatible" ? "compatible" : "missing" }, checks: results, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCompatibilityCheck().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { process.stderr.write(`home-ops compatibility: ${error.message}\n`); process.exitCode = 1; });
}
