import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parse, parseFragment } from "parse5";
import { ProviderConfigError, ProviderParseError } from "./_errors.mjs";
import { assertPublicHttpsUrl } from "./_http.mjs";
import { validateCompliance } from "./_compliance.mjs";

const HOST = "www.infocasas.com.uy";
const MAX_LISTINGS_CAP = 25;
const MIN_INTERVAL_MS = 5_000;

function children(node) {
  return node?.childNodes ?? [];
}

function findElement(node, predicate) {
  if (predicate(node)) return node;
  for (const child of children(node)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function attribute(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value ?? null;
}

function nodeText(node) {
  if (node?.nodeName === "#text") return node.value ?? "";
  return children(node).map(nodeText).join("");
}

function stripHtml(value) {
  if (!value) return null;
  return nodeText(parseFragment(String(value))).replace(/\s+/g, " ").trim() || null;
}

function normalized(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function operation(value) {
  const name = normalized(value);
  if (name.includes("venta")) return "sale";
  if (name.includes("alquiler")) return "rent";
  return "unknown";
}

function propertyType(value) {
  const name = normalized(value);
  if (name.includes("apartamento")) return "apartment";
  if (name.includes("casa")) return "house";
  if (name.includes("terreno") || name.includes("chacra") || name.includes("campo")) return "land";
  if (["local", "oficina", "edificio", "hotel", "galpon", "negocio"].some((item) => name.includes(item))) return "commercial";
  return name ? "other" : "unknown";
}

function firstName(value) {
  const item = Array.isArray(value) ? value[0] : null;
  return item?.name ? String(item.name) : null;
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function infoCasasUrl(value, kind) {
  const url = assertPublicHttpsUrl(value);
  if (url.hostname !== HOST || url.search || url.hash) {
    throw new ProviderConfigError(`infocasas ${kind} must use https://${HOST} without query parameters`);
  }
  const valid = kind === "sitemap"
    ? /^\/cde-sitemap-listings-[a-z0-9-]+\.xml$/.test(url.pathname)
    : /^\/[^/]+\/\d+\/?$/.test(url.pathname);
  if (!valid) throw new ProviderConfigError(`infocasas ${kind} path is not allowed: ${url.pathname}`);
  return url;
}

function currency(pageProps, value) {
  const id = value?.id;
  const options = pageProps.apolloState?.["Filter:price"]?.options ?? [];
  const match = options.find((item) => String(item.id) === String(id));
  if (/^[A-Z]{3}$/.test(match?.iso_code ?? "")) return match.iso_code;
  const symbol = String(value?.name ?? "").toUpperCase().replace(/\s/g, "");
  if (["U$S", "US$", "USD"].includes(symbol)) return "USD";
  return id === 2 && symbol === "$" ? "UYU" : null;
}

function nextData(html) {
  const document = parse(html);
  const script = findElement(document, (node) => node.tagName === "script" && attribute(node, "id") === "__NEXT_DATA__");
  if (!script) throw new ProviderParseError("InfoCasas response has no __NEXT_DATA__ listing state");
  try {
    return JSON.parse(nodeText(script));
  } catch (error) {
    throw new ProviderParseError("InfoCasas __NEXT_DATA__ is not valid JSON", { cause: error });
  }
}

export function parseInfoCasasListing(html, source, now, expectedUrl) {
  const pageProps = nextData(html)?.props?.pageProps;
  const data = pageProps?.data;
  if (!data || !data.id || !data.link) throw new ProviderParseError("InfoCasas response has no property data");

  const embeddedUrl = infoCasasUrl(new URL(data.link, `https://${HOST}`).href, "listing");
  const requestedUrl = expectedUrl ? infoCasasUrl(expectedUrl, "listing") : null;
  const embeddedId = embeddedUrl.pathname.split("/").filter(Boolean).at(-1);
  const requestedId = requestedUrl?.pathname.split("/").filter(Boolean).at(-1);
  if (String(data.id) !== embeddedId || (requestedId && String(data.id) !== requestedId)) {
    throw new ProviderParseError("InfoCasas response canonical URL does not match the requested listing");
  }
  const url = requestedUrl ?? embeddedUrl;

  const state = firstName(data.locations?.state);
  const city = firstName(data.locations?.city) ?? state;
  const country = firstName(data.locations?.country);
  const priceCurrency = currency(pageProps, data.price?.currency);
  const expensesCurrency = currency(pageProps, data.commonExpenses?.currency);
  const address = data.showAddress === true ? stripHtml(data.address) : null;
  const raw = {
    external_id: String(data.id),
    url: url.href,
    published_at: data.created_at ?? null,
    operation: operation(data.operation_type?.name),
    property_type: propertyType(data.property_type?.name),
    title: stripHtml(data.title),
    // Free-form descriptions can embed broker and adviser contact details.
    description: null,
    country_code: normalized(country) === "uruguay" ? "UY" : source.defaults?.country_code,
    admin_area: state,
    city,
    neighborhood: firstName(data.locations?.neighbourhood),
    address,
    price: data.price?.hidePrice === true ? null : nonNegative(data.price?.amount),
    currency: data.price?.hidePrice === true ? null : priceCurrency,
    expenses: data.commonExpenses?.hidePrice === true ? null : nonNegative(data.commonExpenses?.amount),
    expenses_currency: data.commonExpenses?.hidePrice === true ? null : expensesCurrency,
    bedrooms: nonNegative(data.bedrooms),
    bathrooms: nonNegative(data.bathrooms),
    area_total_m2: positive(data.m2),
    area_covered_m2: positive(data.m2Built),
    parking_spaces: nonNegative(data.garage),
    _provider_payload: {
      id: data.id,
      created_at: data.created_at ?? null,
      updated_at: data.updated_at ?? null,
      operation: data.operation_type?.name ?? null,
      property_type: data.property_type?.name ?? null,
      price: data.price?.hidePrice === true ? null : data.price?.amount ?? null,
      currency: priceCurrency,
      expenses: data.commonExpenses?.hidePrice === true ? null : data.commonExpenses?.amount ?? null,
      expenses_currency: expensesCurrency,
      country,
      admin_area: state,
      city,
      neighborhood: firstName(data.locations?.neighbourhood),
      address,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      area_total_m2: data.m2 ?? null,
      area_apartment_m2: data.m2apto ?? null,
      area_built_m2: data.m2Built ?? null,
      area_terrain_m2: data.m2Terrain ?? null,
      area_terrace_m2: data.m2Terrace ?? null,
      parking_spaces: data.garage ?? null
    },
    _home_ops_inferred_fields: [
      normalized(country) !== "uruguay" && source.defaults?.country_code ? "property.location.country_code" : null
    ].filter(Boolean),
    _home_ops_source: {
      provider: source.provider ?? "infocasas",
      retrieved_at: now
    }
  };
  return raw;
}

export function parseInfoCasasSitemap(xml) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new ProviderParseError(`InfoCasas sitemap is invalid XML at line ${validation.err.line}`);
  const document = new XMLParser({ removeNSPrefix: true, trimValues: true }).parse(xml);
  const urls = document?.urlset?.url;
  if (!urls) throw new ProviderParseError("InfoCasas response is not a listing sitemap");
  const entries = (Array.isArray(urls) ? urls : [urls]).map((item, index) => ({
    url: infoCasasUrl(item.loc, "listing").href,
    lastmod: item.lastmod ?? null,
    index
  }));
  return entries.sort((left, right) => {
    const byDate = String(right.lastmod ?? "").localeCompare(String(left.lastmod ?? ""));
    return byDate || left.index - right.index;
  });
}

export default {
  id: "infocasas",
  detect(source) {
    return typeof source.url === "string" && source.url.includes(`${HOST}/cde-sitemap-listings-`);
  },
  async fetch(source, context) {
    if (!source.url) throw new ProviderConfigError("infocasas requires a sitemap url");
    validateCompliance(source, context.now);
    if (source.compliance?.mode !== "personal-use" || source.compliance?.automation_unspecified_acknowledged !== true) {
      throw new ProviderConfigError("infocasas requires explicit personal-use acknowledgement");
    }
    const maxListings = Number(source.max_listings ?? 10);
    const minInterval = Number(source.min_interval_ms ?? 0);
    if (!Number.isInteger(maxListings) || maxListings < 1 || maxListings > MAX_LISTINGS_CAP) {
      throw new ProviderConfigError(`infocasas max_listings must be an integer from 1 to ${MAX_LISTINGS_CAP}`);
    }
    if (!Number.isFinite(minInterval) || minInterval < MIN_INTERVAL_MS) {
      throw new ProviderConfigError(`infocasas min_interval_ms must be at least ${MIN_INTERVAL_MS}`);
    }
    if (Number(source.max_retries ?? 1) > 1) throw new ProviderConfigError("infocasas max_retries cannot exceed 1");

    const sitemapUrl = infoCasasUrl(source.url, "sitemap").href;
    const sitemap = await context.fetchText(sitemapUrl, { accept: "application/xml, text/xml" });
    const entries = parseInfoCasasSitemap(sitemap).slice(0, maxListings);
    const listings = [];
    for (const entry of entries) {
      const html = await context.fetchText(entry.url, { accept: "text/html", cache: false });
      const listing = parseInfoCasasListing(html, source, context.now, entry.url);
      listing._provider_payload.sitemap_lastmod = entry.lastmod;
      listings.push(listing);
    }
    return { listings };
  }
};
