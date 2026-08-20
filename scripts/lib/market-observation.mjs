import { createHash } from "node:crypto";

function canonical(input) {
  if (Array.isArray(input)) return input.map(canonical);
  if (!input || typeof input !== "object") return input;
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]));
}

function stableJson(value) {
  return JSON.stringify(canonical(value));
}

function observationId(value) {
  return `obs_${createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 16)}`;
}

function listingIdentity(core) {
  return {
    evidence_type: core.evidence_type,
    observed_at: core.observed_at,
    effective_at: core.effective_at,
    listing_id: core.listing_id,
    source: core.source,
    property: core.property,
    provenance: core.provenance,
    duplicate: core.duplicate
  };
}

function closedSaleIdentity(core) {
  return {
    evidence_type: core.evidence_type,
    provider: core.source.provider,
    external_id: core.source.external_id,
    source_reference: core.source.reference,
    verification_reference: core.verification.reference
  };
}

function normalizeCondition(value, strict = true) {
  if (value == null || value === "") return "unknown";
  const key = String(value).trim().toLocaleLowerCase("es-UY").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const conditions = {
    new: "new", nuevo: "new", "a estrenar": "new",
    renovated: "renovated", renovado: "renovated", reciclado: "renovated", refaccionado: "renovated",
    good: "good", "buen estado": "good",
    fair: "fair", regular: "fair",
    poor: "poor", "mal estado": "poor", "a reciclar": "poor",
    unknown: "unknown", desconocido: "unknown"
  };
  if (!conditions[key]) {
    if (strict) throw new Error(`Unsupported property condition: ${value}`);
    return "unknown";
  }
  return conditions[key];
}

function listingCondition(listing) {
  const value = listing.original?.condition ?? listing.original?.property_condition ?? listing.original?.estado;
  const condition = normalizeCondition(value, false);
  return { condition, provenance: condition === "unknown" ? "unknown" : "reported" };
}

function valuationChangedAt(listing) {
  const relevant = new Set(["property.operation", "property.property_type", "property.location", "property.pricing", "property.features", "provenance", "original"]);
  for (let index = listing.history.length - 1; index >= 0; index -= 1) {
    const event = listing.history[index];
    if (Object.keys(event.changes).some((path) => relevant.has(path))) return event.at;
  }
  return listing.history.length ? listing.first_seen_at : listing.last_changed_at;
}

function relevantProvenance(listing) {
  const paths = [
    "property.operation", "property.property_type", "property.location.country_code",
    "property.location.city", "property.location.neighborhood", "property.pricing.price",
    "property.pricing.currency", "property.features.area_total_m2", "property.features.area_covered_m2"
  ];
  return Object.fromEntries(paths.map((path) => [path, listing.provenance[path] ?? "unknown"]));
}

export function listingObservation(listing) {
  const observedAt = valuationChangedAt(listing);
  const condition = listingCondition(listing);
  const provenance = relevantProvenance(listing);
  provenance["property.condition"] = condition.provenance;
  const core = {
    evidence_type: "listing_ask",
    observed_at: observedAt,
    effective_at: observedAt,
    date_basis: "observed_at",
    listing_id: listing.id,
    source: {
      provider: listing.source.provider,
      external_id: listing.source.external_id,
      url: listing.source.url,
      reference: null
    },
    property: {
      operation: listing.property.operation,
      property_type: listing.property.property_type,
      location: {
        country_code: listing.property.location.country_code,
        city: listing.property.location.city,
        neighborhood: listing.property.location.neighborhood
      },
      pricing: {
        price: listing.property.pricing.price,
        currency: listing.property.pricing.currency
      },
      features: {
        area_total_m2: listing.property.features.area_total_m2,
        area_covered_m2: listing.property.features.area_covered_m2
      },
      condition: condition.condition
    },
    provenance,
    duplicate: {
      group_id: listing.duplicate.group_id,
      confidence: listing.duplicate.confidence
    },
    verification: { status: "source_listing", reference: null, verified_at: null }
  };
  return { schema_version: 1, id: observationId(listingIdentity(core)), ...core };
}

export function importedClosedSale(input) {
  if (input.evidence_type !== "verified_closed_sale") throw new Error("Imported market evidence must explicitly declare evidence_type: verified_closed_sale");
  if (input.property?.operation !== "sale") throw new Error("verified_closed_sale evidence requires property.operation: sale");
  const condition = normalizeCondition(input.property?.condition);
  const core = {
    evidence_type: input.evidence_type,
    observed_at: input.observed_at,
    effective_at: input.effective_at,
    date_basis: "verified_closed_at",
    listing_id: input.listing_id ?? null,
    source: input.source,
    property: { ...input.property, condition },
    provenance: {
      ...(input.provenance ?? {}),
      "property.condition": input.provenance?.["property.condition"] ?? (condition === "unknown" ? "unknown" : "reported")
    },
    duplicate: input.duplicate ?? { group_id: null, confidence: "none" },
    verification: input.verification
  };
  return { schema_version: 1, id: observationId(closedSaleIdentity(core)), ...core };
}

export function mergeObservations(existing, incoming) {
  const byId = new Map(existing.map((record) => [record.id, record]));
  const added = [];
  for (const record of incoming) {
    const previous = byId.get(record.id);
    if (previous) {
      if (record.evidence_type === "verified_closed_sale" && stableJson(previous) !== stableJson(record)) {
        throw new Error(`Conflicting market observation identity: ${record.id}`);
      }
      continue;
    }
    byId.set(record.id, record);
    added.push(record.id);
  }
  return { records: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)), added };
}
