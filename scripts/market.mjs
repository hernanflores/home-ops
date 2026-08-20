#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readInventory } from "./lib/inventory.mjs";
import { importedClosedSale, listingObservation, mergeObservations } from "./lib/market-observation.mjs";
import { readMarketObservations, withMarketLock, writeMarketObservations } from "./lib/market-store.mjs";
import { createListingValidator, createMarketObservationValidator } from "./lib/validate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

async function validators() {
  return {
    listing: await createListingValidator(join(ROOT, "schemas/listing.schema.json")),
    observation: await createMarketObservationValidator(join(ROOT, "schemas/market-observation.schema.json"))
  };
}

export async function runMarketSync(options = {}) {
  const inventoryPath = projectPath(options.inventory ?? "data/listings.jsonl");
  const observationsPath = projectPath(options.observations ?? "data/market-observations.jsonl");
  const validate = await validators();
  const listings = await readInventory(inventoryPath);
  if (listings.length === 0) throw new Error(`No canonical listings found in ${inventoryPath}`);
  listings.forEach(validate.listing);
  const incoming = listings.map(listingObservation);
  incoming.forEach(validate.observation);
  return withMarketLock(observationsPath, async () => {
    const current = await readMarketObservations(observationsPath, validate.observation);
    const merged = mergeObservations(current.records, incoming);
    if (merged.added.length) await writeMarketObservations(observationsPath, merged.records, current.source);
    return { inventoryPath, observationsPath, records: merged.records, added: merged.added };
  });
}

export async function runMarketImport(options = {}) {
  if (!options.input) throw new Error("market import requires --input <path>");
  const inputPath = projectPath(options.input);
  const observationsPath = projectPath(options.observations ?? "data/market-observations.jsonl");
  const validate = (await validators()).observation;
  const document = JSON.parse(await readFile(inputPath, "utf8"));
  const inputs = Array.isArray(document) ? document : document.observations;
  if (!Array.isArray(inputs)) throw new Error("Market import JSON must be an array or an object with an observations array");
  const incoming = inputs.map(importedClosedSale);
  incoming.forEach(validate);
  return withMarketLock(observationsPath, async () => {
    const current = await readMarketObservations(observationsPath, validate);
    const merged = mergeObservations(current.records, incoming);
    if (merged.added.length) await writeMarketObservations(observationsPath, merged.records, current.source);
    return { inputPath, observationsPath, records: merged.records, added: merged.added };
  });
}

function parse(argv) {
  const options = { command: argv[0] };
  if (!["sync", "import"].includes(options.command)) throw new Error("Usage: npm run market -- <sync|import> [options]");
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!["inventory", "observations", "input"].includes(key)) throw new Error(`Unknown option: ${argument}`);
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
    const result = options.command === "sync" ? await runMarketSync(options) : await runMarketImport(options);
    if (options.json) return process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`Market evidence: ${result.added.length} added, ${result.records.length} total in ${result.observationsPath}.\n`);
  }).catch((error) => {
    process.stderr.write(`home-ops market: ${error.message}\n`);
    process.exitCode = 1;
  });
}
