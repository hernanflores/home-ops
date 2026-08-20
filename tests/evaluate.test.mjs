import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { runEvaluate } from "../scripts/evaluate.mjs";
import { evaluateListing, validateProfileSemantics } from "../scripts/lib/evaluate.mjs";
import { applyFreshness, normalizeListing } from "../scripts/lib/normalize.mjs";
import { createListingValidator } from "../scripts/lib/validate.mjs";

const FIXTURES = resolve("tests/fixtures");
const NOW = "2026-08-20T12:00:00.000Z";
const REGION = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "USD" };

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-evaluate-"));
  const profilePath = join(directory, "profile.yml");
  const inventoryPath = join(directory, "listings.jsonl");
  const trackerPath = join(directory, "tracker.jsonl");
  const reportsDir = join(directory, "reports");
  await writeFile(profilePath, await readFile(join(FIXTURES, "evaluation-profile.yml"), "utf8"));
  const raw = JSON.parse(await readFile(join(FIXTURES, "evaluation-listings.json"), "utf8"));
  const listings = raw.map((entry) => {
    const listing = normalizeListing({
      ...entry,
      _home_ops_source: { provider: "evaluation-fixture", retrieved_at: NOW }
    }, REGION, NOW);
    listing.freshness = applyFreshness(listing, NOW, 45);
    return listing;
  });
  await writeFile(inventoryPath, `${listings.map((listing) => JSON.stringify(listing)).join("\n")}\n`);
  return { directory, profilePath, inventoryPath, trackerPath, reportsDir, listings };
}

test("evaluate produces deterministic tri-state results, scores, and recommendations", async () => {
  const fixture = await setup();
  const before = await readFile(fixture.inventoryPath, "utf8");
  const first = await runEvaluate({
    profile: fixture.profilePath,
    inventory: fixture.inventoryPath,
    tracker: fixture.trackerPath,
    reportsDir: fixture.reportsDir,
    now: NOW
  });
  const second = await runEvaluate({
    profile: fixture.profilePath,
    inventory: fixture.inventoryPath,
    tracker: fixture.trackerPath,
    reportsDir: fixture.reportsDir,
    now: NOW
  });

  assert.deepEqual(second.evaluations, first.evaluations);
  assert.equal(first.trackerSync.added.length, 2);
  assert.equal(second.trackerSync.added.length, 0);
  assert.equal(second.trackerSync.records.length, 2);
  assert.ok(second.trackerSync.records.every((record) => record.state === "watching"));
  assert.equal(await readFile(fixture.inventoryPath, "utf8"), before);
  const passed = first.evaluations.find((evaluation) => evaluation.listing.source_url.endsWith("evaluation-pass"));
  const failed = first.evaluations.find((evaluation) => evaluation.listing.source_url.endsWith("evaluation-fail"));
  const unknown = first.evaluations.find((evaluation) => evaluation.listing.source_url.endsWith("evaluation-unknown"));

  assert.equal(passed.eligibility, "eligible");
  assert.deepEqual(passed.score, {
    earned: 80,
    maximum: 100,
    percentage: 80,
    evidence_weight: 80,
    coverage_percentage: 80,
    maximum_possible_earned: 100,
    maximum_possible_percentage: 100,
    criteria: passed.score.criteria
  });
  assert.equal(passed.recommendation, "prioritize");
  assert.equal(passed.score.criteria.find((criterion) => criterion.id === "parking").outcome, "unknown");
  assert.match(passed.questions[0], /owner or broker confirm/);

  assert.equal(failed.eligibility, "ineligible");
  assert.equal(failed.recommendation, "discard");
  assert.match(failed.red_flags.join("\n"), /Failed hard filter/);

  assert.equal(unknown.eligibility, "indeterminate");
  assert.equal(unknown.recommendation, "monitor");
  assert.equal(unknown.hard_filters.find((criterion) => criterion.id === "budget").outcome, "unknown");
  const normalizedUnknown = fixture.listings.find((listing) => listing.source.url.endsWith("evaluation-unknown"));
  assert.equal(normalizedUnknown.provenance["property.pricing.price"], "unknown");
  assert.ok(normalizedUnknown.unknown_fields.includes("property.pricing.price"));
});

test("evaluation reports link canonical and source evidence and preserve uncertainty", async () => {
  const fixture = await setup();
  const target = fixture.listings.find((listing) => listing.source.url.endsWith("evaluation-pass"));
  const result = await runEvaluate({
    profile: fixture.profilePath,
    inventory: fixture.inventoryPath,
    listing: target.id,
    reportsDir: fixture.reportsDir,
    now: NOW
  });
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.trackerSync, null);

  const markdown = await readFile(result.reportPaths[0].markdownPath, "utf8");
  const json = JSON.parse(await readFile(result.reportPaths[0].jsonPath, "utf8"));
  assert.match(markdown, new RegExp(target.id));
  assert.match(markdown, /https:\/\/example\.test\/evaluation-pass/);
  assert.match(markdown, /Evidence coverage/);
  assert.match(markdown, /Maximum possible score/);
  assert.match(markdown, /did not contact an owner or broker/);
  assert.equal(json.listing.id, target.id);
  assert.equal(json.recommendation, "prioritize");
});

test("currency mismatch and disallowed inferred evidence remain unknown", () => {
  const listing = normalizeListing({
    id: "currency",
    operation: "rent",
    price: 1000,
    currency: "UYU",
    city: "Montevideo",
    _home_ops_source: { provider: "test", retrieved_at: NOW }
  }, REGION, NOW);
  const profile = {
    schema_version: 1,
    name: "Currency",
    stale_after_days: 45,
    hard_filters: [{
      id: "budget", label: "USD budget", field: "property.pricing.price",
      operator: "at_most", value: 1500, currency: "USD"
    }, {
      id: "country", label: "Uruguay", field: "property.location.country_code",
      operator: "equals", value: "UY"
    }],
    weighted_criteria: [{ id: "bedrooms", label: "Bedroom", field: "property.features.bedrooms", operator: "at_least", value: 1, weight: 1 }],
    recommendation: { visit_score: 60, prioritize_score: 80 }
  };
  const evaluation = evaluateListing(listing, profile, { now: NOW, profilePath: "profile.yml", inventoryPath: "listings.jsonl" });
  assert.equal(evaluation.eligibility, "indeterminate");
  assert.match(evaluation.hard_filters[0].reason, /does not convert currencies/);
  assert.match(evaluation.hard_filters[1].reason, /inferred/);
});

test("location comparisons ignore accents without using fuzzy matching", () => {
  const listing = normalizeListing({
    id: "location",
    neighborhood: "Morón",
    _home_ops_source: { provider: "test", retrieved_at: NOW }
  }, REGION, NOW);
  const profile = {
    schema_version: 1,
    name: "Location normalization",
    stale_after_days: 45,
    hard_filters: [],
    weighted_criteria: [{
      id: "accent", label: "Moron", field: "property.location.neighborhood",
      operator: "one_of", value: ["Moron"], weight: 1
    }, {
      id: "distinct", label: "Moron Norte", field: "property.location.neighborhood",
      operator: "equals", value: "Moron Norte", weight: 1
    }],
    recommendation: { visit_score: 50, prioritize_score: 100 }
  };

  const evaluation = evaluateListing(listing, profile, {
    now: NOW,
    profilePath: "profile.yml",
    inventoryPath: "listings.jsonl"
  });
  assert.equal(evaluation.score.criteria[0].outcome, "pass");
  assert.equal(evaluation.score.criteria[1].outcome, "fail");
  assert.equal(evaluation.score.percentage, 50);
});

test("score floor discards only when unknown evidence cannot recover the fit", () => {
  const profile = {
    schema_version: 1,
    name: "Score floor",
    stale_after_days: 45,
    hard_filters: [],
    weighted_criteria: [{
      id: "bedrooms", label: "At most two bedrooms", field: "property.features.bedrooms",
      operator: "at_most", value: 2, weight: 50
    }, {
      id: "parking", label: "Has parking", field: "property.features.parking_spaces",
      operator: "at_least", value: 1, weight: 50
    }],
    recommendation: { discard_below_score: 50, visit_score: 60, prioritize_score: 80 }
  };
  const context = { now: NOW, profilePath: "profile.yml", inventoryPath: "listings.jsonl" };
  const lowFit = normalizeListing({
    id: "low-fit", bedrooms: 3, parking_spaces: 0,
    _home_ops_source: { provider: "test", retrieved_at: NOW }
  }, REGION, NOW);
  const recoverable = normalizeListing({
    id: "recoverable", bedrooms: 3,
    _home_ops_source: { provider: "test", retrieved_at: NOW }
  }, REGION, NOW);

  const discarded = evaluateListing(lowFit, profile, context);
  assert.equal(discarded.score.percentage, 0);
  assert.equal(discarded.score.maximum_possible_percentage, 0);
  assert.equal(discarded.recommendation, "discard");
  assert.match(discarded.red_flags.join("\n"), /below the 50% discard floor/);

  const monitored = evaluateListing(recoverable, profile, context);
  assert.equal(monitored.score.percentage, 0);
  assert.equal(monitored.score.maximum_possible_percentage, 50);
  assert.equal(monitored.recommendation, "monitor");
});

test("regional aliases produce canonical neighborhood labels", () => {
  const listing = normalizeListing({
    id: "alias",
    neighborhood: "Pta. Carretas",
    _home_ops_source: { provider: "test", retrieved_at: NOW }
  }, {
    ...REGION,
    neighborhood_aliases: { pta_carretas: "Punta Carretas" }
  }, NOW);

  assert.equal(listing.property.location.neighborhood, "Punta Carretas");
  assert.equal(listing.provenance["property.location.neighborhood"], "reported");
});

test("profile semantic validation rejects ambiguous scoring configuration", () => {
  const profile = {
    schema_version: 1,
    name: "Invalid",
    stale_after_days: 45,
    hard_filters: [{ id: "budget", label: "Budget", field: "property.pricing.price", operator: "at_most", value: 1000 }],
    weighted_criteria: [{ id: "bedrooms", label: "Bedroom", field: "property.features.bedrooms", operator: "at_least", value: 1, weight: 1 }],
    recommendation: { visit_score: 80, prioritize_score: 60 }
  };
  assert.throws(() => validateProfileSemantics(profile), /requires currency/);
  profile.hard_filters[0].currency = "USD";
  assert.throws(() => validateProfileSemantics(profile), /prioritize_score/);
  profile.recommendation = { visit_score: 60, prioritize_score: 80 };
  profile.weighted_criteria[0] = { id: "bedrooms", label: "Bedroom", field: "property.features.bedrooms", operator: "equals", value: "1", weight: 1 };
  assert.throws(() => validateProfileSemantics(profile), /requires a numeric value/);
  profile.weighted_criteria[0] = { id: "bedrooms", label: "Bedroom", field: "property.features.bedrooms", operator: "at_least", value: 1, weight: 1 };
  profile.recommendation = { discard_below_score: 61, visit_score: 60, prioritize_score: 80 };
  assert.throws(() => validateProfileSemantics(profile), /discard_below_score/);
});

test("evaluation recalculates freshness at evaluation time", async () => {
  const fixture = await setup();
  const profile = YAML.parse(await readFile(fixture.profilePath, "utf8"));
  const listing = fixture.listings.find((entry) => entry.source.url.endsWith("evaluation-pass"));
  assert.equal(listing.freshness.state, "fresh");
  const evaluation = evaluateListing(listing, profile, {
    now: "2026-10-20T12:00:00.000Z",
    profilePath: fixture.profilePath,
    inventoryPath: fixture.inventoryPath
  });
  assert.match(evaluation.red_flags.join("\n"), /Listing may be stale \(66 days/);
});

test("future publication timestamps produce unknown freshness and a red flag", async () => {
  const fixture = await setup();
  const profile = YAML.parse(await readFile(fixture.profilePath, "utf8"));
  profile.hard_filters.push({ id: "fresh", label: "Currently fresh", field: "freshness.state", operator: "equals", value: "fresh" });
  const listing = fixture.listings.find((entry) => entry.source.url.endsWith("evaluation-pass"));
  listing.source.published_at = "2030-01-01T00:00:00.000Z";
  const evaluation = evaluateListing(listing, profile, { now: NOW, profilePath: "profile.yml", inventoryPath: "listings.jsonl" });
  assert.equal(evaluation.eligibility, "indeterminate");
  assert.equal(evaluation.hard_filters.find((result) => result.id === "fresh").outcome, "unknown");
  assert.match(evaluation.red_flags.join("\n"), /timestamp is in the future/);
});

test("malformed explicit currency remains inferred and cannot silently pass", () => {
  const listing = normalizeListing({
    id: "bad-currency",
    operation: "rent",
    price: 1000,
    currency: "not-a-currency",
    bedrooms: 2,
    _home_ops_source: { provider: "test", retrieved_at: NOW }
  }, REGION, NOW);
  assert.equal(listing.property.pricing.currency, "USD");
  assert.equal(listing.provenance["property.pricing.currency"], "inferred");
  const profile = YAML.parse(`
schema_version: 1
name: Currency inference
stale_after_days: 45
hard_filters:
  - id: budget
    label: USD budget
    field: property.pricing.price
    operator: at_most
    value: 1500
    currency: USD
weighted_criteria:
  - id: bedrooms
    label: Bedrooms
    field: property.features.bedrooms
    operator: at_least
    value: 1
    weight: 1
recommendation:
  visit_score: 60
  prioritize_score: 80
`);
  const evaluation = evaluateListing(listing, profile, { now: NOW, profilePath: "profile.yml", inventoryPath: "listings.jsonl" });
  assert.equal(evaluation.eligibility, "indeterminate");
  assert.match(evaluation.hard_filters[0].reason, /currency.*inferred/);
});

test("canonical validation rejects source URLs carrying credentials or secrets", async () => {
  const fixture = await setup();
  const validate = await createListingValidator(resolve("schemas/listing.schema.json"));
  const listing = structuredClone(fixture.listings[0]);
  listing.source.url = "https://user:password@example.test/listing";
  assert.throws(() => validate(listing), /unsafe source URL/);
  listing.source.url = "https://example.test/listing?access_token=secret";
  assert.throws(() => validate(listing), /unsafe source URL/);
});
