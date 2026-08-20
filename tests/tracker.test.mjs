import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { normalizeListing } from "../scripts/lib/normalize.mjs";
import { writeInventory } from "../scripts/lib/inventory.mjs";
import { withTrackerLock } from "../scripts/lib/tracker-store.mjs";
import { runTracker, runTrackerReport, runTrackerSync } from "../scripts/tracker.mjs";
import { runTrackerCheck } from "../scripts/tracker-check.mjs";

const NOW = "2026-08-20T12:00:00.000Z";
const REGION = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "USD" };

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-tracker-"));
  const inventory = join(directory, "listings.jsonl");
  const tracker = join(directory, "tracker.jsonl");
  const profile = join(directory, "profile.yml");
  const output = join(directory, "tracker.md");
  const listing = normalizeListing({
    id: "tracked-1", url: "https://example.test/tracked-1", operation: "rent", property_type: "apartment",
    title: "Unsafe | *title*", city: "Montevideo", neighborhood: "Cordón", price: 900, currency: "USD",
    bedrooms: 1, bathrooms: 1, area_total_m2: 50, parking_spaces: 1,
    _home_ops_source: { provider: "fixture", retrieved_at: NOW }
  }, REGION, NOW);
  await writeInventory(inventory, [listing]);
  await writeFile(profile, YAML.stringify({
    schema_version: 1, name: "Tracker profile", stale_after_days: 45,
    hard_filters: [{ id: "rent", label: "Rent", field: "property.operation", operator: "equals", value: "rent" }],
    weighted_criteria: [{ id: "area", label: "Area", field: "property.features.area_total_m2", operator: "at_least", value: 40, weight: 100 }],
    recommendation: { discard_below_score: 50, visit_score: 60, prioritize_score: 80 }
  }));
  return { directory, inventory, tracker, profile, output, listing };
}

function options(fixture, command, extra = {}) {
  return { command, listing: fixture.listing.id, inventory: fixture.inventory, tracker: fixture.tracker, now: NOW, ...extra };
}

test("tracker enforces lifecycle transitions and terminal archive", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  await runTracker(options(fixture, "transition", { to: "shortlisted", now: "2026-08-20T13:00:00Z" }));
  await assert.rejects(runTracker(options(fixture, "transition", { to: "watching", now: "2026-08-20T14:00:00Z" })), /Invalid state transition/);
  await runTracker(options(fixture, "transition", { to: "contacted", now: "2026-08-20T15:00:00Z" }));
  await runTracker(options(fixture, "transition", { to: "visited", now: "2026-08-20T16:00:00Z" }));
  const archived = await runTracker(options(fixture, "transition", { to: "archived", now: "2026-08-20T17:00:00Z" }));
  assert.equal(archived.record.state, "archived");
  await assert.rejects(runTracker(options(fixture, "transition", { to: "watching", now: "2026-08-20T18:00:00Z" })), /Invalid state transition/);
  assert.equal((await runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker })).records.length, 1);
});

test("tracker sync adds non-discarded listings once and preserves existing states", async () => {
  const fixture = await setup();
  const discarded = normalizeListing({
    id: "discarded", url: "https://example.test/discarded", operation: "sale", property_type: "apartment",
    title: "Discarded", city: "Montevideo", neighborhood: "Cordón", price: 900, currency: "USD",
    bedrooms: 1, bathrooms: 1, area_total_m2: 50, parking_spaces: 1,
    _home_ops_source: { provider: "fixture", retrieved_at: NOW }
  }, REGION, NOW);
  await writeInventory(fixture.inventory, [fixture.listing, discarded]);

  const syncOptions = {
    inventory: fixture.inventory,
    tracker: fixture.tracker,
    profile: fixture.profile,
    now: NOW
  };
  const first = await runTrackerSync(syncOptions);
  assert.deepEqual(first.candidates, [fixture.listing.id]);
  assert.deepEqual(first.added, [fixture.listing.id]);
  assert.equal(first.records[0].state, "watching");
  assert.equal(first.records[0].availability, "unknown");

  await runTracker(options(fixture, "transition", { to: "shortlisted", now: "2026-08-20T13:00:00Z" }));
  const second = await runTrackerSync({ ...syncOptions, now: "2026-08-20T14:00:00Z" });
  assert.deepEqual(second.added, []);
  assert.equal(second.changed, false);
  assert.equal(second.records[0].state, "shortlisted");
  assert.equal(second.records[0].events.length, 2);
});

test("tracker records independent events idempotently and renders a safe review", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  await runTracker(options(fixture, "availability", { to: "available", now: "2026-08-20T13:00:00Z" }));
  await runTracker(options(fixture, "transition", { to: "shortlisted", now: "2026-08-20T13:30:00Z" }));
  const noteOptions = options(fixture, "note", { text: "Review | *carefully*\r# not a heading", now: "2026-08-20T14:00:00Z" });
  await runTracker(noteOptions);
  const beforeRepeat = await readFile(fixture.tracker, "utf8");
  const repeated = await runTracker(noteOptions);
  assert.equal(repeated.changed, false);
  assert.equal(await readFile(fixture.tracker, "utf8"), beforeRepeat);
  const question = await runTracker(options(fixture, "question", { text: "Are expenses included?", now: "2026-08-20T15:00:00Z" }));
  await runTracker(options(fixture, "answer", { question: question.event.id, text: "Reported separately", now: "2026-08-20T16:00:00Z" }));
  await runTracker(options(fixture, "question", { text: "Is the listing still available?", now: "2026-08-20T16:30:00Z" }));
  await runTracker(options(fixture, "visit", { visitedAt: "2026-08-19T18:00:00Z", notes: "User-recorded visit", now: "2026-08-20T17:00:00Z" }));
  await runTracker(options(fixture, "decision", { decision: "Keep watching", reason: "Price uncertainty", now: "2026-08-20T18:00:00Z" }));

  const inventoryBefore = await readFile(fixture.inventory, "utf8");
  const trackerBefore = await readFile(fixture.tracker, "utf8");
  await runTrackerReport({ inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, output: fixture.output, now: "2026-10-21T12:00:00Z" });
  assert.equal(await readFile(fixture.inventory, "utf8"), inventoryBefore);
  assert.equal(await readFile(fixture.tracker, "utf8"), trackerBefore);
  const report = await readFile(fixture.output, "utf8");
  assert.match(report, /HomeOps Tracker Review/);
  assert.match(report, /\| Listing \/ Source \| Canonical ID \| State \|/);
  assert.equal(report.split("\n").filter((line) => line.startsWith("|") && line.includes(`\`${fixture.listing.id}\``)).length, 1);
  assert.match(report, /Unsafe \\| \\\*title\\\*/);
  assert.match(report, /Listing may be stale/);
  assert.match(report, /\| 1 \| 2026-08-20T18:00:00\.000Z \| \[full\]/);
  assert.match(report, new RegExp(`\\[full\\]\\(<evaluation-${fixture.listing.id}-2026-10-21T12-00-00-000Z\\.md>\\)`));
  assert.doesNotMatch(report, /Active Shortlist|### Timeline/);
  assert.doesNotMatch(report, /\r/);
  assert.match(report, /HomeOps did not contact an owner/);

  const fullEvaluation = await readFile(join(fixture.directory, `evaluation-${fixture.listing.id}-2026-10-21T12-00-00-000Z.md`), "utf8");
  assert.match(fullEvaluation, /HomeOps Property Evaluation/);
  assert.match(fullEvaluation, new RegExp(fixture.listing.id));
});

test("integrity rejects malformed projections and dangling references", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  const record = JSON.parse((await readFile(fixture.tracker, "utf8")).trim());
  record.state = "visited";
  await writeFile(fixture.tracker, `${JSON.stringify(record)}\n`);
  await assert.rejects(runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker }), /state does not match event history/);

  record.state = "watching";
  record.listing_id = "lst_0000000000000000";
  await writeFile(fixture.tracker, `${JSON.stringify(record)}\n`);
  await assert.rejects(runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker }), /missing listing/);

  await writeFile(fixture.tracker, "{not-json}\n");
  await assert.rejects(runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker }), /tracker\.jsonl:1:/);
});

test("integrity rejects duplicate records and event-content tampering", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  const source = await readFile(fixture.tracker, "utf8");
  await writeFile(fixture.tracker, `${source}${source}`);
  await assert.rejects(runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker }), /Duplicate tracker record/);

  const record = JSON.parse(source.trim());
  record.events[0].payload.availability = "available";
  record.availability = "available";
  await writeFile(fixture.tracker, `${JSON.stringify(record)}\n`);
  await assert.rejects(runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker }), /Invalid tracker record|event id does not match/);
});

test("tracker serializes concurrent writers and rejects unsafe inputs", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  await writeFile(`${fixture.tracker}.lock`, "999999999 0\n");
  await Promise.all([
    runTracker(options(fixture, "note", { text: "First", now: "2026-08-20T13:00:00Z" })),
    runTracker(options(fixture, "note", { text: "Second", now: "2026-08-20T13:00:00Z" }))
  ]);
  const checked = await runTrackerCheck({ inventory: fixture.inventory, tracker: fixture.tracker });
  assert.equal(checked.records[0].events.length, 3);
  await assert.rejects(runTracker(options(fixture, "note", { text: "   ", now: "2026-08-20T15:00:00Z" })), /non-whitespace/);
  await assert.rejects(runTracker(options(fixture, "visit", { visitedAt: "2026-08-21T00:00:00Z", now: "2026-08-20T16:00:00Z" })), /cannot be after/);
  await assert.rejects(runTracker(options(fixture, "note", { text: "Date", now: "2026-08-20" })), /RFC 3339/);
});

test("report output cannot overwrite canonical inputs and CLI rejects typoed options", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  const trackerBefore = await readFile(fixture.tracker, "utf8");
  await assert.rejects(runTrackerReport({ inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, output: fixture.tracker, now: NOW }), /must not overwrite/);
  const alias = join(fixture.directory, "directory-alias");
  await symlink(fixture.directory, alias, "dir");
  await assert.rejects(runTrackerReport({ inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, output: join(alias, "tracker.jsonl"), now: NOW }), /must not overwrite/);
  assert.equal(await readFile(fixture.tracker, "utf8"), trackerBefore);

  const result = spawnSync(process.execPath, ["scripts/tracker.mjs", "start", fixture.listing.id, "--trakcer", fixture.tracker], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
});

test("tracker safely reclaims a lock owned by a dead process", async () => {
  const fixture = await setup();
  await runTracker(options(fixture, "start"));
  await writeFile(`${fixture.tracker}.lock`, "999999999 0\n");
  const result = await runTracker(options(fixture, "note", { text: "Recovered", now: "2026-08-20T13:00:00Z" }));
  assert.equal(result.changed, true);
  assert.equal(result.record.events.at(-1).payload.text, "Recovered");
});

test("orphaned recovery guard fails closed without hanging", async () => {
  const fixture = await setup();
  await writeFile(`${fixture.tracker}.lock`, "999999999 0\n");
  await writeFile(`${fixture.tracker}.lock.recovery`, "999999999 0\n");
  const started = Date.now();
  await assert.rejects(withTrackerLock(fixture.tracker, async () => {}, 25), /stale-lock recovery is held/);
  assert.ok(Date.now() - started < 1000);
});
