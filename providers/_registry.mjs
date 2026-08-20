import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadProviders(directory) {
  const providers = new Map();
  const warnings = [];
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".mjs") && !file.startsWith("_"))
    .sort();

  for (const file of files) {
    try {
      const module = await import(pathToFileURL(join(directory, file)).href);
      const provider = module.default;
      if (!provider?.id || typeof provider.fetch !== "function") {
        warnings.push(`${file}: default export must define id and fetch()`);
        continue;
      }
      if (providers.has(provider.id)) {
        warnings.push(`${file}: duplicate provider id ${provider.id}`);
        continue;
      }
      providers.set(provider.id, provider);
    } catch (error) {
      warnings.push(`${file}: ${error.message}`);
    }
  }
  return { providers, warnings };
}

export function resolveProvider(source, providers) {
  if (source.type && providers.has(source.type)) return providers.get(source.type);
  for (const provider of providers.values()) {
    try {
      if (provider.detect?.(source)) return provider;
    } catch {
      // A detector cannot prevent later providers from claiming the source.
    }
  }
  return null;
}
