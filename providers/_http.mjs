import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { Agent } from "undici";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ProviderAccessError,
  ProviderAuthError,
  ProviderConfigError,
  ProviderNetworkError,
  ProviderParseError,
  ProviderRateLimitError,
  classifyProviderError
} from "./_errors.mjs";

const USER_AGENT = "home-ops/0.2 local-first-property-scanner";
const MAX_REDIRECTS = 2;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const SECRET_QUERY = /^(?:access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i;

function isPrivateAddress(value) {
  const address = String(value).toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && [0, 2, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b))
      || (a === 203 && b === 0);
  }
  if (isIP(address) === 6) {
    return address.startsWith("::") || address.startsWith("64:ff9b:")
      || /^f[cd]/.test(address) || /^fe[89ab]/.test(address)
      || address.startsWith("ff") || address.startsWith("2001:db8:");
  }
  return false;
}

// A redirect target must clear every guard the original URL cleared, and must stay
// on the origin the source was configured for: following a cross-origin hop would
// escape the DNS pinning and private-address checks applied above.
function assertSameOriginRedirect(origin, currentUrl, location) {
  let target;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new ProviderAccessError(`Redirect target is not a valid URL: ${location}`);
  }
  let validated;
  try {
    validated = assertPublicHttpsUrl(target.href);
  } catch (error) {
    throw new ProviderAccessError(`Redirect target is not allowed: ${error.message}`);
  }
  if (validated.origin !== origin.origin) {
    throw new ProviderAccessError(
      `Cross-origin redirect is not followed: ${origin.origin} -> ${validated.origin}`
    );
  }
  return validated;
}

export function assertPublicHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderConfigError("Invalid source URL");
  }
  if (url.protocol !== "https:") throw new ProviderConfigError("Network providers require HTTPS");
  if (url.username || url.password) throw new ProviderConfigError("Credentials are not allowed in source URLs");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new ProviderConfigError(`Private hostname is not allowed: ${hostname}`);
  }
  if (isPrivateAddress(hostname)) {
    throw new ProviderConfigError(`Private IP address is not allowed: ${hostname}`);
  }
  for (const key of url.searchParams.keys()) {
    if (SECRET_QUERY.test(key)) throw new ProviderConfigError(`Secret query parameter is not allowed: ${key}`);
  }
  return url;
}

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function cacheKey(url, options) {
  const headers = Object.entries(options.headers ?? {}).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify([url, options.method ?? "GET", options.body ?? null, headers])).digest("hex");
}

function cacheDirectoryName(sourceId) {
  const label = String(sourceId).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 48) || "source";
  const suffix = createHash("sha256").update(String(sourceId)).digest("hex").slice(0, 8);
  return `${label}-${suffix}`;
}

function createPinnedDispatcher(addresses) {
  let index = 0;
  return new Agent({
    connect: {
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions.all) {
          callback(null, addresses);
          return;
        }
        const selected = addresses[index % addresses.length];
        index += 1;
        callback(null, selected.address, selected.family);
      }
    }
  });
}

async function readCache(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeCache(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, path);
}

function responseError(response, retryAfter, responseBody) {
  let responseCode = null;
  try {
    responseCode = JSON.parse(responseBody)?.code ?? null;
  } catch {
    // Non-JSON error bodies carry no machine-readable provider code.
  }
  const options = { status: response.status, retryAfter, responseCode };
  if (response.status === 401) return new ProviderAuthError("HTTP 401 Unauthorized", options);
  if (response.status === 403) return new ProviderAccessError("HTTP 403 Forbidden", options);
  if (response.status === 429) return new ProviderRateLimitError("HTTP 429 Too Many Requests", options);
  return new ProviderNetworkError(`HTTP ${response.status} ${response.statusText}`.trim(), {
    ...options,
    transient: response.status >= 500
  });
}

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ProviderNetworkError(message, { code: "timeout" })), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function withFileLock(path, timeoutMs, sleep, operation) {
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await open(path, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(path);
        if (Date.now() - lockStat.mtimeMs > Math.max(timeoutMs * 2, 60_000)) {
          await unlink(path);
          continue;
        }
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new ProviderNetworkError("Timed out waiting for provider rate-limit lock", { code: "timeout" });
      }
      await sleep(25);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await unlink(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function readResponseBody(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ProviderParseError(`Response exceeds max_response_bytes (${maxBytes})`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProviderParseError(`Response exceeds max_response_bytes (${maxBytes})`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function responseTtl(response, configuredTtlMs) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (/\bno-store\b/i.test(cacheControl) || response.headers.has("set-cookie")) return null;
  if (/\bno-cache\b/i.test(cacheControl)) return 0;
  const maxAge = cacheControl.match(/\bmax-age=(\d+)/i);
  return maxAge ? Math.min(configuredTtlMs, Number(maxAge[1]) * 1000) : configuredTtlMs;
}

export function createHttpContext(options) {
  const source = options.source;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const timeoutMs = Number(source.timeout_ms ?? 10_000);
  const retries = Number(source.max_retries ?? 2);
  const minIntervalMs = Number(source.min_interval_ms ?? 1_000);
  const maxRetryAfterMs = Number(source.max_retry_after_ms ?? 30_000);
  const maxResponseBytes = Number(source.max_response_bytes ?? 5_000_000);
  const ttlMs = Number(source.cache_ttl_minutes ?? 60) * 60_000;
  const cacheEnabled = source.cache !== false;
  const stats = { requests: 0, cache_hits: 0, retries: 0 };
  const limiter = options.limiter ?? new Map();
  const clock = options.clock ?? Date.now;
  const ratePath = (hostname) => join(
    options.cacheDir,
    "_rate",
    `${createHash("sha256").update(hostname).digest("hex")}.json`
  );
  const rateLockPath = (hostname) => `${ratePath(hostname)}.lock`;

  if (![timeoutMs, retries, minIntervalMs, maxRetryAfterMs, maxResponseBytes, ttlMs].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new ProviderConfigError("HTTP timeout, retries, interval and cache TTL must be non-negative numbers");
  }

  async function fetchBody(value, requestOptions = {}) {
    const url = assertPublicHttpsUrl(value);
    const method = requestOptions.method ?? "GET";
    const requestCacheEnabled = cacheEnabled && requestOptions.cache !== false;
    const requestedHeaders = { accept: requestOptions.accept ?? "*/*", ...requestOptions.headers };
    for (const key of Object.keys(requestedHeaders)) {
      if (["authorization", "cookie", "proxy-authorization"].includes(key.toLowerCase())) {
        throw new ProviderConfigError(`Credential header is not allowed in core providers: ${key}`);
      }
    }
    const key = cacheKey(url.href, { ...requestOptions, method, headers: requestedHeaders });
    const cachePath = join(options.cacheDir, cacheDirectoryName(options.sourceId), `${key}.json`);
    const cached = requestCacheEnabled && method === "GET" ? await readCache(cachePath) : null;
    const nowMs = new Date(options.now).valueOf();
    if (cached && new Date(cached.expires_at).valueOf() > nowMs) {
      stats.cache_hits += 1;
      return cached.body;
    }

    const conditional = {};
    if (cached?.etag) conditional["if-none-match"] = cached.etag;
    if (cached?.last_modified) conditional["if-modified-since"] = cached.last_modified;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        let currentUrl = url;
        let currentMethod = method;
        let currentBody = requestOptions.body;
        for (let hop = 0; ; hop += 1) {
          const lookupHost = currentUrl.hostname.replace(/^\[|\]$/g, "");
          const resolved = await withTimeout(
            (options.lookup ?? dnsLookup)(lookupHost, { all: true, verbatim: true }),
            timeoutMs,
            "DNS lookup timed out"
          );
          const addresses = Array.isArray(resolved) ? resolved : [resolved];
          if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
            throw new ProviderAccessError(`Source hostname resolves to a private or unavailable address: ${currentUrl.hostname}`);
          }
          if (minIntervalMs > 0) {
            const wait = await withFileLock(rateLockPath(currentUrl.hostname), timeoutMs, sleep, async () => {
              const current = clock();
              const persisted = await readCache(ratePath(currentUrl.hostname));
              const nextAllowed = Math.max(
                limiter.get(currentUrl.hostname) ?? 0,
                new Date(persisted?.next_request_at ?? 0).valueOf() || 0
              );
              const delay = Math.max(0, nextAllowed - current);
              const reserved = current + delay + minIntervalMs;
              limiter.set(currentUrl.hostname, reserved);
              await writeCache(ratePath(currentUrl.hostname), { next_request_at: new Date(reserved).toISOString() });
              return delay;
            });
            if (wait > 0) await sleep(wait);
          }
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const dispatcher = createPinnedDispatcher(addresses);
          let redirectTarget = null;
          try {
            stats.requests += 1;
            const response = await fetchImpl(currentUrl, {
              method: currentMethod,
              body: currentBody,
              redirect: "manual",
              headers: {
                "user-agent": USER_AGENT,
                ...requestedHeaders,
                ...conditional,
              },
              dispatcher,
              signal: controller.signal
            });
            if (REDIRECT_STATUS.has(response.status)) {
              const location = response.headers.get("location");
              await response.body?.cancel().catch(() => {});
              if (!location) {
                throw new ProviderAccessError(`Redirect without a Location header: HTTP ${response.status}`);
              }
              if (hop >= MAX_REDIRECTS) {
                throw new ProviderAccessError(`Exceeded ${MAX_REDIRECTS} redirects for ${url.origin}${url.pathname}`);
              }
              redirectTarget = assertSameOriginRedirect(url, currentUrl, location);
              if (response.status === 303 && currentMethod !== "GET" && currentMethod !== "HEAD") {
                currentMethod = "GET";
                currentBody = undefined;
              }
            } else if (response.status === 304 && cached) {
              stats.cache_hits += 1;
              const refreshed = {
                ...cached,
                fetched_at: options.now,
                expires_at: new Date(nowMs + ttlMs).toISOString()
              };
              if (requestCacheEnabled) await writeCache(cachePath, refreshed);
              return cached.body;
            } else if (!response.ok) {
              const responseBody = await readResponseBody(response, Math.min(maxResponseBytes, 64_000)).catch(() => "");
              throw responseError(response, response.headers.get("retry-after"), responseBody);
            } else {
              const body = await readResponseBody(response, maxResponseBytes);
              const responseTtlMs = responseTtl(response, ttlMs);
              if (requestCacheEnabled && method === "GET" && responseTtlMs !== null) {
                await writeCache(cachePath, {
                  url: currentUrl.href,
                  fetched_at: options.now,
                  expires_at: new Date(nowMs + responseTtlMs).toISOString(),
                  etag: response.headers.get("etag"),
                  last_modified: response.headers.get("last-modified"),
                  body
                });
              }
              return body;
            }
          } finally {
            clearTimeout(timer);
            await dispatcher.close();
          }
          currentUrl = redirectTarget;
        }
      } catch (error) {
        const classified = classifyProviderError(error);
        if (!classified.transient || attempt === retries) throw classified;
        stats.retries += 1;
        const retryAfter = parseRetryAfter(classified.retryAfter);
        if (retryAfter !== null && retryAfter > maxRetryAfterMs) throw classified;
        const delay = retryAfter ?? Math.min(8_000, 500 * (2 ** attempt) + random() * 250);
        await sleep(delay);
      }
    }
    throw new ProviderNetworkError("Request failed after retries");
  }

  return {
    stats,
    fetchText: fetchBody,
    async fetchJson(url, requestOptions = {}) {
      const text = await fetchBody(url, { accept: "application/json", ...requestOptions });
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new ProviderParseError("Response is not valid JSON", { cause: error });
      }
    }
  };
}
