#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { buildComparison } from "./lib/compare.mjs";
import { writeComparisonReports } from "./lib/comparison-report.mjs";
import { evaluateListing, validateProfileSemantics } from "./lib/evaluate.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { assertTrackerIntegrity } from "./lib/tracker.mjs";
import { readTracker } from "./lib/tracker-store.mjs";
import { createListingValidator, createSchemaValidator } from "./lib/validate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

function evaluationTime(value) {
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error("--now must be an RFC 3339 datetime");
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("--now must be an RFC 3339 datetime");
  return date.toISOString();
}

export async function runCompare(options = {}) {
  const now = evaluationTime(options.now ?? Date.now());
  const inventoryPath = projectPath(options.inventory ?? "data/listings.jsonl");
  const trackerPath = projectPath(options.tracker ?? "data/tracker.jsonl");
  const profilePath = projectPath(options.profile ?? "config/profile.yml");
  const reportsDirectory = projectPath(options.reportsDir ?? "reports");
  const validateListing = await createListingValidator(join(ROOT, "schemas/listing.schema.json"));
  const validateTracker = await createSchemaValidator(join(ROOT, "schemas/tracker.schema.json"), "tracker record");
  const validateProfile = await createSchemaValidator(join(ROOT, "schemas/profile.schema.json"), "evaluation profile");
  const validateComparison = await createSchemaValidator(join(ROOT, "schemas/comparison.schema.json"), "comparison result");
  const listings = await readInventory(inventoryPath);
  listings.forEach(validateListing);
  const { records } = await readTracker(trackerPath, validateTracker);
  assertTrackerIntegrity(records, listings);
  const profile = YAML.parse(await readFile(profilePath, "utf8"));
  validateProfile(profile);
  validateProfileSemantics(profile);

  if (options.shortlist && options.listings?.length) throw new Error("--shortlist cannot be combined with --listing");
  const ids = options.shortlist
    ? records.filter((record) => ["shortlisted", "contacted", "visited"].includes(record.state)).map((record) => record.listing_id)
    : options.listings ?? [];
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length < 2) throw new Error("Comparison requires at least two distinct listings");
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  for (const id of uniqueIds) if (!byId.has(id)) throw new Error(`Listing not found: ${id}`);
  const selected = uniqueIds.map((id) => byId.get(id));
  const evaluations = selected.map((listing) => evaluateListing(listing, profile, { now, profilePath, inventoryPath }));
  const comparison = buildComparison({ now, inventoryPath, trackerPath, profilePath, listings: selected, trackers: records, evaluations });
  validateComparison(comparison);
  const reportPaths = await writeComparisonReports(reportsDirectory, comparison);
  return { comparison, reportPaths };
}

function parse(argv) {
  const options = { listings: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--shortlist") options.shortlist = true;
    else if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!["listing", "inventory", "tracker", "profile", "reportsDir", "now"].includes(key)) throw new Error(`Unknown option: ${argument}`);
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      if (key === "listing") options.listings.push(value);
      else options[key] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(async () => {
    const options = parse(process.argv.slice(2));
    if (options.help) return process.stdout.write("Usage: npm run compare -- (--listing <id> --listing <id> | --shortlist) [options]\n");
    const result = await runCompare(options);
    if (options.json) return process.stdout.write(`${JSON.stringify(result.comparison, null, 2)}\n`);
    process.stdout.write(`Compared ${result.comparison.listings.length} listings.\nReports: ${result.reportPaths.jsonPath}, ${result.reportPaths.markdownPath}\n`);
  }).catch((error) => {
    process.stderr.write(`home-ops compare: ${error.message}\n`);
    process.exitCode = 1;
  });
}
