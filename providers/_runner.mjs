import { resolveProvider } from "./_registry.mjs";
import { createHttpContext } from "./_http.mjs";
import { ProviderConfigError, errorDiagnostic } from "./_errors.mjs";

function sourceId(source, index) {
  return String(source.id ?? source.provider ?? `${source.type ?? "source"}-${index + 1}`);
}

export async function runProviders(sources, options) {
  const listings = [];
  const batches = [];
  const diagnostics = [];
  const ids = new Set();

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const id = sourceId(source, index);
    const started = Date.now();
    let http = { stats: { requests: 0, cache_hits: 0, retries: 0 } };

    if (ids.has(id)) throw new ProviderConfigError(`Duplicate source id: ${id}`);
    ids.add(id);
    if (source.enabled === false) {
      diagnostics.push({ id, provider: source.type ?? "unknown", status: "skipped", count: 0, duration_ms: 0, ...http.stats });
      continue;
    }

    const provider = resolveProvider(source, options.providers);
    if (!provider) {
      const diagnostic = {
        id,
        provider: source.type ?? "unknown",
        status: "failed",
        count: 0,
        duration_ms: Date.now() - started,
        ...http.stats,
        error: errorDiagnostic(new ProviderConfigError(`Unknown provider type: ${source.type ?? "missing"}`))
      };
      diagnostics.push(diagnostic);
      continue;
    }

    try {
      http = createHttpContext({
        source,
        sourceId: id,
        cacheDir: options.cacheDir,
        now: options.now,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        random: options.random,
        lookup: options.lookup,
        limiter: options.limiter,
        clock: options.clock
      });
      const result = await provider.fetch(source, {
        now: options.now,
        resolvePath: options.resolvePath,
        fetchText: http.fetchText,
        fetchJson: http.fetchJson
      });
      if (!result || !Array.isArray(result.listings)) {
        throw new ProviderConfigError(`${provider.id}: fetch() must return { listings: [] }`);
      }
      listings.push(...result.listings);
      const diagnostic = {
        id,
        provider: provider.id,
        status: "success",
        count: result.listings.length,
        duration_ms: Date.now() - started,
        ...http.stats
      };
      diagnostics.push(diagnostic);
      batches.push({ source, provider: provider.id, listings: result.listings, diagnostic });
    } catch (error) {
      diagnostics.push({
        id,
        provider: provider.id,
        status: "failed",
        count: 0,
        duration_ms: Date.now() - started,
        ...http.stats,
        error: errorDiagnostic(error)
      });
    }
  }

  return { listings, batches, diagnostics };
}
