import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { runScan } from "../scripts/scan.mjs";
import { assignDuplicateGroups } from "../scripts/lib/deduplicate.mjs";
import { normalizeListing } from "../scripts/lib/normalize.mjs";

const FIXTURES = resolve("tests/fixtures");

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-"));
  const jsonPath = join(directory, "portal-a.json");
  const csvPath = join(directory, "portal-b.csv");
  await writeFile(jsonPath, await readFile(join(FIXTURES, "portal-a.json"), "utf8"));
  await writeFile(csvPath, await readFile(join(FIXTURES, "portal-b.csv"), "utf8"));
  const configPath = join(directory, "config.yml");
  await writeFile(configPath, YAML.stringify({
    region: "uy-montevideo",
    inventory: join(directory, "listings.jsonl"),
    reports_dir: join(directory, "reports"),
    cache_dir: join(directory, "cache"),
    provider_runs: join(directory, "provider-runs.jsonl"),
    freshness: { stale_after_days: 45 },
    sources: [
      { type: "local-json", path: jsonPath, provider: "portal-a" },
      { type: "local-csv", path: csvPath, provider: "portal-b" }
    ]
  }));
  return { directory, configPath, jsonPath };
}

test("scan normalizes, validates, reports and groups cross-source duplicates", async () => {
  const fixture = await setup();
  const result = await runScan({ config: fixture.configPath, now: "2026-08-19T12:00:00.000Z" });

  assert.equal(result.listings.length, 3);
  assert.equal(result.touched.filter((listing) => listing.status === "new").length, 3);
  const primary = result.listings.find((listing) => listing.source.external_id === "a-100");
  const duplicate = result.listings.find((listing) => listing.source.external_id === "b-900");
  const stale = result.listings.find((listing) => listing.source.external_id === "a-200");
  assert.equal(primary.source.url, "https://example.test/a-100");
  assert.equal(primary.property.pricing.price, 1200);
  assert.equal(primary.property.pricing.expenses, 8500);
  assert.equal(primary.provenance["property.location.country_code"], "inferred");
  assert.equal(primary.duplicate.group_id, duplicate.duplicate.group_id);
  assert.equal(primary.duplicate.confidence, "high");
  assert.equal(stale.freshness.state, "potentially_stale");

  const report = await readFile(result.reportPath, "utf8");
  assert.match(report, /\*\*New:\*\* 3/);
  assert.match(report, /Duplicate Candidates/);
  assert.match(report, /Potentially stale:\*\* 1/);
});

test("re-import is idempotent and records later changes", async () => {
  const fixture = await setup();
  const first = await runScan({ config: fixture.configPath, now: "2026-08-19T12:00:00.000Z" });
  const second = await runScan({ config: fixture.configPath, now: "2026-08-20T12:00:00.000Z" });

  assert.deepEqual(second.listings.map((listing) => listing.id), first.listings.map((listing) => listing.id));
  assert.equal(second.touched.every((listing) => listing.status === "unchanged"), true);

  const payload = JSON.parse(await readFile(fixture.jsonPath, "utf8"));
  payload.listings[0].price = 1150;
  await writeFile(fixture.jsonPath, JSON.stringify(payload));
  const third = await runScan({ config: fixture.configPath, now: "2026-08-21T12:00:00.000Z" });
  const changed = third.listings.find((listing) => listing.source.external_id === "a-100");

  assert.equal(changed.status, "updated");
  assert.equal(changed.property.pricing.price, 1150);
  assert.equal(changed.history.length, 1);
  assert.deepEqual(changed.history[0].changes["property.pricing"].from.price, 1200);
  assert.deepEqual(changed.history[0].changes["property.pricing"].to.price, 1150);
});

test("same URL is an exact duplicate across providers without property details", () => {
  const region = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "USD" };
  const now = "2026-08-19T12:00:00.000Z";
  const left = normalizeListing({
    url: "https://example.test/listing/42?utm_source=one",
    _home_ops_source: { provider: "one", retrieved_at: now }
  }, region, now);
  const right = normalizeListing({
    url: "https://example.test/listing/42?utm_medium=two",
    _home_ops_source: { provider: "two", retrieved_at: now }
  }, region, now);

  assignDuplicateGroups([left, right]);
  assert.equal(left.duplicate.group_id, right.duplicate.group_id);
  assert.equal(left.duplicate.confidence, "high");
  assert.deepEqual(left.duplicate.reasons, ["same normalized source URL"]);
});

test("listing URLs never retain credentials or secret query parameters", () => {
  const region = { id: "uy-montevideo", country_code: "UY", city: "Montevideo", currency: "USD" };
  const now = "2026-08-19T12:00:00.000Z";
  const listing = normalizeListing({
    id: "secret-url",
    url: "https://user:password@example.test/listing/1?access_token=secret",
    nested: { authorization: "Bearer abc.def", password: "secret", api_key: "secret" },
    _home_ops_source: { provider: "local", retrieved_at: now }
  }, region, now);
  assert.equal(listing.source.url, null);
  assert.equal(listing.original.url, "https://example.test/listing/1?access_token=%5BREDACTED%5D");
  assert.equal(listing.original.nested.authorization, "[REDACTED]");
  assert.equal(listing.original.nested.password, "[REDACTED]");
  assert.equal(listing.original.nested.api_key, "[REDACTED]");
});
