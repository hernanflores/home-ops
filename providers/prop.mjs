import { parse, parseFragment } from "parse5";
import { ProviderConfigError, ProviderParseError } from "./_errors.mjs";
import { assertPublicHttpsUrl } from "./_http.mjs";
import { validateCompliance } from "./_compliance.mjs";

const HOST = "prop.com.uy";
const MAX_LISTINGS_CAP = 25;
const MAX_PAGES_CAP = 3;
const MIN_INTERVAL_MS = 5_000;

const OPERATIONS = { alquilar: "rent", comprar: "sale" };
const PROPERTY_TYPES = {
  apartamento: "apartment",
  casa: "house",
  terreno: "land",
  chacra: "land",
  campo: "land",
  local: "commercial",
  oficina: "commercial",
  galpon: "commercial",
  edificio: "commercial"
};
const FEATURES = { dormitorios: "bedrooms", banos: "bathrooms", garajes: "parking_spaces" };

function children(node) {
  return node?.childNodes ?? [];
}

function collect(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of children(node)) collect(child, predicate, found);
  return found;
}

function attribute(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value ?? null;
}

function classes(node) {
  return String(attribute(node, "class") ?? "").split(/\s+/).filter(Boolean);
}

function nodeText(node) {
  if (node?.nodeName === "#text") return node.value ?? "";
  return children(node).map(nodeText).join("");
}

function textOf(node) {
  const value = nodeText(node).replace(/\s+/g, " ").trim();
  return value || null;
}

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function propUrl(value, kind) {
  const url = assertPublicHttpsUrl(value);
  if (url.hostname !== HOST || url.hash) {
    throw new ProviderConfigError(`prop ${kind} must use https://${HOST} without a fragment`);
  }
  if (kind === "listing") {
    if (url.search) throw new ProviderConfigError("prop listing url must not carry query parameters");
    if (!/^\/propiedades\/[a-z0-9-]+-p\d+$/.test(url.pathname)) {
      throw new ProviderConfigError(`prop listing path is not allowed: ${url.pathname}`);
    }
    return url;
  }
  // Only the pagination parameter is permitted; robots.txt disallows tracking
  // query strings and the /search_list route.
  for (const key of url.searchParams.keys()) {
    if (key !== "page") throw new ProviderConfigError(`prop category url may only use the page parameter, found ${key}`);
  }
  if (!/^\/propiedades\/(alquilar|comprar)(\/[a-z0-9-]+)*$/.test(url.pathname)) {
    throw new ProviderConfigError(`prop category path is not allowed: ${url.pathname}`);
  }
  return url;
}

export function parsePropPrice(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { price: null, currency: null };
  const match = text.match(/^(UYU|USD|U\$S|US\$|\$U?)\s*([\d.,]+)$/i);
  if (!match) return { price: null, currency: null };
  const symbol = match[1].toUpperCase();
  const currency = symbol === "UYU" || symbol === "$" || symbol === "$U"
    ? "UYU"
    : ["USD", "U$S", "US$"].includes(symbol) ? "USD" : null;
  // Uruguayan formatting uses "." for thousands and "," for decimals.
  const digits = match[2].replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const price = Number(digits);
  return Number.isFinite(price) && price >= 0 ? { price, currency } : { price: null, currency: null };
}

function categoryTaxonomy(url) {
  const segments = url.pathname.split("/").filter(Boolean).slice(1);
  const operation = OPERATIONS[segments[0]] ?? "unknown";
  const type = segments.slice(1).map((segment) => PROPERTY_TYPES[segment]).find(Boolean);
  return { operation, propertyType: type ?? "unknown" };
}

function cardFeatures(card) {
  const values = {};
  for (const group of collect(card, (node) => classes(node).includes("single-place-features"))) {
    const paragraphs = collect(group, (node) => node.tagName === "p");
    const labelNode = paragraphs.find((node) => attribute(node, "alt") || attribute(node, "title"));
    const label = normalized(attribute(labelNode, "alt") ?? attribute(labelNode, "title"));
    const field = FEATURES[label];
    if (!field) continue;
    const valueNode = paragraphs.find((node) => node !== labelNode && classes(node).includes("py-1"));
    const number = Number(textOf(valueNode));
    if (Number.isInteger(number) && number >= 0) values[field] = number;
  }
  return values;
}

export function parsePropCategory(html, source, now, categoryUrl) {
  const url = propUrl(categoryUrl, "category");
  const { operation, propertyType } = categoryTaxonomy(url);
  const document = parse(html);
  const cards = collect(document, (node) => classes(node).includes("property-grid-card"));
  if (cards.length === 0) throw new ProviderParseError("PROP response contains no property cards");

  const listings = [];
  for (const card of cards) {
    const anchor = collect(card, (node) => node.tagName === "a" && attribute(node, "href"))[0];
    if (!anchor) continue;
    const listingUrl = propUrl(new URL(attribute(anchor, "href"), `https://${HOST}`).href, "listing");
    const externalId = listingUrl.pathname.match(/-(p\d+)$/)[1].toUpperCase();

    const titleNode = collect(card, (node) => classes(node).includes("single-place-title"))[0];
    const title = textOf(titleNode) ?? attribute(titleNode, "title");
    const priceNode = collect(card, (node) => node.tagName === "h3" && classes(node).includes("bold"))[0];
    const { price, currency } = parsePropPrice(textOf(priceNode));
    const addressNode = collect(card, (node) => classes(node).includes("address"))[0];
    // Feature counters reuse font-secondary with an extra py-1 class.
    const locationNode = collect(
      card,
      (node) => node.tagName === "p" && classes(node).join(" ") === "font-secondary"
    )[0];
    const locationParts = (textOf(locationNode) ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    const features = cardFeatures(card);
    const defaultCity = source.defaults?.city ?? null;

    listings.push({
      external_id: externalId,
      url: listingUrl.href,
      // Card markup carries no publication date.
      published_at: null,
      operation,
      property_type: propertyType,
      title,
      // Card markup carries no description, and detail pages are not requested.
      description: null,
      country_code: source.defaults?.country_code ?? null,
      admin_area: locationParts.at(-1) ?? null,
      city: defaultCity,
      neighborhood: locationParts.length > 1 ? locationParts[0] : null,
      address: textOf(addressNode),
      price,
      currency,
      bedrooms: features.bedrooms,
      bathrooms: features.bathrooms,
      parking_spaces: features.parking_spaces,
      _provider_payload: {
        external_id: externalId,
        category_url: url.href,
        title,
        price_text: textOf(priceNode),
        price,
        currency,
        address: textOf(addressNode),
        location_text: textOf(locationNode),
        admin_area: locationParts.at(-1) ?? null,
        neighborhood: locationParts.length > 1 ? locationParts[0] : null,
        bedrooms: features.bedrooms ?? null,
        bathrooms: features.bathrooms ?? null,
        parking_spaces: features.parking_spaces ?? null
      },
      // Operation and property type come from the requested category filter
      // rather than from the listing card itself.
      _home_ops_inferred_fields: [
        operation !== "unknown" ? "property.operation" : null,
        propertyType !== "unknown" ? "property.property_type" : null,
        source.defaults?.country_code ? "property.location.country_code" : null,
        defaultCity ? "property.location.city" : null
      ].filter(Boolean),
      _home_ops_source: {
        provider: source.provider ?? "prop",
        retrieved_at: now
      }
    });
  }
  return listings;
}

export default {
  id: "prop",
  detect(source) {
    return typeof source.url === "string" && source.url.includes(`${HOST}/propiedades/`);
  },
  async fetch(source, context) {
    if (!source.url) throw new ProviderConfigError("prop requires a category url");
    validateCompliance(source, context.now);
    if (source.compliance?.mode !== "personal-use" || source.compliance?.automation_unspecified_acknowledged !== true) {
      throw new ProviderConfigError("prop requires explicit personal-use acknowledgement");
    }
    // PROP publishes a privacy policy but no terms of use, so the reuse scope is
    // undetermined rather than merely unspecified. That must be acknowledged
    // separately and cannot be inherited from another source's review.
    if (source.compliance?.terms_absent_acknowledged !== true) {
      throw new ProviderConfigError("prop requires terms_absent_acknowledged: true because the site publishes no terms of use");
    }
    const maxListings = Number(source.max_listings ?? 10);
    const maxPages = Number(source.max_pages ?? 1);
    const minInterval = Number(source.min_interval_ms ?? 0);
    if (!Number.isInteger(maxListings) || maxListings < 1 || maxListings > MAX_LISTINGS_CAP) {
      throw new ProviderConfigError(`prop max_listings must be an integer from 1 to ${MAX_LISTINGS_CAP}`);
    }
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES_CAP) {
      throw new ProviderConfigError(`prop max_pages must be an integer from 1 to ${MAX_PAGES_CAP}`);
    }
    if (!Number.isFinite(minInterval) || minInterval < MIN_INTERVAL_MS) {
      throw new ProviderConfigError(`prop min_interval_ms must be at least ${MIN_INTERVAL_MS}`);
    }
    if (Number(source.max_retries ?? 1) > 1) throw new ProviderConfigError("prop max_retries cannot exceed 1");

    const base = propUrl(source.url, "category");
    const listings = [];
    const seen = new Set();
    for (let page = 1; page <= maxPages && listings.length < maxListings; page += 1) {
      const pageUrl = new URL(base.href);
      if (page > 1) pageUrl.searchParams.set("page", String(page));
      const html = await context.fetchText(propUrl(pageUrl.href, "category").href, { accept: "text/html" });
      const parsed = parsePropCategory(html, source, context.now, pageUrl.href);
      for (const listing of parsed) {
        if (seen.has(listing.external_id) || listings.length >= maxListings) continue;
        seen.add(listing.external_id);
        listings.push(listing);
      }
      if (parsed.length === 0) break;
    }
    return { listings };
  }
};
