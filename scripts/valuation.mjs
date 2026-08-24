#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { readInventory } from "./lib/inventory.mjs";
import { readMarketObservations } from "./lib/market-store.mjs";
import { validateValuationConfigSemantics, valueListing } from "./lib/valuation.mjs";
import { writeValuationReports } from "./lib/valuation-report.mjs";
import { createListingValidator, createMarketObservationValidator, createSchemaValidator } from "./lib/validate.mjs";
import { validateRegion } from "./lib/region.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

function valuationTime(value) {
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("--now must be an RFC 3339 datetime");
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error("--now must be an RFC 3339 datetime");
  return date.toISOString();
}

export async function runValuation(options = {}) {
  if (!options.listing) throw new Error("valuation requires --listing <id>");
  const now = valuationTime(options.now ?? Date.now());
  const inventoryPath = projectPath(options.inventory ?? "data/listings.jsonl");
  const observationsPath = projectPath(options.observations ?? "data/market-observations.jsonl");
  const regionPath = projectPath(options.region ?? "regions/uy-montevideo.yml");
  const reportsDirectory = projectPath(options.reportsDir ?? "reports");
  const configPath = options.config ? projectPath(options.config) : `${regionPath}#valuation`;

  const validateListing = await createListingValidator(join(ROOT, "schemas/listing.schema.json"));
  const validateObservation = await createMarketObservationValidator(join(ROOT, "schemas/market-observation.schema.json"));
  const validateConfig = await createSchemaValidator(join(ROOT, "schemas/valuation-config.schema.json"), "valuation configuration");
  const validateValuation = await createSchemaValidator(join(ROOT, "schemas/valuation.schema.json"), "valuation result");
  const listings = await readInventory(inventoryPath);
  listings.forEach(validateListing);
  const subject = listings.find((listing) => listing.id === options.listing);
  if (!subject) throw new Error(`Listing not found: ${options.listing}`);
  const { records: observations } = await readMarketObservations(observationsPath, validateObservation);
  const region = YAML.parse(await readFile(regionPath, "utf8"));
  await validateRegion(region, ROOT);
  const config = options.config ? YAML.parse(await readFile(projectPath(options.config), "utf8")) : region.valuation;
  validateConfig(config);
  validateValuationConfigSemantics(config);
  const valuation = valueListing(subject, observations, config, { now, inventoryPath, observationsPath, configPath, regionPath });
  validateValuation(valuation);
  const reportPaths = await writeValuationReports(reportsDirectory, valuation);
  return { valuation, reportPaths };
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!["listing", "inventory", "observations", "region", "config", "reportsDir", "now"].includes(key)) throw new Error(`Unknown option: ${argument}`);
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
    if (options.help) return process.stdout.write("Usage: npm run valuation -- --listing <id> [--config <path>] [--json]\n");
    const result = await runValuation(options);
    if (options.json) return process.stdout.write(`${JSON.stringify(result.valuation, null, 2)}\n`);
    process.stdout.write(`Valued ${result.valuation.subject.listing_id}. Reports: ${result.reportPaths.jsonPath}, ${result.reportPaths.markdownPath}\n`);
  }).catch((error) => {
    process.stderr.write(`home-ops valuation: ${error.message}\n`);
    process.exitCode = 1;
  });
}
