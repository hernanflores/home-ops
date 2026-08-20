#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { evaluateListing, validateProfileSemantics } from "./lib/evaluate.mjs";
import { writeEvaluationReports } from "./lib/evaluation-report.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { createListingValidator, createSchemaValidator } from "./lib/validate.mjs";
import { runTrackerSync } from "./tracker.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") args.help = true;
    else if (argument === "--json") args.json = true;
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
  return `Usage: npm run evaluate -- [options]

Options:
  --profile <path>      Private profile (default: config/profile.yml)
  --inventory <path>    Canonical JSONL inventory (default: data/listings.jsonl)
  --listing <id>        Evaluate one canonical listing; default evaluates all
  --reports-dir <path>  Derived output directory (default: reports)
  --tracker <path>      Canonical tracker (default: data/tracker.jsonl)
  --now <ISO datetime>  Deterministic evaluation time, useful for tests
  --json                Print structured evaluations to stdout
`;
}

function projectPath(path) {
  return isAbsolute(path) ? path : resolve(ROOT, path);
}

export async function runEvaluate(options = {}) {
  const now = new Date(options.now ?? Date.now()).toISOString();
  const profilePath = projectPath(options.profile ?? "config/profile.yml");
  const inventoryPath = projectPath(options.inventory ?? "data/listings.jsonl");
  const reportsDirectory = projectPath(options.reportsDir ?? "reports");
  const profile = YAML.parse(await readFile(profilePath, "utf8"));
  const validateProfile = await createSchemaValidator(join(ROOT, "schemas/profile.schema.json"), "evaluation profile");
  validateProfile(profile);
  validateProfileSemantics(profile);

  const listings = await readInventory(inventoryPath);
  if (listings.length === 0) throw new Error(`No canonical listings found in ${inventoryPath}`);
  const validateListing = await createListingValidator(join(ROOT, "schemas/listing.schema.json"));
  listings.forEach(validateListing);
  const selected = options.listing ? listings.filter((listing) => listing.id === options.listing) : listings;
  if (options.listing && selected.length === 0) throw new Error(`Listing not found: ${options.listing}`);

  const validateEvaluation = await createSchemaValidator(join(ROOT, "schemas/evaluation.schema.json"), "evaluation result");
  const evaluations = selected.sort((left, right) => left.id.localeCompare(right.id)).map((listing) => {
    const evaluation = evaluateListing(listing, profile, { now, profilePath, inventoryPath });
    validateEvaluation(evaluation);
    return evaluation;
  });
  const reportPaths = [];
  for (const evaluation of evaluations) reportPaths.push(await writeEvaluationReports(reportsDirectory, evaluation));
  const trackerSync = options.listing ? null : await runTrackerSync({
    now,
    profile: profilePath,
    inventory: inventoryPath,
    tracker: options.tracker
  });
  return { now, profilePath, inventoryPath, evaluations, reportPaths, trackerSync };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return process.stdout.write(usage());
  const result = await runEvaluate(args);
  if (args.json) return process.stdout.write(`${JSON.stringify(result.evaluations, null, 2)}\n`);
  process.stdout.write(`Evaluated ${result.evaluations.length} listing(s) with ${result.profilePath}.\n`);
  for (let index = 0; index < result.evaluations.length; index += 1) {
    const evaluation = result.evaluations[index];
    const paths = result.reportPaths[index];
    process.stdout.write(`${evaluation.listing.id}: ${evaluation.eligibility}, ${evaluation.score.percentage}%, ${evaluation.recommendation}\n`);
    process.stdout.write(`Reports: ${paths.jsonPath}, ${paths.markdownPath}\n`);
  }
  if (result.trackerSync) {
    process.stdout.write(`Tracker sync: ${result.trackerSync.added.length} added, ${result.trackerSync.candidates.length} non-discarded, ${result.trackerSync.records.length} tracked.\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`home-ops evaluate: ${error.message}\n`);
    process.exitCode = 1;
  });
}
