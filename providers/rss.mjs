import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ProviderConfigError, ProviderParseError } from "./_errors.mjs";
import { validateCompliance } from "./_compliance.mjs";

const TARGET_FIELDS = new Set([
  "external_id", "url", "published_at", "operation", "property_type", "title",
  "description", "country_code", "admin_area", "city", "neighborhood", "address",
  "price", "currency", "expenses", "expenses_currency", "bedrooms", "bathrooms",
  "area_total_m2", "area_covered_m2", "parking_spaces"
]);
const PROVENANCE_PATHS = {
  external_id: "source.external_id", url: "source.url", published_at: "source.published_at",
  operation: "property.operation", property_type: "property.property_type", title: "property.title",
  description: "property.description", country_code: "property.location.country_code",
  admin_area: "property.location.admin_area", city: "property.location.city",
  neighborhood: "property.location.neighborhood", address: "property.location.address",
  price: "property.pricing.price", currency: "property.pricing.currency",
  expenses: "property.pricing.expenses", expenses_currency: "property.pricing.expenses_currency",
  bedrooms: "property.features.bedrooms", bathrooms: "property.features.bathrooms",
  area_total_m2: "property.features.area_total_m2", area_covered_m2: "property.features.area_covered_m2",
  parking_spaces: "property.features.parking_spaces"
};

function array(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function getPath(object, path) {
  return String(path).split(".").reduce((value, key) => value?.[key], object);
}

function scalar(value) {
  if (value === undefined || value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value === "object") return value["#text"] ?? value._ ?? null;
  return null;
}

function text(value) {
  const raw = scalar(value);
  if (raw === null) return null;
  return String(raw).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
}

function atomLink(value) {
  const links = array(value);
  const alternate = links.find((link) => typeof link === "string" || link?.["@_rel"] === "alternate");
  const implicitAlternate = links.find((link) => link && typeof link === "object" && !link["@_rel"]);
  const selected = alternate ?? implicitAlternate;
  return selected?.["@_href"] ?? scalar(selected);
}

function absoluteUrl(value, base) {
  if (!value) return null;
  try {
    const url = new URL(String(value), base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function defaultValue(item, target) {
  const defaults = {
    external_id: scalar(item.guid) ?? scalar(item.id),
    url: atomLink(item.link),
    published_at: scalar(item.pubDate) ?? scalar(item.published) ?? scalar(item.updated),
    title: text(item.title),
    description: text(item.description) ?? text(item.summary) ?? text(item.content)
  };
  return defaults[target] ?? null;
}

export function parseFeed(xml, source, now) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new ProviderParseError(`RSS/Atom response is invalid XML at line ${validation.err.line}`);
  }
  let document;
  try {
    document = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      trimValues: true,
      processEntities: true
    }).parse(xml);
  } catch (error) {
    throw new ProviderParseError("RSS/Atom response is invalid XML", { cause: error });
  }

  const items = document?.rss?.channel?.item ?? document?.feed?.entry;
  if (items === undefined) throw new ProviderParseError("Response is not an RSS or Atom feed");
  const mapping = source.mapping ?? {};
  for (const key of Object.keys(mapping)) {
    if (!TARGET_FIELDS.has(key)) throw new ProviderConfigError(`rss mapping has unsupported target: ${key}`);
  }

  const feedItems = array(items);
  const maxItems = Number(source.max_items ?? 1_000);
  const maxItemBytes = Number(source.max_item_bytes ?? 100_000);
  if (![maxItems, maxItemBytes].every((value) => Number.isInteger(value) && value > 0)) {
    throw new ProviderConfigError("rss max_items and max_item_bytes must be positive integers");
  }
  if (feedItems.length > maxItems) {
    throw new ProviderParseError(`RSS/Atom feed exceeds max_items (${maxItems})`);
  }

  return feedItems.map((item) => {
    if (Buffer.byteLength(JSON.stringify(item), "utf8") > maxItemBytes) {
      throw new ProviderParseError(`RSS/Atom item exceeds max_item_bytes (${maxItemBytes})`);
    }
    const raw = { ...(source.defaults ?? {}) };
    const reportedTargets = new Set();
    for (const target of TARGET_FIELDS) {
      const mapped = mapping[target] ? scalar(getPath(item, mapping[target])) : defaultValue(item, target);
      if (mapped !== null && mapped !== undefined && mapped !== "") {
        raw[target] = mapped;
        reportedTargets.add(target);
      }
    }
    if (raw.url) raw.url = absoluteUrl(raw.url, source.url);
    raw._feed_item = item;
    raw._home_ops_inferred_fields = Object.keys(source.defaults ?? {})
      .filter((key) => !reportedTargets.has(key))
      .map((key) => PROVENANCE_PATHS[key])
      .filter(Boolean);
    raw._home_ops_source = {
      provider: source.provider ?? source.id ?? new URL(source.url).hostname,
      retrieved_at: now
    };
    return raw;
  });
}

export default {
  id: "rss",
  detect(source) {
    return source.url && /(?:\.rss|\.xml|\/feed\/?)(?:[?#]|$)/i.test(source.url);
  },
  async fetch(source, context) {
    if (!source.url) throw new ProviderConfigError("rss requires url");
    validateCompliance(source, context.now);
    const xml = await context.fetchText(source.url, { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" });
    return { listings: parseFeed(xml, source, context.now) };
  }
};
