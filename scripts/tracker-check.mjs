#!/usr/bin/env node
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readInventory } from "./lib/inventory.mjs";
import { assertTrackerIntegrity } from "./lib/tracker.mjs";
import { readTracker } from "./lib/tracker-store.mjs";
import { createListingValidator, createSchemaValidator } from "./lib/validate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

export async function runTrackerCheck(options = {}) {
  const trackerPath = projectPath(options.tracker ?? "data/tracker.jsonl");
  const inventoryPath = projectPath(options.inventory ?? "data/listings.jsonl");
  const validateTracker = await createSchemaValidator(join(ROOT, "schemas/tracker.schema.json"), "tracker record");
  const validateListing = await createListingValidator(join(ROOT, "schemas/listing.schema.json"));
  const listings = await readInventory(inventoryPath);
  listings.forEach(validateListing);
  const { records } = await readTracker(trackerPath, validateTracker);
  assertTrackerIntegrity(records, listings);
  return { trackerPath, inventoryPath, records };
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!["tracker", "inventory"].includes(key)) throw new Error(`Unknown option: ${argument}`);
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
    if (options.help) return process.stdout.write("Usage: npm run tracker:check -- [--tracker <path>] [--inventory <path>]\n");
    const result = await runTrackerCheck(options);
    process.stdout.write(`Tracker integrity OK: ${result.records.length} record(s) in ${result.trackerPath}\n`);
  }).catch((error) => {
    process.stderr.write(`home-ops tracker check: ${error.message}\n`);
    process.exitCode = 1;
  });
}
