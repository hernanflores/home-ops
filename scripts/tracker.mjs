#!/usr/bin/env node
import { mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { evaluateListing, validateProfileSemantics } from "./lib/evaluate.mjs";
import { writeEvaluationReports } from "./lib/evaluation-report.mjs";
import { readInventory } from "./lib/inventory.mjs";
import { applyTrackerAction, assertTrackerIntegrity } from "./lib/tracker.mjs";
import { renderTrackerReport, writeTrackerReport } from "./lib/tracker-report.mjs";
import { readTracker, withTrackerLock, writeTracker } from "./lib/tracker-store.mjs";
import { createListingValidator, createSchemaValidator } from "./lib/validate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

function iso(value, label) {
  if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`${label} must be an RFC 3339 datetime`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${label} must be an RFC 3339 datetime`);
  return date.toISOString();
}

function nonBlank(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must contain non-whitespace text`);
  return value;
}

async function filesystemIdentity(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(await realpath(dirname(path)), basename(path));
  }
}

async function context(options) {
  const trackerPath = projectPath(options.tracker ?? "data/tracker.jsonl");
  const inventoryPath = projectPath(options.inventory ?? "data/listings.jsonl");
  const validateTracker = await createSchemaValidator(join(ROOT, "schemas/tracker.schema.json"), "tracker record");
  const validateListing = await createListingValidator(join(ROOT, "schemas/listing.schema.json"));
  const listings = await readInventory(inventoryPath);
  listings.forEach(validateListing);
  const tracker = await readTracker(trackerPath, validateTracker);
  assertTrackerIntegrity(tracker.records, listings);
  return { trackerPath, inventoryPath, validateTracker, listings, ...tracker };
}

async function evaluationContext(options) {
  const profilePath = projectPath(options.profile ?? "config/profile.yml");
  const profile = YAML.parse(await readFile(profilePath, "utf8"));
  const validateProfile = await createSchemaValidator(join(ROOT, "schemas/profile.schema.json"), "evaluation profile");
  validateProfile(profile);
  validateProfileSemantics(profile);
  return { profilePath, profile };
}

function action(options, now) {
  if (options.command === "start") return { type: "start" };
  if (options.command === "transition") return { type: "transition", to: options.to };
  if (options.command === "availability") return { type: "availability", to: options.to };
  if (options.command === "note") return { type: "note", text: nonBlank(options.text, "--text") };
  if (options.command === "question") return { type: "question", text: nonBlank(options.text, "--text") };
  if (options.command === "answer") return { type: "answer", questionId: options.question, text: nonBlank(options.text, "--text") };
  if (options.command === "visit") {
    const visitedAt = iso(options.visitedAt, "--visited-at");
    if (visitedAt > now) throw new Error("--visited-at cannot be after the event recording time");
    if (options.notes !== undefined) nonBlank(options.notes, "--notes");
    return { type: "visit", visitedAt, notes: options.notes };
  }
  if (options.command === "decision") {
    nonBlank(options.decision, "--decision");
    if (options.reason !== undefined) nonBlank(options.reason, "--reason");
    return { type: "decision", decision: options.decision, reason: options.reason };
  }
  throw new Error(`Unknown tracker command: ${options.command}`);
}

function requireActionInput(options) {
  if (["start", "transition", "availability", "note", "question", "answer", "visit", "decision"].includes(options.command) && !options.listing) {
    throw new Error(`${options.command} requires a canonical listing ID`);
  }
  const required = {
    transition: ["to"], availability: ["to"], note: ["text"], question: ["text"],
    answer: ["question", "text"], visit: ["visitedAt"], decision: ["decision"]
  }[options.command] ?? [];
  for (const key of required) if (!options[key]) throw new Error(`${options.command} requires --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
}

export async function runTracker(options) {
  const now = iso(options.now ?? Date.now(), "--now");
  requireActionInput(options);
  const trackerPath = projectPath(options.tracker ?? "data/tracker.jsonl");
  return withTrackerLock(trackerPath, async () => {
    const current = await context(options);
    if (!current.listings.some((listing) => listing.id === options.listing)) throw new Error(`Listing not found: ${options.listing}`);
    const result = applyTrackerAction(current.records, options.listing, action(options, now), now);
    result.records.forEach(current.validateTracker);
    assertTrackerIntegrity(result.records, current.listings);
    if (result.changed) await writeTracker(current.trackerPath, result.records, current.source);
    return { now, trackerPath: current.trackerPath, inventoryPath: current.inventoryPath, ...result };
  });
}

export async function runTrackerSync(options = {}) {
  const now = iso(options.now ?? Date.now(), "--now");
  const trackerPath = projectPath(options.tracker ?? "data/tracker.jsonl");
  return withTrackerLock(trackerPath, async () => {
    const current = await context(options);
    const { profilePath, profile } = await evaluationContext(options);
    const validateEvaluation = await createSchemaValidator(join(ROOT, "schemas/evaluation.schema.json"), "evaluation result");
    const evaluations = current.listings.toSorted((left, right) => left.id.localeCompare(right.id)).map((listing) => {
      const evaluation = evaluateListing(listing, profile, { now, profilePath, inventoryPath: current.inventoryPath });
      validateEvaluation(evaluation);
      return evaluation;
    });
    const tracked = new Set(current.records.map((record) => record.listing_id));
    const candidates = evaluations.filter((evaluation) => evaluation.recommendation !== "discard");
    const added = [];
    let records = current.records;
    for (const evaluation of candidates) {
      if (tracked.has(evaluation.listing.id)) continue;
      const result = applyTrackerAction(records, evaluation.listing.id, { type: "start" }, now);
      records = result.records;
      tracked.add(evaluation.listing.id);
      added.push(evaluation.listing.id);
    }
    records.forEach(current.validateTracker);
    assertTrackerIntegrity(records, current.listings);
    if (added.length) await writeTracker(current.trackerPath, records, current.source);
    return {
      now,
      trackerPath: current.trackerPath,
      inventoryPath: current.inventoryPath,
      profilePath,
      records,
      evaluations,
      candidates: candidates.map((evaluation) => evaluation.listing.id),
      added,
      changed: added.length > 0
    };
  });
}

export async function runTrackerReport(options = {}) {
  const now = iso(options.now ?? Date.now(), "--now");
  const current = await context(options);
  const { profilePath, profile } = await evaluationContext(options);
  const reportPath = projectPath(options.output ?? "reports/tracker.md");
  await mkdir(dirname(reportPath), { recursive: true });
  const reportIdentity = await filesystemIdentity(reportPath);
  const inputIdentities = await Promise.all([current.trackerPath, current.inventoryPath, profilePath].map(filesystemIdentity));
  if (inputIdentities.includes(reportIdentity)) {
    throw new Error("Tracker report output must not overwrite a canonical input or profile");
  }
  const listingById = new Map(current.listings.map((listing) => [listing.id, listing]));
  const evaluations = current.records.map((record) => evaluateListing(listingById.get(record.listing_id), profile, {
    now, profilePath, inventoryPath: current.inventoryPath
  }));
  const evaluationReports = new Map();
  for (const evaluation of evaluations) {
    const paths = await writeEvaluationReports(dirname(reportPath), evaluation);
    evaluationReports.set(evaluation.listing.id, relative(dirname(reportPath), paths.markdownPath).replaceAll("\\", "/"));
  }
  const report = renderTrackerReport({
    now,
    trackerPath: current.trackerPath,
    inventoryPath: current.inventoryPath,
    records: current.records,
    listings: current.listings,
    evaluations,
    evaluationReports
  });
  await writeTrackerReport(reportPath, report);
  return { now, reportPath, records: current.records, evaluations };
}

function parse(argv) {
  const [command, possibleListing, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { help: true };
  const options = { command };
  const common = ["tracker", "inventory", "now", "json"];
  const commandOptions = {
    start: [], transition: ["to"], availability: ["to"], note: ["text"], question: ["text"],
    answer: ["question", "text"], visit: ["visitedAt", "notes"], decision: ["decision", "reason"],
    report: ["profile", "output"], sync: ["profile"]
  };
  if (!Object.hasOwn(commandOptions, command)) throw new Error(`Unknown tracker command: ${command}`);
  const allowed = new Set([...common, ...commandOptions[command]]);
  const noListing = command === "report" || command === "sync";
  const args = noListing ? [possibleListing, ...rest].filter(Boolean) : rest;
  if (!noListing) options.listing = possibleListing;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!allowed.has(key)) throw new Error(`Unknown option for ${command}: ${argument}`);
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[key] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return `Usage: npm run tracker -- <command> [listing-id] [options]

Commands: start, transition, availability, note, question, answer, visit, decision, sync, report
Common options: --tracker <path> --inventory <path> --now <ISO> --json
Sync options: --profile <path>
Report options: --profile <path> --output <path>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(async () => {
    const options = parse(process.argv.slice(2));
    if (options.help) return process.stdout.write(usage());
    const result = options.command === "report"
      ? await runTrackerReport(options)
      : options.command === "sync"
        ? await runTrackerSync(options)
        : await runTracker(options);
    if (options.json) return process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (options.command === "report") return process.stdout.write(`Tracker report: ${result.reportPath}\n`);
    if (options.command === "sync") return process.stdout.write(`Tracker sync: ${result.added.length} added, ${result.candidates.length} non-discarded, ${result.records.length} tracked.\n`);
    process.stdout.write(`${result.record.listing_id}: ${result.record.state}, ${result.record.availability}; ${result.changed ? "updated" : "unchanged"}\n`);
  }).catch((error) => {
    process.stderr.write(`home-ops tracker: ${error.message}\n`);
    process.exitCode = 1;
  });
}
