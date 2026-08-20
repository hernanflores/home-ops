import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { runCompare } from "../scripts/compare.mjs";
import { writeInventory } from "../scripts/lib/inventory.mjs";
import { normalizeListing } from "../scripts/lib/normalize.mjs";
import { runTracker } from "../scripts/tracker.mjs";

const NOW = "2026-08-20T12:00:00.000Z";
const REGION = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "USD" };

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-compare-"));
  const inventory = join(directory, "listings.jsonl");
  const tracker = join(directory, "tracker.jsonl");
  const profile = join(directory, "profile.yml");
  const reportsDir = join(directory, "reports");
  const raw = [{
    id: "compare-a", url: "https://example.test/a", operation: "rent", property_type: "apartment",
    title: "Apartment A", city: "Montevideo", neighborhood: "Pocitos", price: 950, currency: "USD",
    bedrooms: 1, bathrooms: 1, area_total_m2: 45, parking_spaces: 0
  }, {
    id: "compare-b", url: "https://example.test/b", operation: "rent", property_type: "apartment",
    title: "Apartment B", city: "Montevideo", neighborhood: "Cordón", price: 35000, currency: "UYU",
    bedrooms: 1, bathrooms: 1, parking_spaces: 1
  }];
  const listings = raw.map((entry) => normalizeListing({ ...entry, _home_ops_source: { provider: "fixture", retrieved_at: NOW } }, REGION, NOW));
  for (const listing of listings) listing.duplicate = { group_id: "dup_fixture", confidence: "medium", reasons: ["fixture candidate"] };
  await writeInventory(inventory, listings);
  await writeFile(profile, YAML.stringify({
    schema_version: 1, name: "Comparison profile", stale_after_days: 45,
    hard_filters: [{ id: "rent", label: "Rent", field: "property.operation", operator: "equals", value: "rent" }],
    weighted_criteria: [
      { id: "area", label: "Area", field: "property.features.area_total_m2", operator: "at_least", value: 40, weight: 50 },
      { id: "parking", label: "Parking", field: "property.features.parking_spaces", operator: "at_least", value: 1, weight: 50 }
    ],
    recommendation: { discard_below_score: 50, visit_score: 60, prioritize_score: 80 }
  }));
  return { inventory, tracker, profile, reportsDir, listings };
}

test("comparison is neutral, explicit about unknowns, and leaves canonical data unchanged", async () => {
  const fixture = await setup();
  for (const listing of fixture.listings) {
    await runTracker({ command: "start", listing: listing.id, inventory: fixture.inventory, tracker: fixture.tracker, now: NOW });
    await runTracker({ command: "transition", listing: listing.id, to: "shortlisted", inventory: fixture.inventory, tracker: fixture.tracker, now: "2026-08-20T13:00:00Z" });
  }
  const inventoryBefore = await readFile(fixture.inventory, "utf8");
  const trackerBefore = await readFile(fixture.tracker, "utf8");
  const result = await runCompare({ shortlist: true, inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, reportsDir: fixture.reportsDir, now: "2026-08-21T12:00:00Z" });
  assert.deepEqual(result.comparison.listings.map((entry) => entry.id), fixture.listings.map((entry) => entry.id).sort());
  assert.equal(result.comparison.listings.find((entry) => entry.title === "Apartment B").property.features.area_total_m2, null);
  assert.equal(await readFile(fixture.inventory, "utf8"), inventoryBefore);
  assert.equal(await readFile(fixture.tracker, "utf8"), trackerBefore);

  const report = await readFile(result.reportPaths.markdownPath, "utf8");
  assert.match(report, /neutral matrix, not a ranking/i);
  assert.match(report, /unknown currency unknown \(price: unknown; currency: unknown\)/);
  assert.match(report, /USD 950/);
  assert.match(report, /UYU 35,000/);
  assert.match(report, /price: reported; currency: reported/);
  assert.match(report, /not converted or ordered/);
  assert.match(report, /dup\\_fixture/);
  const json = JSON.parse(await readFile(result.reportPaths.jsonPath, "utf8"));
  assert.equal(json.listings.length, 2);
  assert.equal(json.listings.every((entry) => entry.duplicate.group_id === "dup_fixture"), true);
});

test("comparison requires at least two distinct listings", async () => {
  const fixture = await setup();
  await assert.rejects(runCompare({ listings: [fixture.listings[0].id], inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, reportsDir: fixture.reportsDir, now: NOW }), /at least two distinct/);
  await assert.rejects(runCompare({ shortlist: true, listings: fixture.listings.map((listing) => listing.id), inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, reportsDir: fixture.reportsDir, now: NOW }), /cannot be combined/);
  await assert.rejects(runCompare({ listings: fixture.listings.map((listing) => listing.id), inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile, reportsDir: fixture.reportsDir, now: "2026-08-20" }), /RFC 3339/);
});
