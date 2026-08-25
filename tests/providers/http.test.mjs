import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertPublicHttpsUrl, createHttpContext } from "../../providers/_http.mjs";
import { sanitizeErrorMessage } from "../../providers/_errors.mjs";

test("HTTP transport honors Retry-After for a bounded 429 retry", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  const delays = [];
  let calls = 0;
  const context = createHttpContext({
    source: { cache: false, max_retries: 1, min_interval_ms: 0 },
    sourceId: "retry-source",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "2" } });
      return new Response("ok", { status: 200 });
    },
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    sleep: async (milliseconds) => delays.push(milliseconds),
    random: () => 0
  });

  assert.equal(await context.fetchText("https://feed.example.test/listings.xml"), "ok");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(context.stats.retries, 1);
});

test("HTTP transport rejects private, insecure, credentialed and tokenized URLs", () => {
  assert.throws(() => assertPublicHttpsUrl("http://example.test/feed"), /require HTTPS/);
  assert.throws(() => assertPublicHttpsUrl("https://localhost/feed"), /Private hostname/);
  assert.throws(() => assertPublicHttpsUrl("https://127.0.0.1/feed"), /Private IP/);
  assert.throws(() => assertPublicHttpsUrl("https://[::1]/feed"), /Private IP/);
  assert.throws(() => assertPublicHttpsUrl("https://[fc00::1]/feed"), /Private IP/);
  assert.throws(() => assertPublicHttpsUrl("https://[::ffff:127.0.0.1]/feed"), /Private IP/);
  assert.throws(() => assertPublicHttpsUrl("https://[64:ff9b::7f00:1]/feed"), /Private IP/);
  assert.throws(() => assertPublicHttpsUrl("https://user:pass@example.test/feed"), /Credentials/);
  assert.throws(() => assertPublicHttpsUrl("https://example.test/feed?api_key=secret"), /Secret query parameter/);
});

test("rate-limit state is shared across consecutive HTTP contexts", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  let current = 0;
  const delays = [];
  const common = {
    source: { cache: false, min_interval_ms: 1000 },
    sourceId: "paced",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (_url, options) => {
      assert.ok(options.dispatcher, "request must use a DNS-pinned dispatcher");
      return new Response("ok", { status: 200 });
    },
    clock: () => current,
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
      current += milliseconds;
    }
  };
  const first = createHttpContext(common);
  const second = createHttpContext(common);
  await first.fetchText("https://feed.example.test/listings.xml");
  await second.fetchText("https://feed.example.test/listings.xml");
  assert.deepEqual(delays, [1000]);
});

test("HTTP transport rejects DNS names resolving to private addresses", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  const context = createHttpContext({
    source: { cache: false, min_interval_ms: 0 },
    sourceId: "private-dns",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "169.254.169.254", family: 4 }],
    fetchImpl: async () => assert.fail("must not fetch")
  });
  await assert.rejects(context.fetchText("https://metadata.example.test/feed"), /resolves to a private/);
});

test("DNS lookup is bounded by the source timeout", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  const context = createHttpContext({
    source: { cache: false, min_interval_ms: 0, timeout_ms: 5, max_retries: 0 },
    sourceId: "dns-timeout",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => new Promise(() => {}),
    fetchImpl: async () => assert.fail("must not fetch")
  });
  await assert.rejects(context.fetchText("https://feed.example.test/listings.xml"), /DNS lookup timed out/);
});

test("HTTP transport stops instead of violating a long Retry-After", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  let calls = 0;
  const context = createHttpContext({
    source: { cache: false, max_retries: 2, min_interval_ms: 0, max_retry_after_ms: 30_000 },
    sourceId: "long-retry",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      calls += 1;
      return new Response("slow down", { status: 429, headers: { "retry-after": "3600" } });
    },
    sleep: async () => assert.fail("must not wait or retry")
  });
  await assert.rejects(context.fetchText("https://feed.example.test/listings.xml"), /HTTP 429/);
  assert.equal(calls, 1);
});

test("HTTP transport respects no-store and response size limits", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  let calls = 0;
  const context = createHttpContext({
    source: { min_interval_ms: 0, max_response_bytes: 4 },
    sourceId: "limits",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      calls += 1;
      return new Response(calls < 3 ? "okay" : "oversized", { status: 200, headers: { "cache-control": "no-store" } });
    }
  });
  assert.equal(await context.fetchText("https://feed.example.test/listings.xml"), "okay");
  assert.equal(await context.fetchText("https://feed.example.test/listings.xml"), "okay");
  await assert.rejects(context.fetchText("https://feed.example.test/listings.xml"), /exceeds max_response_bytes/);
  assert.equal(calls, 3);
});

test("HTTP transport supports disabling cache for a sensitive response", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  let calls = 0;
  const context = createHttpContext({
    source: { min_interval_ms: 0, cache_ttl_minutes: 60 },
    sourceId: "sensitive-response",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => {
      calls += 1;
      return new Response(`response-${calls}`, { status: 200, headers: { "cache-control": "max-age=3600" } });
    }
  });
  const url = "https://feed.example.test/sensitive";
  assert.equal(await context.fetchText(url, { cache: false }), "response-1");
  assert.equal(await context.fetchText(url, { cache: false }), "response-2");
  assert.equal(await context.fetchText(url), "response-3");
  assert.equal(await context.fetchText(url), "response-3");
  assert.equal(calls, 3);
  assert.equal(context.stats.cache_hits, 1);
});

test("provider errors redact bearer tokens and secret query values", () => {
  assert.equal(
    sanitizeErrorMessage("Bearer abc.def failed at https://x.test?a=1&access_token=secret-value"),
    "Bearer [REDACTED] failed at https://x.test?a=1&access_token=[REDACTED]"
  );
  assert.equal(
    sanitizeErrorMessage("Basic dXNlcjpwYXNz failed?client_secret=secret&x-amz-signature=signed"),
    "Basic [REDACTED] failed?client_secret=[REDACTED]&x-amz-signature=[REDACTED]"
  );
});

test("HTTP transport follows a same-origin redirect and keeps the guards", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  const requested = [];
  const context = createHttpContext({
    source: { cache: false, min_interval_ms: 0 },
    sourceId: "redirect-source",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (url, options) => {
      requested.push(String(url));
      assert.equal(options.redirect, "manual");
      assert.ok(options.dispatcher, "every hop must use a DNS-pinned dispatcher");
      if (requested.length === 1) {
        return new Response("", { status: 301, headers: { location: "/listing/renamed" } });
      }
      return new Response("ok", { status: 200 });
    }
  });

  assert.equal(await context.fetchText("https://feed.example.test/listing/stale"), "ok");
  assert.deepEqual(requested, [
    "https://feed.example.test/listing/stale",
    "https://feed.example.test/listing/renamed"
  ]);
  assert.equal(context.stats.requests, 2);
  assert.equal(context.stats.retries, 0);
});

test("HTTP transport refuses cross-origin and unbounded redirect chains", async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "home-ops-http-"));
  const redirectingContext = (location) => createHttpContext({
    source: { cache: false, min_interval_ms: 0 },
    sourceId: "redirect-source",
    cacheDir,
    now: "2026-08-19T12:00:00.000Z",
    lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => new Response("", { status: 302, headers: { location: location() } })
  });

  await assert.rejects(
    redirectingContext(() => "https://elsewhere.example.test/listing").fetchText("https://feed.example.test/listing"),
    /Cross-origin redirect is not followed/
  );
  await assert.rejects(
    redirectingContext(() => "http://feed.example.test/listing").fetchText("https://feed.example.test/listing"),
    /Redirect target is not allowed/
  );
  await assert.rejects(
    redirectingContext(() => "https://127.0.0.1/listing").fetchText("https://feed.example.test/listing"),
    /Redirect target is not allowed/
  );

  let hops = 0;
  const looping = redirectingContext(() => `/listing/${(hops += 1)}`);
  await assert.rejects(
    looping.fetchText("https://feed.example.test/listing"),
    /Exceeded 2 redirects/
  );
  assert.equal(looping.stats.requests, 3);
});
