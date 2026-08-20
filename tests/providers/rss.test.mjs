import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { parseFeed } from "../../providers/rss.mjs";
import { runScan } from "../../scripts/scan.mjs";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:property="https://example.test/property">
  <channel>
    <title>Example properties</title>
    <item>
      <guid>feed-101</guid>
      <title>Apartamento &amp; terraza</title>
      <link>https://agency.example.test/listings/101?utm_source=feed</link>
      <pubDate>Tue, 18 Aug 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>Dos dormitorios.</p>]]></description>
      <property:price>1450</property:price>
      <property:currency>USD</property:currency>
      <property:neighborhood>Pocitos</property:neighborhood>
      <property:bedrooms>2</property:bedrooms>
      <property:area>72</property:area>
    </item>
  </channel>
</rss>`;
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];

function rssSource(overrides = {}) {
  return {
    id: "agency-feed",
    type: "rss",
    url: "https://agency.example.test/properties.xml",
    provider: "example-agency",
    compliance: { confirmed: true, terms_url: "https://agency.example.test/terms", reviewed_at: "2026-08-19" },
    defaults: { operation: "rent", property_type: "apartment", country_code: "UY", city: "Montevideo" },
    mapping: { price: "price", currency: "currency", neighborhood: "neighborhood", bedrooms: "bedrooms", area_total_m2: "area" },
    min_interval_ms: 0,
    ...overrides
  };
}

async function setup(sources = [rssSource()]) {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-rss-"));
  const config = join(directory, "config.yml");
  await writeFile(config, YAML.stringify({
    region: "uy-montevideo",
    inventory: join(directory, "listings.jsonl"),
    reports_dir: join(directory, "reports"),
    cache_dir: join(directory, "cache"),
    provider_runs: join(directory, "provider-runs.jsonl"),
    sources
  }));
  return { directory, config, inventory: join(directory, "listings.jsonl") };
}

test("RSS parser maps namespaced fields without inventing missing values", () => {
  const [listing] = parseFeed(RSS, rssSource(), "2026-08-19T12:00:00.000Z");
  assert.equal(listing.external_id, "feed-101");
  assert.equal(listing.title, "Apartamento & terraza");
  assert.equal(listing.description, "Dos dormitorios.");
  assert.equal(listing.price, 1450);
  assert.equal(listing.neighborhood, "Pocitos");
  assert.equal(listing.bathrooms, undefined);
  assert.equal(listing._home_ops_source.provider, "example-agency");
});

test("RSS provider scans end to end and reuses a fresh private cache", async () => {
  const fixture = await setup();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml", etag: '"feed-v1"' } });
  };

  const first = await runScan({ config: fixture.config, now: "2026-08-19T12:00:00.000Z", fetchImpl, lookup: PUBLIC_LOOKUP, sleep: async () => {} });
  const second = await runScan({ config: fixture.config, now: "2026-08-19T12:30:00.000Z", fetchImpl, lookup: PUBLIC_LOOKUP, sleep: async () => {} });

  assert.equal(calls, 1);
  assert.equal(first.touched[0].status, "new");
  assert.equal(first.touched[0].property.pricing.price, 1450);
  assert.equal(first.touched[0].provenance["property.operation"], "inferred");
  assert.equal(first.touched[0].provenance["property.pricing.price"], "reported");
  assert.equal(second.touched[0].status, "unchanged");
  assert.equal(second.diagnostics[0].cache_hits, 1);
  assert.equal(second.diagnostics[0].requests, 0);
  const report = await readFile(second.reportPath, "utf8");
  assert.match(report, /\| agency-feed \| rss \| success \| 1 \| 0 \| 1 \| 0 \|/);
});

test("a failed network source does not discard a successful local source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-partial-"));
  const localPath = join(directory, "local.json");
  await writeFile(localPath, JSON.stringify([{ id: "local-1", operation: "rent", property_type: "house", price: 900, currency: "USD" }]));
  const fixture = await setup([
    { id: "local", type: "local-json", path: localPath, provider: "local" },
    rssSource({ id: "broken-feed", cache: false, max_retries: 1 })
  ]);
  let calls = 0;
  const result = await runScan({
    config: fixture.config,
    now: "2026-08-19T12:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    },
    lookup: PUBLIC_LOOKUP,
    sleep: async () => {},
    random: () => 0
  });

  assert.equal(calls, 2);
  assert.equal(result.listings.length, 1);
  assert.deepEqual(result.diagnostics.map((item) => item.status), ["success", "failed"]);
  assert.equal(result.diagnostics[1].error.status, 503);
  assert.equal(result.diagnostics[1].retries, 1);
});

test("all failed sources leave the inventory untouched", async () => {
  const fixture = await setup([rssSource({ compliance: { confirmed: false } })]);
  await assert.rejects(
    runScan({ config: fixture.config, now: "2026-08-19T12:00:00.000Z", fetchImpl: async () => assert.fail("must not fetch") }),
    /All enabled sources failed\. Inventory was not modified/
  );
  await assert.rejects(access(fixture.inventory, constants.F_OK), (error) => error.code === "ENOENT");
  const ledger = await readFile(join(fixture.directory, "provider-runs.jsonl"), "utf8");
  assert.match(ledger, /"code":"compliance"/);
});

test("Atom uses an implicit alternate link instead of a preceding self link", () => {
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>atom-1</id><title>Casa</title><link rel="self" href="https://feed.example.test/entries/1"/><link href="https://agency.example.test/listings/1"/><updated>2026-08-19T10:00:00Z</updated></entry></feed>`;
  const [listing] = parseFeed(atom, rssSource(), "2026-08-19T12:00:00.000Z");
  assert.equal(listing.url, "https://agency.example.test/listings/1");
});

test("RSS rejects unsafe listing schemes and bounded-feed violations", () => {
  const unsafe = RSS.replace("https://agency.example.test/listings/101?utm_source=feed", "javascript:alert(1)");
  assert.equal(parseFeed(unsafe, rssSource(), "2026-08-19T12:00:00.000Z")[0].url, null);
  assert.throws(() => parseFeed(RSS, rssSource({ max_items: 0 }), "2026-08-19T12:00:00.000Z"), /positive integers/);
  assert.throws(() => parseFeed(RSS, rssSource({ max_item_bytes: 10 }), "2026-08-19T12:00:00.000Z"), /exceeds max_item_bytes/);
});

test("schema-invalid provider output is isolated from valid sources", async () => {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-invalid-"));
  const localPath = join(directory, "local.json");
  await writeFile(localPath, JSON.stringify([{ id: "local-1", operation: "rent", property_type: "house", price: 900, currency: "USD" }]));
  const invalidFeed = RSS.replace("<property:price>1450</property:price>", "<property:price>-10</property:price>");
  const fixture = await setup([
    { id: "local", type: "local-json", path: localPath, provider: "local" },
    rssSource({ id: "invalid-feed", cache: false })
  ]);
  const result = await runScan({
    config: fixture.config,
    now: "2026-08-19T12:00:00.000Z",
    fetchImpl: async () => new Response(invalidFeed, { status: 200 }),
    lookup: PUBLIC_LOOKUP,
    sleep: async () => {}
  });

  assert.equal(result.listings.length, 1);
  assert.deepEqual(result.diagnostics.map((item) => item.status), ["success", "failed"]);
  assert.equal(result.diagnostics[1].error.code, "invalid_response");
});
