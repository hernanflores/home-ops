#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { normalizeListing, applyFreshness } from "./lib/normalize.mjs";
import { assignDuplicateGroups } from "./lib/deduplicate.mjs";
import { mergeInventory, readInventory, writeInventory } from "./lib/inventory.mjs";
import { renderReport, writeReport } from "./lib/report.mjs";
import { createListingValidator } from "./lib/validate.mjs";
import { appendProviderRuns } from "./lib/provider-health.mjs";
import { loadProviders } from "../providers/_registry.mjs";
import { runProviders } from "../providers/_runner.mjs";
import { ProviderParseError, errorDiagnostic } from "../providers/_errors.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROVIDERS_DIR = join(ROOT, "providers");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") args.help = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      args[key] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

function usage() {
  return `Usage: npm run scan -- [options]

Options:
  --config <path>       Config file (default: config/home-ops.yml)
  --input <path>        Import one JSON or CSV file instead of configured sources
  --format <json|csv>   Input format; inferred from --input extension by default
  --provider <name>     Source name for --input (default: local-import)
  --inventory <path>    Override canonical JSONL path
  --reports-dir <path>  Override report directory
  --cache-dir <path>    Override private provider cache directory
  --provider-runs <path> Override provider health ledger path
  --now <ISO datetime>  Deterministic run time, useful for tests
`;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function projectPath(path) {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

async function loadYaml(path) {
  return YAML.parse(await readFile(path, "utf8"));
}

async function loadConfiguration(configPath) {
  if (!(await exists(configPath))) {
    return {
      region: "uy-montevideo",
      inventory: "data/listings.jsonl",
      reports_dir: "reports",
      sources: []
    };
  }
  const config = await loadYaml(configPath);
  if (!config || typeof config !== "object") throw new Error(`${configPath}: expected a YAML object`);
  return config;
}

function resolveSources(args, config) {
  if (args.input) {
    const extension = args.input.split(".").at(-1)?.toLowerCase();
    const format = args.format ?? extension;
    return [{
      type: format === "json" || format === "csv" ? `local-${format}` : format,
      path: args.input,
      provider: args.provider ?? "local-import"
    }];
  }
  return config.sources ?? [];
}

export async function runScan(options = {}) {
  const now = new Date(options.now ?? Date.now()).toISOString();
  const configPath = projectPath(options.config ?? "config/home-ops.yml");
  const config = await loadConfiguration(configPath);
  const regionId = config.region ?? "uy-montevideo";
  const regionPath = projectPath(`regions/${regionId.replace(/^.*\//, "")}.yml`);
  if (!(await exists(regionPath))) throw new Error(`Unknown region: ${regionId}`);
  const region = await loadYaml(regionPath);
  const sources = resolveSources(options, config);
  if (sources.length === 0) throw new Error("No sources configured. Use --input or add entries under sources in config/home-ops.yml");

  const { providers, warnings } = await loadProviders(PROVIDERS_DIR);
  for (const warning of warnings) process.stderr.write(`home-ops provider: ${warning}\n`);
  const cacheDir = projectPath(options.cacheDir ?? config.cache_dir ?? "data/cache/providers");
  const providerRunsPath = projectPath(options.providerRuns ?? config.provider_runs ?? "data/provider-runs.jsonl");
  const providerResult = await runProviders(sources, {
    providers,
    now,
    cacheDir,
    resolvePath: projectPath,
    fetchImpl: options.fetchImpl,
    sleep: options.sleep,
    random: options.random,
    lookup: options.lookup,
    clock: options.clock,
    limiter: new Map()
  });
  const diagnostics = providerResult.diagnostics;
  const reportsDirectory = projectPath(options.reportsDir ?? config.reports_dir ?? "reports");
  const validate = await createListingValidator(join(ROOT, "schemas/listing.schema.json"));
  const normalized = [];

  for (const batch of providerResult.batches) {
    try {
      const candidates = batch.listings.map((raw) => normalizeListing(raw, region, now));
      candidates.forEach(validate);
      normalized.push(...candidates);
    } catch (error) {
      batch.diagnostic.status = "failed";
      batch.diagnostic.count = 0;
      batch.diagnostic.error = errorDiagnostic(new ProviderParseError(
        `Provider output failed canonical validation: ${error.message}`,
        { cause: error }
      ));
    }
  }

  const successful = diagnostics.filter((diagnostic) => diagnostic.status === "success");
  await appendProviderRuns(providerRunsPath, now, diagnostics);

  if (successful.length === 0) {
    const report = renderReport({ now, region, touched: [], duplicateGroups: [], diagnostics });
    const reportPath = await writeReport(reportsDirectory, now, report);
    throw new Error(`All enabled sources failed. Inventory was not modified. Report: ${reportPath}`);
  }

  const inventoryPath = projectPath(options.inventory ?? config.inventory ?? "data/listings.jsonl");
  const existing = await readInventory(inventoryPath);
  const { listings, touched } = mergeInventory(existing, normalized, now);
  const staleAfterDays = Number(config.freshness?.stale_after_days ?? region.freshness?.stale_after_days ?? 45);
  if (!Number.isFinite(staleAfterDays) || staleAfterDays < 0) throw new Error("freshness.stale_after_days must be a non-negative number");

  for (const listing of listings) listing.freshness = applyFreshness(listing, now, staleAfterDays);
  assignDuplicateGroups(listings);

  listings.forEach(validate);
  await writeInventory(inventoryPath, listings);

  const touchedSet = new Set(touched);
  const touchedListings = listings.filter((listing) => touchedSet.has(listing.id));
  const groups = Map.groupBy(listings.filter((listing) => listing.duplicate.group_id), (listing) => listing.duplicate.group_id);
  const duplicateGroups = [...groups.values()].filter((group) => group.some((listing) => touchedSet.has(listing.id)));
  const report = renderReport({ now, region, touched: touchedListings, duplicateGroups, diagnostics });
  const reportPath = await writeReport(reportsDirectory, now, report);

  return { now, inventoryPath, reportPath, listings, touched: touchedListings, diagnostics };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await runScan(args);
  const counts = Object.groupBy(result.touched, (listing) => listing.status);
  process.stdout.write(`Processed ${result.touched.length}: ${counts.new?.length ?? 0} new, ${counts.updated?.length ?? 0} updated, ${counts.unchanged?.length ?? 0} unchanged.\n`);
  process.stdout.write(`Inventory: ${result.inventoryPath}\nReport: ${result.reportPath}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`home-ops scan: ${error.message}\n`);
    process.exitCode = 1;
  });
}
