import { normalizedKey } from "./normalize.mjs";

const MONETARY_CURRENCIES = {
  "property.pricing.price": "property.pricing.currency",
  "property.pricing.expenses": "property.pricing.expenses_currency"
};

const STRING_FIELDS = new Set([
  "property.operation", "property.property_type", "property.location.country_code",
  "property.location.admin_area", "property.location.city", "property.location.neighborhood",
  "property.pricing.currency", "property.pricing.expenses_currency", "freshness.state"
]);

const NUMBER_FIELDS = new Set([
  "property.pricing.price", "property.pricing.expenses", "property.features.bedrooms",
  "property.features.bathrooms", "property.features.area_total_m2",
  "property.features.area_covered_m2", "property.features.parking_spaces"
]);

const LOCATION_FIELDS = new Set([
  "property.location.country_code", "property.location.admin_area",
  "property.location.city", "property.location.neighborhood"
]);

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function textKey(value) {
  return String(value).trim().toLocaleLowerCase("en-US");
}

function comparisonKey(value, field) {
  return LOCATION_FIELDS.has(field) ? normalizedKey(value) : textKey(value);
}

function display(value) {
  if (value === null || value === undefined) return "unknown";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function compare(actual, operator, expected, field) {
  if (operator === "equals") {
    return typeof actual === "string" && typeof expected === "string"
      ? comparisonKey(actual, field) === comparisonKey(expected, field)
      : actual === expected;
  }
  if (operator === "one_of") {
    return expected.some((value) => comparisonKey(actual, field) === comparisonKey(value, field));
  }
  if (operator === "at_least") return actual >= expected;
  if (operator === "at_most") return actual <= expected;
  throw new Error(`Unsupported operator: ${operator}`);
}

function validateCriterion(criterion) {
  if (criterion.operator === "one_of" && !Array.isArray(criterion.value)) {
    throw new Error(`${criterion.id}: one_of requires an array value`);
  }
  if (criterion.operator !== "one_of" && Array.isArray(criterion.value)) {
    throw new Error(`${criterion.id}: ${criterion.operator} requires a scalar value`);
  }
  if (["at_least", "at_most"].includes(criterion.operator) && typeof criterion.value !== "number") {
    throw new Error(`${criterion.id}: ${criterion.operator} requires a numeric value`);
  }
  if (STRING_FIELDS.has(criterion.field)) {
    if (!["equals", "one_of"].includes(criterion.operator)) {
      throw new Error(`${criterion.id}: ${criterion.field} supports only equals or one_of`);
    }
    const values = Array.isArray(criterion.value) ? criterion.value : [criterion.value];
    if (values.some((value) => typeof value !== "string")) throw new Error(`${criterion.id}: ${criterion.field} requires string values`);
  }
  if (NUMBER_FIELDS.has(criterion.field)) {
    if (criterion.operator === "one_of") throw new Error(`${criterion.id}: ${criterion.field} does not support one_of`);
    if (typeof criterion.value !== "number") throw new Error(`${criterion.id}: ${criterion.field} requires a numeric value`);
  }
  if (MONETARY_CURRENCIES[criterion.field] && !criterion.currency) {
    throw new Error(`${criterion.id}: ${criterion.field} requires currency`);
  }
  if (!MONETARY_CURRENCIES[criterion.field] && criterion.currency) {
    throw new Error(`${criterion.id}: currency is only valid for monetary fields`);
  }
}

export function validateProfileSemantics(profile) {
  if (!Number.isInteger(profile.stale_after_days) || profile.stale_after_days < 0) {
    throw new Error("stale_after_days must be a non-negative integer");
  }
  if (profile.weighted_criteria.length === 0) throw new Error("weighted_criteria must contain at least one criterion");
  if (profile.recommendation.visit_score <= 0 || profile.recommendation.prioritize_score <= 0) {
    throw new Error("recommendation thresholds must be greater than zero");
  }
  const criteria = [...profile.hard_filters, ...profile.weighted_criteria];
  const ids = new Set();
  for (const criterion of criteria) {
    if (ids.has(criterion.id)) throw new Error(`Duplicate criterion id: ${criterion.id}`);
    ids.add(criterion.id);
    validateCriterion(criterion);
  }
  if (profile.recommendation.prioritize_score < profile.recommendation.visit_score) {
    throw new Error("recommendation.prioritize_score must be greater than or equal to visit_score");
  }
  const discardBelowScore = profile.recommendation.discard_below_score ?? 0;
  if (discardBelowScore > profile.recommendation.visit_score) {
    throw new Error("recommendation.discard_below_score must be less than or equal to visit_score");
  }
}

function criterionResult(listing, criterion) {
  const actual = getPath(listing, criterion.field);
  const provenance = criterion.field === "freshness.state"
    ? (actual === "unknown" ? "unknown" : "verified")
    : listing.provenance[criterion.field] ?? "unknown";
  const currencyPath = MONETARY_CURRENCIES[criterion.field];
  const currencyProvenance = currencyPath ? listing.provenance[currencyPath] ?? "unknown" : "unknown";
  const actualCurrency = currencyPath ? getPath(listing, currencyPath) ?? null : null;
  const base = {
    id: criterion.id,
    label: criterion.label,
    field: criterion.field,
    operator: criterion.operator,
    expected: criterion.value,
    actual: actual ?? null,
    provenance,
    expected_currency: criterion.currency ?? null,
    actual_currency: actualCurrency,
    actual_currency_provenance: currencyProvenance,
    allow_inferred: criterion.allow_inferred ?? false
  };

  if (actual === null || actual === undefined || actual === "unknown" || provenance === "unknown") {
    return { ...base, outcome: "unknown", reason: `${criterion.field} is unknown` };
  }
  if (provenance === "inferred" && !criterion.allow_inferred) {
    return { ...base, outcome: "unknown", reason: `${criterion.field} is inferred but this criterion does not allow inferred evidence` };
  }

  if (currencyPath) {
    if (!actualCurrency || currencyProvenance === "unknown") {
      return { ...base, outcome: "unknown", reason: `${currencyPath} is unknown; ${criterion.currency} comparison was not performed` };
    }
    if (actualCurrency !== criterion.currency) {
      return { ...base, outcome: "unknown", reason: `currency is ${actualCurrency}, not ${criterion.currency}; HomeOps does not convert currencies` };
    }
    if (currencyProvenance === "inferred" && !criterion.allow_inferred) {
      return { ...base, outcome: "unknown", reason: `${currencyPath} is inferred but this criterion does not allow inferred evidence` };
    }
  }

  const passed = compare(actual, criterion.operator, criterion.value, criterion.field);
  return {
    ...base,
    outcome: passed ? "pass" : "fail",
    reason: `${display(actual)} ${passed ? "satisfies" : "does not satisfy"} ${criterion.operator} ${display(criterion.value)}`
  };
}

function currentFreshness(listing, now, staleAfterDays) {
  const basis = listing.source.published_at ? "published_at" : listing.last_seen_at ? "retrieved_at" : "unknown";
  if (basis === "unknown") return { state: "unknown", basis, age_days: null };
  const timestamp = basis === "published_at" ? listing.source.published_at : listing.last_seen_at;
  const milliseconds = new Date(now) - new Date(timestamp);
  if (milliseconds < 0) return { state: "unknown", basis, age_days: null, anomaly: "future_timestamp" };
  const ageDays = Math.floor(milliseconds / 86_400_000);
  return { state: ageDays > staleAfterDays ? "potentially_stale" : "fresh", basis, age_days: ageDays, anomaly: null };
}

function unique(values) {
  return [...new Set(values)];
}

export function evaluateListing(listing, profile, context) {
  validateProfileSemantics(profile);
  const evaluatedListing = { ...listing, freshness: currentFreshness(listing, context.now, profile.stale_after_days) };
  const hardFilters = profile.hard_filters.map((criterion) => criterionResult(evaluatedListing, criterion));
  const weighted = profile.weighted_criteria.map((criterion) => {
    const result = criterionResult(evaluatedListing, criterion);
    return { ...result, weight: criterion.weight, earned: result.outcome === "pass" ? criterion.weight : 0 };
  });
  const maximum = weighted.reduce((sum, result) => sum + result.weight, 0);
  const earned = weighted.reduce((sum, result) => sum + result.earned, 0);
  const evidenceWeight = weighted.filter((result) => result.outcome !== "unknown").reduce((sum, result) => sum + result.weight, 0);
  const unknownWeight = weighted.filter((result) => result.outcome === "unknown").reduce((sum, result) => sum + result.weight, 0);
  const percentage = maximum === 0 ? 0 : Number((earned / maximum * 100).toFixed(2));
  const coveragePercentage = maximum === 0 ? 100 : Number((evidenceWeight / maximum * 100).toFixed(2));
  const maximumPossibleEarned = earned + unknownWeight;
  const maximumPossiblePercentage = maximum === 0 ? 100 : Number((maximumPossibleEarned / maximum * 100).toFixed(2));
  const eligibility = hardFilters.some((result) => result.outcome === "fail")
    ? "ineligible"
    : hardFilters.some((result) => result.outcome === "unknown") ? "indeterminate" : "eligible";

  const discardBelowScore = profile.recommendation.discard_below_score ?? 0;
  let recommendation = "monitor";
  if (eligibility === "ineligible") recommendation = "discard";
  else if (maximumPossiblePercentage < discardBelowScore) recommendation = "discard";
  else if (eligibility === "eligible" && percentage >= profile.recommendation.prioritize_score) recommendation = "prioritize";
  else if (eligibility === "eligible" && percentage >= profile.recommendation.visit_score) recommendation = "visit";

  const allResults = [...hardFilters, ...weighted];
  const matches = unique(allResults.filter((result) => result.outcome === "pass").map((result) => result.label));
  const tradeOffs = unique(weighted.filter((result) => result.outcome === "fail").map((result) => result.label));
  const missingData = unique(allResults.filter((result) => result.outcome === "unknown").map((result) => `${result.label}: ${result.reason}`));
  const questions = unique(allResults.filter((result) => result.outcome === "unknown").map((result) => `Can the owner or broker confirm: ${result.label}?`));
  const redFlags = [];
  if (evaluatedListing.freshness.state === "potentially_stale") {
    redFlags.push(`Listing may be stale (${evaluatedListing.freshness.age_days} days; basis: ${evaluatedListing.freshness.basis})`);
  }
  if (evaluatedListing.freshness.anomaly === "future_timestamp") {
    redFlags.push(`Freshness timestamp is in the future (basis: ${evaluatedListing.freshness.basis})`);
  }
  if (listing.duplicate.group_id) {
    redFlags.push(`Possible duplicate record ${listing.duplicate.group_id} (${listing.duplicate.confidence} confidence)`);
  }
  if (!listing.source.url) redFlags.push("No source URL is available for verification");
  redFlags.push(...hardFilters.filter((result) => result.outcome === "fail").map((result) => `Failed hard filter: ${result.label}`));
  if (maximumPossiblePercentage < discardBelowScore) {
    redFlags.push(`Maximum possible weighted score ${maximumPossiblePercentage}% is below the ${discardBelowScore}% discard floor`);
  }

  const assumptions = [
    "Unknown weighted criteria earn zero points; evidence coverage is reported separately.",
    "The discard floor uses the maximum possible score, so unknown weighted criteria are not treated as failures.",
    "Inferred values are evidence only when a criterion explicitly allows them.",
    "Monetary values are compared only in the configured currency; no currency conversion is performed."
  ];
  assumptions.push(`Freshness is recalculated at evaluation time using a ${profile.stale_after_days}-day threshold.`);
  if (evaluatedListing.freshness.basis === "retrieved_at") {
    assumptions.push("Freshness is based on retrieval time, not a verified publication date.");
  }

  return {
    schema_version: 1,
    evaluated_at: context.now,
    profile: {
      schema_version: profile.schema_version,
      name: profile.name,
      path: context.profilePath,
      stale_after_days: profile.stale_after_days,
      recommendation: { discard_below_score: discardBelowScore, ...profile.recommendation }
    },
    listing: {
      id: listing.id,
      inventory_path: context.inventoryPath,
      provider: listing.source.provider,
      external_id: listing.source.external_id,
      source_url: listing.source.url
    },
    eligibility,
    hard_filters: hardFilters,
    score: {
      earned,
      maximum,
      percentage,
      evidence_weight: evidenceWeight,
      coverage_percentage: coveragePercentage,
      maximum_possible_earned: maximumPossibleEarned,
      maximum_possible_percentage: maximumPossiblePercentage,
      criteria: weighted
    },
    matches,
    trade_offs: tradeOffs,
    missing_data: missingData,
    red_flags: unique(redFlags),
    assumptions,
    questions,
    recommendation
  };
}
