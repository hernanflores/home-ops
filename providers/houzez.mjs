import { ProviderConfigError, ProviderParseError } from "./_errors.mjs";
import { assertPublicHttpsUrl } from "./_http.mjs";
import { validateCompliance } from "./_compliance.mjs";

const MAX_PAGES_CAP = 50;

function first(value) {
  return Array.isArray(value) ? value[0] : value ?? null;
}

function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || null;
}

function classSlug(item, prefix) {
  const value = item.class_list?.find((entry) => String(entry).startsWith(prefix));
  return value ? String(value).slice(prefix.length) : null;
}

function operation(item) {
  const slug = classSlug(item, "property_status-");
  if (["venta", "sale", "en-venta"].includes(slug)) return "sale";
  if (["alquiler", "rent", "rental", "en-alquiler"].includes(slug)) return "rent";
  return "unknown";
}

function propertyType(item) {
  const slug = classSlug(item, "property_type-");
  if (["apartamento", "apartment", "departamento"].includes(slug)) return "apartment";
  if (["casa", "house", "ph"].includes(slug)) return "house";
  if (["terreno", "land", "lote"].includes(slug)) return "land";
  if (["local", "oficina", "commercial", "office"].includes(slug)) return "commercial";
  return slug ? "other" : "unknown";
}

function currency(meta) {
  const explicit = first(meta.fave_currency);
  if (explicit && /^[A-Za-z]{3}$/.test(String(explicit))) return String(explicit).toUpperCase();
  const prefix = String(first(meta.fave_property_price_prefix) ?? "").toUpperCase().replace(/\s/g, "");
  return ["USD", "U$D", "U$S", "US$"].includes(prefix) ? "USD" : null;
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(String(value).endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function parseHouzezItem(item, source, now) {
  if (!item || item.status !== "publish" || !item.id || !item.link) return null;
  const meta = item.property_meta ?? {};
  const areaSlug = classSlug(item, "property_area-");
  const address = first(meta.fave_property_address) ?? first(meta.fave_property_map_address);
  const raw = {
    external_id: String(item.id),
    url: item.link,
    published_at: isoDate(item.date_gmt ?? item.date),
    operation: operation(item),
    property_type: propertyType(item),
    title: stripHtml(item.title?.rendered),
    description: stripHtml(item.content?.rendered ?? item.excerpt?.rendered),
    country_code: source.defaults?.country_code,
    admin_area: source.defaults?.admin_area,
    city: source.defaults?.city,
    neighborhood: areaSlug?.replace(/-/g, " ") ?? null,
    address,
    price: first(meta.fave_property_price),
    currency: currency(meta) ?? source.defaults?.currency,
    bedrooms: first(meta.fave_property_bedrooms),
    bathrooms: first(meta.fave_property_bathrooms),
    area_total_m2: first(meta.fave_property_size),
    parking_spaces: first(meta.fave_property_garage),
    _provider_payload: {
      id: item.id,
      modified_gmt: item.modified_gmt,
      class_list: item.class_list,
      property_meta: Object.fromEntries([
        "fave_property_price", "fave_property_price_prefix", "fave_currency",
        "fave_property_size", "fave_property_bedrooms", "fave_property_bathrooms",
        "fave_property_garage", "fave_property_address", "fave_property_map_address"
      ].filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]]))
    },
    _home_ops_inferred_fields: [
      source.defaults?.country_code ? "property.location.country_code" : null,
      source.defaults?.admin_area ? "property.location.admin_area" : null,
      source.defaults?.city ? "property.location.city" : null,
      !currency(meta) && source.defaults?.currency ? "property.pricing.currency" : null
    ].filter(Boolean),
    _home_ops_source: {
      provider: source.provider ?? source.id ?? new URL(source.url).hostname,
      retrieved_at: now
    }
  };
  return raw;
}

function endpoint(source, page) {
  const base = assertPublicHttpsUrl(source.url);
  if (!/\/wp-json\/wp\/v2\/properties\/?$/.test(base.pathname)) {
    throw new ProviderConfigError("houzez url must end with /wp-json/wp/v2/properties");
  }
  base.search = "";
  base.searchParams.set("page", String(page));
  base.searchParams.set("per_page", String(source.per_page ?? 50));
  base.searchParams.set("status", "publish");
  base.searchParams.set("orderby", "modified");
  base.searchParams.set("order", "desc");
  return base.href;
}

export default {
  id: "houzez",
  detect(source) {
    return typeof source.url === "string" && /\/wp-json\/wp\/v2\/properties\/?(?:[?#]|$)/.test(source.url);
  },
  async fetch(source, context) {
    if (!source.url) throw new ProviderConfigError("houzez requires url");
    validateCompliance(source, context.now);
    const perPage = Number(source.per_page ?? 50);
    const maxPages = Math.min(Number(source.max_pages ?? 10), MAX_PAGES_CAP);
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
      throw new ProviderConfigError("houzez per_page must be an integer from 1 to 100");
    }
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      throw new ProviderConfigError("houzez max_pages must be a positive integer");
    }

    const listings = [];
    for (let page = 1; page <= maxPages; page += 1) {
      let response;
      try {
        response = await context.fetchJson(endpoint(source, page));
      } catch (error) {
        if (page > 1 && error?.status === 400 && error?.responseCode === "rest_post_invalid_page_number") {
          return { listings };
        }
        throw error;
      }
      if (!Array.isArray(response)) throw new ProviderParseError("Houzez response must be an array");
      for (const item of response) {
        const parsed = parseHouzezItem(item, source, context.now);
        if (parsed) listings.push(parsed);
      }
      if (response.length < perPage) return { listings };
    }
    throw new ProviderParseError(`Houzez scan reached max_pages=${maxPages}; raise the limit to avoid silent truncation`);
  }
};
