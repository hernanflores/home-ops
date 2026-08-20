import { createHash } from "node:crypto";

const FIELD_ALIASES = {
  externalId: ["external_id", "listing_id", "id"],
  url: ["url", "source_url", "link"],
  publishedAt: ["published_at", "published_date", "date_published"],
  operation: ["operation", "transaction_type", "offer_type"],
  propertyType: ["property_type", "type", "category"],
  title: ["title", "name"],
  description: ["description", "details"],
  countryCode: ["country_code", "location.country_code"],
  adminArea: ["admin_area", "department", "state", "location.admin_area"],
  city: ["city", "location.city"],
  neighborhood: ["neighborhood", "barrio", "location.neighborhood"],
  address: ["address", "direccion", "location.address"],
  price: ["price", "amount", "pricing.price"],
  currency: ["currency", "price_currency", "pricing.currency"],
  expenses: ["expenses", "common_expenses", "gastos_comunes", "pricing.expenses"],
  expensesCurrency: ["expenses_currency", "pricing.expenses_currency"],
  bedrooms: ["bedrooms", "rooms", "dormitorios", "features.bedrooms"],
  bathrooms: ["bathrooms", "banos", "features.bathrooms"],
  areaTotal: ["area_total_m2", "total_area", "area", "features.area_total_m2"],
  areaCovered: ["area_covered_m2", "covered_area", "features.area_covered_m2"],
  parking: ["parking_spaces", "garages", "garage", "features.parking_spaces"]
};

const REQUIRED_LEAVES = [
  "property.operation", "property.property_type", "property.title", "property.description",
  "property.location.country_code", "property.location.admin_area", "property.location.city",
  "property.location.neighborhood", "property.location.address", "property.pricing.price",
  "property.pricing.currency", "property.pricing.expenses", "property.pricing.expenses_currency",
  "property.features.bedrooms", "property.features.bathrooms", "property.features.area_total_m2",
  "property.features.area_covered_m2", "property.features.parking_spaces",
  "source.external_id", "source.url", "source.published_at"
];

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function pick(raw, aliases) {
  for (const alias of aliases) {
    const value = getPath(raw, alias);
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return { value, alias };
    }
  }
  return { value: null, alias: null };
}

function text(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).replace(/\s+/g, " ").trim();
  return result || null;
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const input = text(value)?.replace(/[^\d,.-]/g, "");
  if (!input) return null;

  const comma = input.lastIndexOf(",");
  const dot = input.lastIndexOf(".");
  let normalized = input;
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    normalized = input.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const parts = input.split(separator);
    normalized = parts.length > 2 || parts.at(-1).length === 3
      ? parts.join("")
      : `${parts[0]}.${parts[1]}`;
  }
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}

function dateTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function normalizedKey(value) {
  return text(value)?.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

export function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => /^(?:access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i.test(key))) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeOriginal(value, key = "") {
  if (/^(?:authorization|proxy-authorization|cookie|password|access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeOriginal(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeOriginal(entryValue, entryKey)]));
  }
  if (typeof value !== "string") return value;
  const bearerSafe = value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [REDACTED]");
  try {
    const url = new URL(bearerSafe);
    url.username = "";
    url.password = "";
    for (const queryKey of [...url.searchParams.keys()]) {
      if (/^(?:access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i.test(queryKey)) {
        url.searchParams.set(queryKey, "[REDACTED]");
      }
    }
    return url.href;
  } catch {
    return bearerSafe;
  }
}

function operation(value) {
  const key = normalizedKey(value);
  if (["rent", "rental", "alquiler", "alquilar"].includes(key)) return "rent";
  if (["sale", "sell", "venta", "comprar", "purchase"].includes(key)) return "sale";
  return "unknown";
}

function propertyType(value) {
  const key = normalizedKey(value);
  if (["apartment", "apartamento", "apto", "departamento"].includes(key)) return "apartment";
  if (["house", "casa", "chalet"].includes(key)) return "house";
  if (["land", "terreno", "lote"].includes(key)) return "land";
  if (["commercial", "comercial", "local", "office", "oficina"].includes(key)) return "commercial";
  return key ? "other" : "unknown";
}

function currency(value) {
  const key = normalizedKey(value).replace(/\s/g, "");
  const mapped = { usd: "USD", us: "USD", uyu: "UYU", pesos: "UYU", peso: "UYU" }[key];
  return mapped ?? (key.length === 3 ? key.toUpperCase() : null);
}

function stableId(provider, externalId, url, fingerprint) {
  const identity = externalId ? `external:${externalId}` : url ? `url:${url}` : `fingerprint:${fingerprint}`;
  return `lst_${createHash("sha256").update(`${provider}\0${identity}`).digest("hex").slice(0, 16)}`;
}

export function normalizeListing(raw, region, now) {
  const values = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([key, aliases]) => [key, pick(raw, aliases)]));
  const provider = text(raw._home_ops_source?.provider) ?? "local";
  const retrievedAt = dateTime(raw._home_ops_source?.retrieved_at) ?? now;
  const url = normalizeUrl(values.url.value);
  const externalId = text(values.externalId.value);
  const price = number(values.price.value);
  const explicitCurrency = currency(values.currency.value);
  const inferredCurrency = price !== null && !explicitCurrency ? region.currency : null;
  const expenses = number(values.expenses.value);
  const explicitExpensesCurrency = currency(values.expensesCurrency.value);
  const expensesCurrency = explicitExpensesCurrency ?? (expenses !== null ? explicitCurrency ?? inferredCurrency : null);
  const rawNeighborhood = text(values.neighborhood.value);
  const neighborhoodAlias = region.neighborhood_aliases?.[normalizedKey(rawNeighborhood).replace(/ /g, "_")];
  const inferredFields = new Set(raw._home_ops_inferred_fields ?? []);
  const sourceState = (path, alias, fallback = null) => alias
    ? (inferredFields.has(path) ? "inferred" : "reported")
    : fallback;

  const property = {
    operation: operation(values.operation.value),
    property_type: propertyType(values.propertyType.value),
    title: text(values.title.value),
    description: text(values.description.value),
    location: {
      country_code: text(values.countryCode.value)?.toUpperCase() ?? region.country_code ?? null,
      admin_area: text(values.adminArea.value),
      city: text(values.city.value) ?? region.city ?? null,
      neighborhood: neighborhoodAlias ?? rawNeighborhood,
      address: text(values.address.value)
    },
    pricing: {
      price,
      currency: explicitCurrency ?? inferredCurrency,
      expenses,
      expenses_currency: expensesCurrency
    },
    features: {
      bedrooms: number(values.bedrooms.value),
      bathrooms: number(values.bathrooms.value),
      area_total_m2: number(values.areaTotal.value),
      area_covered_m2: number(values.areaCovered.value),
      parking_spaces: number(values.parking.value)
    }
  };

  const fingerprint = JSON.stringify([
    property.operation, property.property_type, normalizedKey(property.location.address),
    normalizedKey(property.location.neighborhood), property.pricing.price,
    property.features.bedrooms, property.features.area_total_m2
  ]);

  const publishedAt = dateTime(values.publishedAt.value);
  const provenance = {
    "source.external_id": sourceState("source.external_id", values.externalId.alias, "unknown"),
    "source.url": url ? "verified" : "unknown",
    "source.published_at": sourceState("source.published_at", values.publishedAt.alias, "unknown"),
    "property.operation": sourceState("property.operation", values.operation.alias, "unknown"),
    "property.property_type": sourceState("property.property_type", values.propertyType.alias, "unknown"),
    "property.title": sourceState("property.title", values.title.alias, "unknown"),
    "property.description": sourceState("property.description", values.description.alias, "unknown"),
    "property.location.country_code": sourceState("property.location.country_code", values.countryCode.alias, region.country_code ? "inferred" : "unknown"),
    "property.location.admin_area": sourceState("property.location.admin_area", values.adminArea.alias, "unknown"),
    "property.location.city": sourceState("property.location.city", values.city.alias, region.city ? "inferred" : "unknown"),
    "property.location.neighborhood": sourceState("property.location.neighborhood", values.neighborhood.alias, "unknown"),
    "property.location.address": sourceState("property.location.address", values.address.alias, "unknown"),
    "property.pricing.price": sourceState("property.pricing.price", values.price.alias, "unknown"),
    "property.pricing.currency": explicitCurrency
      ? sourceState("property.pricing.currency", values.currency.alias, "unknown")
      : inferredCurrency ? "inferred" : "unknown",
    "property.pricing.expenses": sourceState("property.pricing.expenses", values.expenses.alias, "unknown"),
    "property.pricing.expenses_currency": explicitExpensesCurrency
      ? sourceState("property.pricing.expenses_currency", values.expensesCurrency.alias, "unknown")
      : expensesCurrency ? "inferred" : "unknown",
    "property.features.bedrooms": sourceState("property.features.bedrooms", values.bedrooms.alias, "unknown"),
    "property.features.bathrooms": sourceState("property.features.bathrooms", values.bathrooms.alias, "unknown"),
    "property.features.area_total_m2": sourceState("property.features.area_total_m2", values.areaTotal.alias, "unknown"),
    "property.features.area_covered_m2": sourceState("property.features.area_covered_m2", values.areaCovered.alias, "unknown"),
    "property.features.parking_spaces": sourceState("property.features.parking_spaces", values.parking.alias, "unknown")
  };

  const canonicalValues = {
    "source.external_id": externalId,
    "source.url": url,
    "source.published_at": publishedAt,
    ...Object.fromEntries(Object.keys(provenance)
      .filter((path) => path.startsWith("property."))
      .map((path) => [path, path.split(".").slice(1).reduce((value, key) => value?.[key], property)]))
  };
  for (const [path, value] of Object.entries(canonicalValues)) {
    if (value === null || value === undefined || value === "unknown") provenance[path] = "unknown";
  }

  const original = sanitizeOriginal(structuredClone(raw));
  delete original._home_ops_source;
  delete original._home_ops_inferred_fields;

  return {
    schema_version: 1,
    id: stableId(provider, externalId, url, fingerprint),
    status: "new",
    first_seen_at: now,
    last_seen_at: now,
    last_changed_at: now,
    freshness: { state: "unknown", basis: "unknown", age_days: null },
    source: { provider, external_id: externalId, url, retrieved_at: retrievedAt, published_at: publishedAt },
    property,
    provenance,
    unknown_fields: REQUIRED_LEAVES.filter((path) => provenance[path] === "unknown"),
    duplicate: { group_id: null, confidence: "none", reasons: [] },
    history: [],
    original
  };
}

export function applyFreshness(listing, now, staleAfterDays) {
  const basis = listing.source.published_at ? "published_at" : listing.last_seen_at ? "retrieved_at" : "unknown";
  if (basis === "unknown") return { state: "unknown", basis, age_days: null };
  const timestamp = basis === "published_at" ? listing.source.published_at : listing.last_seen_at;
  const ageDays = Math.max(0, Math.floor((new Date(now) - new Date(timestamp)) / 86_400_000));
  return {
    state: ageDays > staleAfterDays ? "potentially_stale" : "fresh",
    basis,
    age_days: ageDays
  };
}
