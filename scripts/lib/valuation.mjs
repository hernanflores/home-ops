import { normalizedKey } from "./normalize.mjs";

const CONFIDENCE_ORDER = ["insufficient", "low", "medium", "high"];

function round(value) {
  return Number(value.toFixed(2));
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function capConfidence(current, maximum) {
  return CONFIDENCE_ORDER[Math.min(CONFIDENCE_ORDER.indexOf(current), CONFIDENCE_ORDER.indexOf(maximum))];
}

export function validateValuationConfigSemantics(config) {
  const { low, central, high } = config.quantiles;
  if (!(low < central && central < high)) throw new Error("valuation quantiles must satisfy low < central < high");
  if (config.confidence.medium_count < config.minimum_comparables) throw new Error("confidence.medium_count must be at least minimum_comparables");
  if (config.confidence.high_count < config.confidence.medium_count) throw new Error("confidence.high_count must be at least confidence.medium_count");
  for (const [type, rule] of Object.entries(config.area_basis)) {
    if (rule.primary === rule.fallback) throw new Error(`area_basis.${type}.fallback must differ from primary`);
  }
}

function provenanceAllows(provenance, path, allowInferred) {
  const value = provenance[path] ?? "unknown";
  return value !== "unknown" && (value !== "inferred" || allowInferred);
}

function areaFor(property, provenance, config) {
  const rule = config.area_basis[property.property_type];
  if (!rule) return { value: null, basis: null, fallback: false, provenance: "unknown" };
  const feature = property.features[rule.primary];
  const primaryPath = `property.features.${rule.primary}`;
  if (feature != null && provenanceAllows(provenance, primaryPath, config.allow_inferred)) {
    return { value: feature, basis: rule.primary, fallback: false, provenance: provenance[primaryPath] };
  }
  if (rule.fallback) {
    const fallback = property.features[rule.fallback];
    const fallbackPath = `property.features.${rule.fallback}`;
    if (fallback != null && provenanceAllows(provenance, fallbackPath, config.allow_inferred)) {
      return { value: fallback, basis: rule.fallback, fallback: true, provenance: provenance[fallbackPath] };
    }
  }
  return { value: null, basis: null, fallback: false, provenance: "unknown" };
}

function currentObservationIds(observations) {
  const latest = new Map();
  for (const observation of observations) {
    if (!observation.listing_id) continue;
    const previous = latest.get(observation.listing_id);
    const timestamp = new Date(observation.observed_at).valueOf();
    const previousTimestamp = previous ? new Date(previous.observed_at).valueOf() : -Infinity;
    if (!previous || timestamp > previousTimestamp || (timestamp === previousTimestamp && observation.id > previous.id)) {
      latest.set(observation.listing_id, observation);
    }
  }
  return new Set([...latest.values()].map((observation) => observation.id));
}

function exclusion(observation, reason, detail) {
  return {
    observation_id: observation.id,
    listing_id: observation.listing_id,
    source_url: observation.source.url,
    reason,
    detail
  };
}

function comparable(observation, area, ageDays) {
  return {
    observation_id: observation.id,
    listing_id: observation.listing_id,
    source_url: observation.source.url,
    effective_at: observation.effective_at,
    age_days: ageDays,
    price: observation.property.pricing.price,
    currency: observation.property.pricing.currency,
    area_m2: area.value,
    area_basis: area.basis,
    area_fallback: area.fallback,
    area_provenance: area.provenance,
    price_per_m2: round(observation.property.pricing.price / area.value),
    duplicate_group: observation.duplicate.group_id
  };
}

function candidateReason(observation, context) {
  const { subject, subjectArea, config, now, currentIds } = context;
  if (!subjectArea.value) return ["subject_missing_area", "The subject has no permitted area basis"];
  if (observation.listing_id === subject.id) return ["subject_record", "The subject cannot be its own comparable"];
  if (subject.duplicate.group_id && observation.duplicate.group_id === subject.duplicate.group_id) return ["subject_duplicate", "The observation belongs to the subject duplicate group"];
  if (observation.listing_id && !currentIds.has(observation.id)) return ["superseded", "A newer observation exists for this listing"];
  const effective = observation.effective_at ?? observation.observed_at;
  const milliseconds = new Date(now) - new Date(effective);
  if (milliseconds < 0) return ["future_date", "The observation date is in the future"];
  const ageDays = Math.floor(milliseconds / 86_400_000);
  if (ageDays > config.freshness_days[subject.property.operation]) return ["stale", `The observation is ${ageDays} days old`];
  if (observation.property.operation !== subject.property.operation) return ["operation_mismatch", "Operation differs from the subject"];
  if (observation.property.property_type !== subject.property.property_type) return ["property_type_mismatch", "Property type differs from the subject"];
  if (normalizedKey(observation.property.location.country_code) !== normalizedKey(subject.property.location.country_code)) return ["location_mismatch", "Country differs from the subject"];
  if (normalizedKey(observation.property.location.city) !== normalizedKey(subject.property.location.city)) return ["location_mismatch", "City differs from the subject"];
  if (!subject.property.location.neighborhood || normalizedKey(observation.property.location.neighborhood) !== normalizedKey(subject.property.location.neighborhood)) return ["neighborhood_mismatch", "Exact normalized neighborhood differs from the subject"];
  if (observation.property.pricing.currency !== subject.property.pricing.currency) return ["currency_mismatch", "Currency differs from the subject; no conversion was performed"];
  if (observation.property.pricing.price == null) return ["missing_price", "Price is unknown"];
  if (observation.property.pricing.price <= 0) return ["invalid_price", "Price must be greater than zero"];
  const requiredPaths = [
    "property.operation", "property.property_type", "property.location.country_code",
    "property.location.city", "property.location.neighborhood", "property.pricing.price",
    "property.pricing.currency"
  ];
  if (requiredPaths.some((path) => !provenanceAllows(observation.provenance, path, config.allow_inferred))) {
    return ["disallowed_provenance", "A required field is unknown or inferred"];
  }
  return [null, { ageDays }];
}

function subjectProblem(subject, area, config) {
  if (!["rent", "sale"].includes(subject.property.operation)) return "Subject operation must be rent or sale";
  if (!config.area_basis[subject.property.property_type]) return "Subject property type has no area rule";
  if (!subject.property.location.country_code || !subject.property.location.city || !subject.property.location.neighborhood) return "Subject location is incomplete";
  if (!subject.property.pricing.currency) return "Subject currency is unknown";
  if (!area.value) return "Subject has no permitted area basis";
  const paths = [
    "property.operation", "property.property_type", "property.location.country_code",
    "property.location.city", "property.location.neighborhood", "property.pricing.currency"
  ];
  if (paths.some((path) => !provenanceAllows(subject.provenance, path, config.allow_inferred))) return "Subject has unknown or disallowed inferred evidence";
  return null;
}

function confidenceFor(included, statistics, subjectArea, operation, config) {
  if (!statistics) return { label: "insufficient", factors: [`Fewer than ${config.minimum_comparables} eligible comparables`] };
  let label = included.length >= config.confidence.high_count ? "high" : included.length >= config.confidence.medium_count ? "medium" : "low";
  const factors = [`${included.length} eligible comparables`];
  if (subjectArea.fallback || included.some((entry) => entry.area_fallback)) {
    label = capConfidence(label, "medium");
    factors.push("A configured fallback area basis was used");
  }
  const dispersion = statistics.central_price_per_m2 === 0 ? Infinity : (statistics.high_price_per_m2 - statistics.low_price_per_m2) / statistics.central_price_per_m2;
  if (dispersion > config.confidence.maximum_iqr_to_median) {
    label = capConfidence(label, "low");
    factors.push(`IQR-to-median dispersion ${round(dispersion)} exceeds ${config.confidence.maximum_iqr_to_median}`);
  }
  const freshnessLimit = Math.max(...included.map((entry) => entry.age_days));
  if (freshnessLimit > config.freshness_days[operation] / 2) {
    label = capConfidence(label, "medium");
    factors.push("At least one comparable is older than half the freshness window");
  }
  return { label, factors };
}

function rangeFor(evidenceType, observations, subject, subjectArea, config, now) {
  const candidates = observations.filter((observation) => observation.evidence_type === evidenceType);
  const currentIds = currentObservationIds(candidates);
  const included = [];
  const excluded = [];
  const usedDuplicateGroups = new Set();
  const problem = subjectProblem(subject, subjectArea, config);

  for (const observation of candidates.sort((left, right) => left.id.localeCompare(right.id))) {
    if (problem) {
      excluded.push(exclusion(observation, "subject_not_eligible", problem));
      continue;
    }
    const [reason, result] = candidateReason(observation, { subject, subjectArea, config, now, currentIds });
    if (reason) {
      excluded.push(exclusion(observation, reason, result));
      continue;
    }
    const area = areaFor(observation.property, observation.provenance, config);
    if (!area.value) {
      excluded.push(exclusion(observation, "missing_area", "No permitted area basis is available"));
      continue;
    }
    const group = observation.duplicate.group_id;
    if (group && usedDuplicateGroups.has(group)) {
      excluded.push(exclusion(observation, "duplicate_group", `Another observation represents duplicate group ${group}`));
      continue;
    }
    if (group) usedDuplicateGroups.add(group);
    included.push(comparable(observation, area, result.ageDays));
  }

  const values = included.map((entry) => entry.price_per_m2).sort((left, right) => left - right);
  let statistics = null;
  let estimate = null;
  if (values.length >= config.minimum_comparables) {
    statistics = {
      low_price_per_m2: round(quantile(values, config.quantiles.low)),
      central_price_per_m2: round(quantile(values, config.quantiles.central)),
      high_price_per_m2: round(quantile(values, config.quantiles.high))
    };
    estimate = {
      low: round(statistics.low_price_per_m2 * subjectArea.value),
      central: round(statistics.central_price_per_m2 * subjectArea.value),
      high: round(statistics.high_price_per_m2 * subjectArea.value)
    };
  }
  const confidence = confidenceFor(included, statistics, subjectArea, subject.property.operation, config);
  return {
    evidence_type: evidenceType,
    status: statistics ? "estimated" : "insufficient_evidence",
    currency: subject.property.pricing.currency,
    eligible_count: included.length,
    statistics,
    estimate,
    confidence,
    included,
    excluded
  };
}

export function valueListing(subject, observations, config, context) {
  validateValuationConfigSemantics(config);
  const subjectArea = areaFor(subject.property, subject.provenance, config);
  const evidenceTypes = subject.property.operation === "sale" ? ["listing_ask", "verified_closed_sale"] : ["listing_ask"];
  const ranges = evidenceTypes.map((type) => rangeFor(type, observations, subject, subjectArea, config, context.now));
  return {
    schema_version: 1,
    generated_at: context.now,
    inventory_path: context.inventoryPath,
    observations_path: context.observationsPath,
    config_path: context.configPath,
    region_path: context.regionPath,
    subject: {
      listing_id: subject.id,
      source_url: subject.source.url,
      operation: subject.property.operation,
      property_type: subject.property.property_type,
      country_code: subject.property.location.country_code,
      city: subject.property.location.city,
      neighborhood: subject.property.location.neighborhood,
      currency: subject.property.pricing.currency,
      area_m2: subjectArea.value,
      area_basis: subjectArea.basis,
      area_fallback: subjectArea.fallback,
      area_provenance: subjectArea.provenance
    },
    method: {
      geography: "exact_normalized_neighborhood",
      currency: "same_currency_only",
      statistic: "median_price_per_m2_with_interquartile_range",
      minimum_comparables: config.minimum_comparables,
      outlier_removal: false,
      quantiles: { ...config.quantiles },
      freshness_days: config.freshness_days[subject.property.operation] ?? null,
      area_rule: config.area_basis[subject.property.property_type] ? { ...config.area_basis[subject.property.property_type] } : null,
      allow_inferred: config.allow_inferred,
      confidence_thresholds: { ...config.confidence }
    },
    ranges,
    assumptions: [
      "Listing asks and verified closed sales are calculated separately and never blended.",
      "No currency conversion is performed.",
      "The estimate applies observed price-per-square-meter quantiles to the subject area.",
      "No statistical outliers are removed; every included and excluded candidate is disclosed."
    ],
    limitations: [
      "Listing prices are asking prices and do not establish completed transaction values.",
      "Condition and unmodeled property characteristics are not adjusted in this baseline.",
      "Evidence confidence is not a statistical confidence interval or professional appraisal confidence."
    ],
    disclaimer: "This automated comparable-listing estimate is informational and is not a professional appraisal."
  };
}
