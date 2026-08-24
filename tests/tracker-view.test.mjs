import assert from "node:assert/strict";
import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { writeInventory } from "../scripts/lib/inventory.mjs";
import { normalizeListing } from "../scripts/lib/normalize.mjs";
import { safeUrl } from "../scripts/lib/tracker-text.mjs";
import {
  buildTrackerView, chartScale, describeFlag, describeMissing, escapeJson,
  fitLabel, fitRank, rankListings, readCeiling, stateLabel
} from "../scripts/lib/tracker-view.mjs";
import { runTracker, runTrackerReport } from "../scripts/tracker.mjs";

const NOW = "2026-08-20T12:00:00.000Z";
const LATER = "2026-10-21T12:00:00.000Z";
const REGION = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "UYU" };

const PROFILE = {
  schema_version: 1,
  name: "View profile",
  stale_after_days: 45,
  hard_filters: [
    { id: "rental", label: "Offered for rent", field: "property.operation", operator: "equals", value: "rent" },
    { id: "maximum-price", label: "Monthly price at most UYU 30000", field: "property.pricing.price", operator: "at_most", value: 30000, currency: "UYU" }
  ],
  weighted_criteria: [
    { id: "area", label: "At least 40 square meters", field: "property.features.area_total_m2", operator: "at_least", value: 40, weight: 60 },
    { id: "parking", label: "At least one parking space", field: "property.features.parking_spaces", operator: "at_least", value: 1, weight: 40 }
  ],
  recommendation: { discard_below_score: 20, visit_score: 50, prioritize_score: 80 }
};

function listingInput(overrides) {
  return normalizeListing({
    operation: "rent", property_type: "apartment", city: "Montevideo",
    bedrooms: 1, bathrooms: 1, parking_spaces: 1, currency: "UYU",
    _home_ops_source: { provider: "fixture", retrieved_at: NOW },
    ...overrides
  }, REGION, NOW);
}

async function setup(listings) {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-view-"));
  const fixture = {
    directory,
    inventory: join(directory, "listings.jsonl"),
    tracker: join(directory, "tracker.jsonl"),
    profile: join(directory, "profile.yml"),
    output: join(directory, "tracker.md"),
    htmlOutput: join(directory, "tracker.html"),
    listings,
    id: (externalId) => listings.find((listing) => listing.source.external_id === externalId).id
  };
  await writeInventory(fixture.inventory, listings);
  await writeFile(fixture.profile, YAML.stringify(PROFILE));
  for (const listing of listings) {
    await runTracker({ command: "start", listing: listing.id, inventory: fixture.inventory, tracker: fixture.tracker, now: NOW });
  }
  return fixture;
}

function reportOptions(fixture, extra = {}) {
  return {
    inventory: fixture.inventory, tracker: fixture.tracker, profile: fixture.profile,
    output: fixture.output, now: LATER, ...extra
  };
}

// --- Plain-language rules -------------------------------------------------

test("every recommendation and every tracker state maps to a label", () => {
  assert.deepEqual(
    ["prioritize", "visit", "monitor", "discard"].map(fitLabel),
    ["Great fit", "Worth a look", "Needs a closer look", "Skip"]
  );
  assert.deepEqual(["prioritize", "visit", "monitor", "discard"].map(fitRank), [3, 2, 1, 0]);
  assert.deepEqual(
    ["watching", "shortlisted", "contacted", "visited", "archived"].map(stateLabel),
    ["still watching", "shortlisted", "contacted", "visited", "ruled out"]
  );
});

test("each red flag shape produces its short form and keeps the original verbatim", () => {
  const fields = new Map([["Monthly price at most UYU 30000", "property.pricing.price"]]);
  const cases = [
    ["Listing may be stale (54 days; basis: published_at)", "Posted 54 days ago"],
    ["Freshness timestamp is in the future (basis: retrieved_at)", "Listing date looks wrong"],
    ["Possible duplicate record dup_1 (high confidence)", "May be the same place as another listing"],
    ["No source URL is available for verification", "No link to the original"],
    ["Failed hard filter: Monthly price at most UYU 30000", "Over your budget"],
    ["Maximum possible weighted score 45% is below the 50% discard floor", "Matches too little of what you want"]
  ];
  for (const [source, short] of cases) {
    const described = describeFlag(source, fields);
    assert.equal(described.short, short, source);
    assert.equal(described.full, source, "the original must survive for the tooltip");
  }
  // The basis clause and the score numbers are reachable only through the tooltip.
  assert.doesNotMatch(describeFlag(cases[0][0], fields).short, /basis/);
  assert.doesNotMatch(describeFlag(cases[5][0], fields).short, /\d/);
});

test("each missing-data shape shows its label and hides the field path", () => {
  const cases = [
    ["At least 40 square meters: property.features.area_total_m2 is unknown", "Size not listed"],
    ["Offered for rent: property.operation is inferred but this criterion does not allow inferred evidence", "Some details unconfirmed"],
    ["Monthly price at most UYU 30000: currency is USD, not UYU; HomeOps does not convert currencies", "Priced in USD"],
    ["Monthly price at most UYU 30000: property.pricing.currency is unknown; UYU comparison was not performed", "Currency not listed"]
  ];
  for (const [source, short] of cases) {
    const described = describeMissing(source);
    assert.equal(described.short, short, source);
    assert.equal(described.full, source);
    assert.doesNotMatch(described.short, /property\./, "no field path may reach the reader");
  }
});

test("an unrecognised warning survives verbatim rather than being dropped", () => {
  const invented = "Some future check nobody has written a phrase for yet";
  assert.deepEqual(describeFlag(invented), { short: invented, full: invented, advice: null });
  assert.equal(describeMissing(invented).short, invented);
  assert.equal(describeMissing(invented).full, invented);
});

// --- Ceiling and scale ----------------------------------------------------

test("the ceiling comes from the profile value and fails loudly when it cannot", () => {
  assert.deepEqual(readCeiling(PROFILE), { amount: 30000, currency: "UYU" });
  // The label is stale in real profiles; the value is the truth.
  const stale = { ...PROFILE, hard_filters: [{ ...PROFILE.hard_filters[1], label: "Monthly price at most UYU 1" }] };
  assert.equal(readCeiling(stale).amount, 30000);

  assert.throws(() => readCeiling({ hard_filters: [] }), /exactly one monthly price hard filter/);
  assert.throws(() => readCeiling({ hard_filters: [PROFILE.hard_filters[1], PROFILE.hard_filters[1]] }), /exactly one monthly price hard filter/);
  assert.throws(() => readCeiling({ hard_filters: [{ ...PROFILE.hard_filters[1], value: "cheap" }] }), /numeric value/);
});

test("the chart scale is shared, rounded outward, and always contains the ceiling", () => {
  const scale = chartScale([18000, 22500, 44000], 38000);
  assert.ok(scale.min <= 18000, "rounds outward below the cheapest");
  assert.ok(scale.max >= 44000, "rounds outward above the dearest");
  assert.ok(scale.min <= 38000 && scale.max >= 38000, "the ceiling line must land on the canvas");
  // A ceiling far outside the data still widens the domain rather than falling off it.
  const wide = chartScale([1000, 1200], 90000);
  assert.ok(wide.max >= 90000);
  assert.equal(chartScale([], null).ticks.length, 2, "an empty tracker still yields a usable scale");
});

// --- Sorting and nulls ----------------------------------------------------

test("null price and area never sort as zero", () => {
  const items = [
    { id: "a", fitRank: 2, score: 50, price: null, area: null },
    { id: "b", fitRank: 2, score: 50, price: 30000, area: 40 },
    { id: "c", fitRank: 2, score: 50, price: 10000, area: 90 }
  ];
  const ranked = rankListings(items);
  assert.deepEqual(ranked.map((item) => item.id), ["c", "b", "a"], "a null price sorts last, not first");
});

test("null area, price and expenses read as not listed and do not lead a space sort", async () => {
  const fixture = await setup([
    listingInput({ id: "no-size", url: "https://example.test/no-size", title: "No size given", neighborhood: "Cordón", price: 20000, area_total_m2: null }),
    listingInput({ id: "sized", url: "https://example.test/sized", title: "Sized", neighborhood: "Cordón", price: 21000, area_total_m2: 55 })
  ]);
  const result = await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  const html = await readFile(result.viewPath, "utf8");
  assert.match(html, /size not listed/);
  assert.match(html, /expenses not listed/);
  // A null area is an empty data attribute, never a zero the client could sort on.
  const noSize = fixture.id("no-size");
  assert.match(html, new RegExp(`data-id="${noSize}"[^>]*data-area=""`));
  assert.doesNotMatch(html, new RegExp(`data-id="${noSize}"[^>]*data-area="0"`));
});

// --- Currency separation --------------------------------------------------

test("foreign-currency listings stay out of the ranked set and out of the chart", async () => {
  const fixture = await setup([
    listingInput({ id: "local", url: "https://example.test/local", title: "Local", neighborhood: "Cordón", price: 20000, area_total_m2: 50 }),
    listingInput({ id: "abroad", url: "https://example.test/abroad", title: "Abroad", neighborhood: "Pocitos", price: 900, currency: "USD", area_total_m2: 50 })
  ]);
  const result = await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  const html = await readFile(result.viewPath, "utf8");
  const view = JSON.parse(/id="tracker-view">(.*?)<\/script>/s.exec(html)[1]);

  const local = fixture.id("local");
  const abroad = fixture.id("abroad");
  const rankedIds = view.buckets.flatMap((bucket) => bucket.items.map((item) => item.id));
  assert.ok(!rankedIds.includes(abroad), "never interleaved with the ranked buckets");
  assert.deepEqual(view.foreign.map((item) => item.id), [abroad]);
  assert.equal(view.meta.counts.foreignCurrency, 1);

  const charted = view.chart.rows.flatMap((row) => row.dots.map((dot) => dot.id));
  assert.deepEqual(charted, [local], "the chart holds only profile-currency listings");
  assert.match(html, /kept out of this chart/, "the exclusion is visible, not silent");
  assert.match(html, /never converts currencies/);
  assert.doesNotMatch(html, /approx|≈|estimated at/i, "no conversion, not even an estimate");
});

// --- Untrusted input ------------------------------------------------------

test("a hostile title and a javascript: URL both come out inert", async () => {
  const hostile = '</script><script>alert(1)</script>"><img src=x onerror=alert(2)>';
  const fixture = await setup([
    listingInput({ id: "hostile", url: "https://example.test/hostile", title: hostile, neighborhood: "Cordón", price: 20000, area_total_m2: 50 })
  ]);
  const result = await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  const html = await readFile(result.viewPath, "utf8");

  assert.ok(html.includes(hostile) === false, "the raw hostile string never appears");
  assert.equal(html.match(/<script/g).length, 2, "only the JSON block and the client script");
  // The payload survives as inert text, never as markup the browser would act on.
  assert.doesNotMatch(html, /<img /, "no injected element");
  assert.match(html, /&lt;img src=x onerror=alert\(2\)&gt;/, "escaped into text instead");
  // The JSON island is escaped so it cannot terminate its own script element.
  const json = /id="tracker-view">(.*?)<\/script>/s.exec(html)[1];
  assert.doesNotMatch(json, /</);
  assert.equal(JSON.parse(json).listings[0].title, hostile, "escaped for transport, not corrupted");

  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://user:pass@example.test/x"), null);
  const view = buildTrackerView({
    now: NOW, trackerPath: "t", inventoryPath: "i", profile: PROFILE,
    records: [{ listing_id: "x", state: "watching", availability: "unknown", updated_at: NOW, events: [{ id: "evt_0", type: "tracking_started", recorded_at: NOW, payload: {} }] }],
    listings: [{
      id: "x",
      property: { title: "T", operation: "rent", property_type: "apartment", location: { neighborhood: "N", city: "C", address: null }, pricing: { price: 1, currency: "UYU", expenses: null, expenses_currency: null }, features: { bedrooms: 1, bathrooms: 1, area_total_m2: null, area_covered_m2: null, parking_spaces: null } },
      source: { provider: "p", url: "javascript:alert(1)", external_id: null },
      duplicate: { group_id: null, confidence: "none", reasons: [] }
    }],
    evaluations: [{ listing: { id: "x" }, recommendation: "monitor", eligibility: "eligible", matches: [], trade_offs: [], missing_data: [], red_flags: [], questions: [], hard_filters: [], score: { percentage: 0, criteria: [] } }]
  });
  assert.equal(view.listings[0].url, null, "a rejected URL is dropped, not rendered inert");
  assert.doesNotMatch(escapeJson({ a: "</script>" }), /<\/script>/);
});

// --- Artifact invariants --------------------------------------------------

test("generating twice over unchanged inputs yields identical bytes and touches no canonical file", async () => {
  const fixture = await setup([
    listingInput({ id: "one", url: "https://example.test/one", title: "One", neighborhood: "Cordón", price: 20000, area_total_m2: 50 }),
    listingInput({ id: "two", url: "https://example.test/two", title: "Two", neighborhood: "Pocitos", price: 26000, area_total_m2: null })
  ]);
  const inventoryBefore = await readFile(fixture.inventory, "utf8");
  const trackerBefore = await readFile(fixture.tracker, "utf8");
  const profileBefore = await readFile(fixture.profile, "utf8");

  await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  const first = await readFile(fixture.htmlOutput, "utf8");
  await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  const second = await readFile(fixture.htmlOutput, "utf8");

  assert.equal(second, first, "same inputs must produce byte-identical output");
  assert.equal(await readFile(fixture.inventory, "utf8"), inventoryBefore);
  assert.equal(await readFile(fixture.tracker, "utf8"), trackerBefore);
  assert.equal(await readFile(fixture.profile, "utf8"), profileBefore);
});

test("the view is read-only, private, and works without JavaScript", async () => {
  const fixture = await setup([
    listingInput({ id: "one", url: "https://example.test/one", title: "One", neighborhood: "Cordón", price: 20000, area_total_m2: 50 })
  ]);
  const result = await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  const html = await readFile(result.viewPath, "utf8");

  assert.match(html, /contains private search data/);
  assert.match(html, /Nothing on this page can change the tracker/);
  assert.match(html, /Snapshot generated/);
  assert.match(html, /nobody has been contacted/);
  // No network at runtime: nothing may be fetched when the file is opened.
  assert.doesNotMatch(html, /<link[^>]+href=/);
  assert.doesNotMatch(html, /src="http/);
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|@import/);
  // Every screen is server-rendered, so the list is readable with the script disabled.
  for (const id of ["screen-list", "screen-detail", "screen-budget"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /rel="noopener noreferrer"/);
  // Score, coverage and eligibility never reach the reader.
  assert.doesNotMatch(html, /coverage|eligibility|maximum_possible/i);
});

test("the html output cannot overwrite a canonical input, the profile, or the markdown report", async () => {
  const fixture = await setup([
    listingInput({ id: "one", url: "https://example.test/one", title: "One", neighborhood: "Cordón", price: 20000, area_total_m2: 50 })
  ]);
  const trackerBefore = await readFile(fixture.tracker, "utf8");

  for (const target of [fixture.tracker, fixture.inventory, fixture.profile]) {
    await assert.rejects(runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: target })), /must not overwrite a canonical input or profile/);
  }
  await assert.rejects(
    runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.output })),
    /must not overwrite the tracker report/
  );
  const alias = join(fixture.directory, "directory-alias");
  await symlink(fixture.directory, alias, "dir");
  await assert.rejects(
    runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: join(alias, "tracker.jsonl") })),
    /must not overwrite a canonical input or profile/
  );
  assert.equal(await readFile(fixture.tracker, "utf8"), trackerBefore);
});

test("report without --html writes no view and leaves the markdown report unchanged", async () => {
  const fixture = await setup([
    listingInput({ id: "one", url: "https://example.test/one", title: "One", neighborhood: "Cordón", price: 20000, area_total_m2: 50 })
  ]);
  const plain = await runTrackerReport(reportOptions(fixture));
  assert.equal(plain.viewPath, null, "no view path is produced without --html");
  await assert.rejects(readFile(fixture.htmlOutput, "utf8"), /ENOENT/);
  const markdownOnly = await readFile(fixture.output, "utf8");

  await runTrackerReport(reportOptions(fixture, { html: true, htmlOutput: fixture.htmlOutput }));
  assert.equal(await readFile(fixture.output, "utf8"), markdownOnly, "adding --html must not change the markdown report");
});
