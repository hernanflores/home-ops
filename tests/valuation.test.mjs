import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { runMarketImport, runMarketSync } from "../scripts/market.mjs";
import { writeInventory } from "../scripts/lib/inventory.mjs";
import { normalizeListing } from "../scripts/lib/normalize.mjs";
import { readMarketObservations } from "../scripts/lib/market-store.mjs";
import { runValuation } from "../scripts/valuation.mjs";

const NOW = "2026-08-20T12:00:00.000Z";
const REGION = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "USD" };
const CONFIG = {
  schema_version: 1,
  minimum_comparables: 5,
  quantiles: { low: 0.25, central: 0.5, high: 0.75 },
  freshness_days: { rent: 90, sale: 180 },
  allow_inferred: false,
  area_basis: {
    apartment: { primary: "area_covered_m2", fallback: "area_total_m2" },
    house: { primary: "area_covered_m2", fallback: null },
    land: { primary: "area_total_m2", fallback: null },
    commercial: { primary: "area_covered_m2", fallback: "area_total_m2" },
    other: { primary: "area_total_m2", fallback: null }
  },
  confidence: { medium_count: 8, high_count: 15, maximum_iqr_to_median: 0.5 }
};

function raw(id, price, area = 50, extra = {}) {
  return {
    id,
    url: `https://example.test/${id}`,
    operation: "sale",
    property_type: "apartment",
    title: `Apartment ${id}`,
    country_code: "UY",
    city: "Montevideo",
    neighborhood: "Cordón",
    price,
    currency: "USD",
    area_covered_m2: area,
    published_at: "2026-08-01T12:00:00Z",
    ...extra
  };
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-valuation-"));
  const inventory = join(directory, "listings.jsonl");
  const observations = join(directory, "market-observations.jsonl");
  const reportsDir = join(directory, "reports");
  const config = join(directory, "valuation.yml");
  const region = join(directory, "region.yml");
  const pricesPerM2 = [1000, 1100, 1200, 1300, 1400];
  const entries = [raw("subject", 75000, 60, { condition: "A estrenar" }), ...pricesPerM2.map((price, index) => raw(`comp-${index}`, price * 50))];
  const listings = entries.map((entry) => normalizeListing({ ...entry, _home_ops_source: { provider: "fixture", retrieved_at: NOW } }, REGION, NOW));
  await writeInventory(inventory, listings);
  await writeFile(config, YAML.stringify(CONFIG));
  await writeFile(region, YAML.stringify({ id: "test" }));
  return { directory, inventory, observations, reportsDir, config, region, listings };
}

test("market sync is idempotent and preserves changed listing snapshots", async () => {
  const fixture = await setup();
  const first = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(first.added.length, 6);
  assert.equal(first.records.find((record) => record.listing_id === fixture.listings[0].id).property.condition, "new");
  const second = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(second.added.length, 0);

  for (const listing of fixture.listings) listing.last_seen_at = "2026-08-21T10:00:00Z";
  await writeInventory(fixture.inventory, fixture.listings);
  const rescanned = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(rescanned.added.length, 0);

  fixture.listings[1].property.pricing.price = 51000;
  fixture.listings[1].last_seen_at = "2026-08-21T12:00:00Z";
  fixture.listings[1].last_changed_at = "2026-08-21T12:00:00Z";
  fixture.listings[1].history.push({ at: "2026-08-21T12:00:00Z", changes: { "property.pricing": { from: { price: 50000 }, to: { price: 51000 } } } });
  await writeInventory(fixture.inventory, fixture.listings);
  const changed = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(changed.added.length, 1);
  assert.equal(changed.records.filter((record) => record.listing_id === fixture.listings[1].id).length, 2);

  fixture.listings[1].property.pricing.price = 50000;
  fixture.listings[1].last_seen_at = "2026-08-22T12:00:00Z";
  fixture.listings[1].last_changed_at = "2026-08-22T12:00:00Z";
  fixture.listings[1].history.push({ at: "2026-08-22T12:00:00Z", changes: { "property.pricing": { from: { price: 51000 }, to: { price: 50000 } } } });
  await writeInventory(fixture.inventory, fixture.listings);
  const reverted = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(reverted.added.length, 1);
  const snapshots = reverted.records.filter((record) => record.listing_id === fixture.listings[1].id);
  assert.equal(snapshots.length, 3);
  assert.equal(new Set(snapshots.map((record) => record.id)).size, 3);
});

test("market sync serializes concurrent writers and reclaims a dead lock", async () => {
  const fixture = await setup();
  const concurrent = await Promise.all([
    runMarketSync({ inventory: fixture.inventory, observations: fixture.observations }),
    runMarketSync({ inventory: fixture.inventory, observations: fixture.observations })
  ]);
  assert.deepEqual(concurrent.map((result) => result.added.length).sort((left, right) => left - right), [0, 6]);
  assert.equal((await readMarketObservations(fixture.observations)).records.length, 6);

  await writeFile(`${fixture.observations}.lock`, "999999 0\n");
  const recovered = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(recovered.added.length, 0);
});

test("closed-sale import requires explicit verified evidence and rejects unsafe source URLs", async () => {
  const fixture = await setup();
  const input = join(fixture.directory, "closed-sales.json");
  const closedSale = {
    evidence_type: "verified_closed_sale",
    observed_at: NOW,
    effective_at: "2026-08-10T12:00:00Z",
    source: { provider: "user-record", external_id: "sale-1", url: "https://evidence.test/sale-1", reference: "registry-document-1" },
    property: {
      operation: "sale",
      property_type: "apartment",
      location: { country_code: "UY", city: "Montevideo", neighborhood: "Cordón" },
      pricing: { price: 60000, currency: "USD" },
      features: { area_total_m2: 50, area_covered_m2: 50 },
      condition: "A estrenar"
    },
    provenance: {
      "property.operation": "verified", "property.property_type": "verified",
      "property.location.country_code": "verified", "property.location.city": "verified",
      "property.location.neighborhood": "verified", "property.pricing.price": "verified",
      "property.pricing.currency": "verified", "property.features.area_covered_m2": "verified"
    },
    verification: { status: "verified", reference: "registry-document-1", verified_at: NOW }
  };
  await writeFile(input, JSON.stringify([closedSale]));
  const imported = await runMarketImport({ input, observations: fixture.observations });
  assert.equal(imported.added.length, 1);
  const importedRecord = (await readMarketObservations(fixture.observations)).records[0];
  assert.equal(importedRecord.evidence_type, "verified_closed_sale");
  assert.equal(importedRecord.property.condition, "new");
  assert.equal(importedRecord.provenance["property.condition"], "reported");

  await writeFile(input, JSON.stringify([{ ...closedSale, evidence_type: undefined }]));
  await assert.rejects(runMarketImport({ input, observations: fixture.observations }), /explicitly declare/);
  await writeFile(input, JSON.stringify([{ ...closedSale, property: { ...closedSale.property, operation: "rent" } }]));
  await assert.rejects(runMarketImport({ input, observations: fixture.observations }), /requires property.operation: sale/);
  await writeFile(input, JSON.stringify([{ ...closedSale, source: { ...closedSale.source, url: "https://user:secret@evidence.test/sale-2" } }]));
  await assert.rejects(runMarketImport({ input, observations: fixture.observations }), /unsafe source URL/);

  await writeFile(input, JSON.stringify([{ ...closedSale, observed_at: "2026-08-21T12:00:00Z" }]));
  await assert.rejects(runMarketImport({ input, observations: fixture.observations }), /Conflicting market observation identity/);
});

test("valuation calculates deterministic asking quantiles and keeps evidence classes separate", async () => {
  const fixture = await setup();
  await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  const inventoryBefore = await readFile(fixture.inventory, "utf8");
  const observationsBefore = await readFile(fixture.observations, "utf8");
  const result = await runValuation({
    listing: fixture.listings[0].id,
    inventory: fixture.inventory,
    observations: fixture.observations,
    config: fixture.config,
    region: fixture.region,
    reportsDir: fixture.reportsDir,
    now: "2026-08-21T12:00:00Z"
  });
  const asking = result.valuation.ranges.find((range) => range.evidence_type === "listing_ask");
  const closed = result.valuation.ranges.find((range) => range.evidence_type === "verified_closed_sale");
  assert.equal(asking.status, "estimated");
  assert.deepEqual(asking.statistics, { low_price_per_m2: 1100, central_price_per_m2: 1200, high_price_per_m2: 1300 });
  assert.deepEqual(asking.estimate, { low: 66000, central: 72000, high: 78000 });
  assert.equal(asking.included.length, 5);
  assert.equal(asking.excluded.find((entry) => entry.listing_id === fixture.listings[0].id).reason, "subject_record");
  assert.equal(closed.status, "insufficient_evidence");
  assert.equal(closed.estimate, null);
  assert.equal(await readFile(fixture.inventory, "utf8"), inventoryBefore);
  assert.equal(await readFile(fixture.observations, "utf8"), observationsBefore);

  const report = await readFile(result.reportPaths.markdownPath, "utf8");
  assert.match(report, /not a professional appraisal/i);
  assert.match(report, /asking prices are not completed transaction prices/i);
  assert.match(report, /never blended/i);
  assert.match(report, /subject\\_record/);
});

test("valuation excludes mismatched and superseded evidence and never fabricates a range", async () => {
  const fixture = await setup();
  await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  fixture.listings[1].property.pricing.price = 51500;
  fixture.listings[1].last_seen_at = "2026-08-21T11:00:00Z";
  fixture.listings[1].last_changed_at = "2026-08-21T11:00:00Z";
  await writeInventory(fixture.inventory, fixture.listings);
  await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  const document = await readFile(fixture.observations, "utf8");
  const records = document.trim().split("\n").map(JSON.parse);
  const mismatches = new Set(fixture.listings.slice(2, 5).map((listing) => listing.id));
  for (const record of records) if (mismatches.has(record.listing_id)) record.property.pricing.currency = "UYU";
  await writeFile(fixture.observations, `${records.map(JSON.stringify).join("\n")}\n`);
  const result = await runValuation({
    listing: fixture.listings[0].id,
    inventory: fixture.inventory,
    observations: fixture.observations,
    config: fixture.config,
    region: fixture.region,
    reportsDir: fixture.reportsDir,
    now: "2026-08-21T12:00:00Z"
  });
  const asking = result.valuation.ranges[0];
  assert.equal(asking.status, "insufficient_evidence");
  assert.equal(asking.estimate, null);
  assert.equal(asking.confidence.label, "insufficient");
  assert.equal(asking.excluded.some((entry) => entry.reason === "currency_mismatch"), true);
  assert.equal(asking.excluded.some((entry) => entry.reason === "superseded"), true);
});

test("valuation counts one representative per duplicate group", async () => {
  const fixture = await setup();
  const extra = normalizeListing({ ...raw("comp-extra", 62500), _home_ops_source: { provider: "fixture", retrieved_at: NOW } }, REGION, NOW);
  fixture.listings.push(extra);
  fixture.listings[1].duplicate = { group_id: "dup_market", confidence: "high", reasons: ["fixture"] };
  extra.duplicate = { group_id: "dup_market", confidence: "high", reasons: ["fixture"] };
  await writeInventory(fixture.inventory, fixture.listings);
  await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  const result = await runValuation({ listing: fixture.listings[0].id, inventory: fixture.inventory, observations: fixture.observations, config: fixture.config, region: fixture.region, reportsDir: fixture.reportsDir, now: "2026-08-21T12:00:00Z" });
  const asking = result.valuation.ranges[0];
  assert.equal(asking.included.length, 5);
  assert.equal(asking.excluded.some((entry) => entry.reason === "duplicate_group"), true);
});

test("zero-price listing evidence is preserved and excluded without aborting sync", async () => {
  const fixture = await setup();
  const zero = normalizeListing({ ...raw("zero-price", 0), _home_ops_source: { provider: "fixture", retrieved_at: NOW } }, REGION, NOW);
  fixture.listings.push(zero);
  await writeInventory(fixture.inventory, fixture.listings);
  const sync = await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  assert.equal(sync.added.length, 7);
  const result = await runValuation({ listing: fixture.listings[0].id, inventory: fixture.inventory, observations: fixture.observations, config: fixture.config, region: fixture.region, reportsDir: fixture.reportsDir, now: "2026-08-21T12:00:00Z" });
  assert.equal(result.valuation.ranges[0].excluded.some((entry) => entry.listing_id === zero.id && entry.reason === "invalid_price"), true);
});

test("rental valuation produces a monthly asking-rent range without a closed-sale range", async () => {
  const fixture = await setup();
  for (const listing of fixture.listings) listing.property.operation = "rent";
  await writeInventory(fixture.inventory, fixture.listings);
  await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  const result = await runValuation({ listing: fixture.listings[0].id, inventory: fixture.inventory, observations: fixture.observations, config: fixture.config, region: fixture.region, reportsDir: fixture.reportsDir, now: "2026-08-21T12:00:00Z" });
  assert.equal(result.valuation.ranges.length, 1);
  assert.equal(result.valuation.ranges[0].evidence_type, "listing_ask");
  assert.equal(result.valuation.ranges[0].status, "estimated");
});

test("valuation validates deterministic time and semantic configuration", async () => {
  const fixture = await setup();
  await runMarketSync({ inventory: fixture.inventory, observations: fixture.observations });
  await assert.rejects(runValuation({ listing: fixture.listings[0].id, inventory: fixture.inventory, observations: fixture.observations, config: fixture.config, region: fixture.region, reportsDir: fixture.reportsDir, now: "2026-08-21" }), /RFC 3339/);
  await writeFile(fixture.config, YAML.stringify({ ...CONFIG, quantiles: { low: 0.75, central: 0.5, high: 0.25 } }));
  await assert.rejects(runValuation({ listing: fixture.listings[0].id, inventory: fixture.inventory, observations: fixture.observations, config: fixture.config, region: fixture.region, reportsDir: fixture.reportsDir, now: NOW }), /low < central < high/);
});
