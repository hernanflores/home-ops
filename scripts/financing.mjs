#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { calculateFinancing } from "./lib/financing.mjs";
import { writeFinancingReports } from "./lib/financing-report.mjs";
import { createSchemaValidator } from "./lib/validate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

function financingTime(value) {
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("--now must be an RFC 3339 datetime");
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("--now must be an RFC 3339 datetime");
  return date.toISOString();
}

export async function runFinancing(options = {}) {
  const now = financingTime(options.now ?? Date.now());
  const configPath = projectPath(options.config ?? "config/financing.yml");
  const regionPath = projectPath(options.region ?? "regions/uy-montevideo.yml");
  const reportsDirectory = projectPath(options.reportsDir ?? "reports");
  const validateConfig = await createSchemaValidator(resolve(ROOT, "schemas/financing-config.schema.json"), "financing configuration");
  const validateResult = await createSchemaValidator(resolve(ROOT, "schemas/financing-result.schema.json"), "financing result");
  const config = YAML.parse(await readFile(configPath, "utf8"));
  const region = YAML.parse(await readFile(regionPath, "utf8"));
  validateConfig(config);
  const result = calculateFinancing(config, { region, now });
  validateResult(result);
  const reportPaths = await writeFinancingReports(reportsDirectory, result);
  return { result, reportPaths };
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!["config", "region", "reportsDir", "now"].includes(key)) throw new Error(`Unknown option: ${argument}`);
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[key] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(async () => {
    const options = parse(process.argv.slice(2));
    if (options.help) return process.stdout.write("Usage: npm run financing -- [--config <path>] [--region <path>] [--reports-dir <path>] [--json]\n");
    const result = await runFinancing(options);
    if (options.json) return process.stdout.write(`${JSON.stringify(result.result, null, 2)}\n`);
    process.stdout.write(`Calculated ${result.result.scenarios.length} financing scenarios. Reports: ${result.reportPaths.jsonPath}, ${result.reportPaths.markdownPath}\n`);
  }).catch((error) => {
    process.stderr.write(`home-ops financing: ${error.message}\n`);
    process.exitCode = 1;
  });
}
