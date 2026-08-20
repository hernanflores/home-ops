import { readFile } from "node:fs/promises";

export async function load(options) {
  const parsed = JSON.parse(await readFile(options.path, "utf8"));
  const listings = Array.isArray(parsed) ? parsed : parsed.listings;

  if (!Array.isArray(listings)) {
    throw new Error(`${options.path}: expected an array or an object with a listings array`);
  }

  return listings.map((listing) => ({
    ...listing,
    _home_ops_source: {
      provider: options.provider,
      retrieved_at: options.retrievedAt
    }
  }));
}

export default {
  id: "local-json",
  async fetch(source, context) {
    if (!source.path) throw new Error("local-json requires path");
    return {
      listings: await load({
        path: context.resolvePath(source.path),
        provider: source.provider ?? source.id ?? "local-json",
        retrievedAt: context.now
      })
    };
  }
};
