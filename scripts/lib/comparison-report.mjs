import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function safe(value) {
  return String(value ?? "unknown").replace(/[\r\n]+/g, " ").replace(/([\\|\[\]`*_<>])/g, "\\$1");
}

function value(actual, provenance) {
  return `${safe(actual)} (${safe(provenance ?? "unknown")})`;
}

function money(price, currency, priceProvenance, currencyProvenance) {
  const amount = price === null ? "unknown" : price.toLocaleString("en-US");
  return `${safe(currency ?? "unknown currency")} ${safe(amount)} (price: ${safe(priceProvenance ?? "unknown")}; currency: ${safe(currencyProvenance ?? "unknown")})`;
}

function row(label, values) {
  return `| ${safe(label)} | ${values.map(safe).join(" | ")} |`;
}

export function renderComparisonReport(comparison) {
  const entries = comparison.listings;
  const headers = entries.map((entry) => `${safe(entry.title ?? entry.id)} (\`${entry.id}\`)`);
  const rows = [
    row("Tracker state", entries.map((entry) => entry.tracker?.state ?? "not tracked")),
    row("Availability", entries.map((entry) => entry.tracker?.availability ?? "unknown")),
    row("Operation", entries.map((entry) => value(entry.property.operation, entry.provenance["property.operation"]))),
    row("Property type", entries.map((entry) => value(entry.property.property_type, entry.provenance["property.property_type"]))),
    row("City", entries.map((entry) => value(entry.property.location.city, entry.provenance["property.location.city"]))),
    row("Neighborhood", entries.map((entry) => value(entry.property.location.neighborhood, entry.provenance["property.location.neighborhood"]))),
    row("Price", entries.map((entry) => money(entry.property.pricing.price, entry.property.pricing.currency, entry.provenance["property.pricing.price"], entry.provenance["property.pricing.currency"]))),
    row("Expenses", entries.map((entry) => money(entry.property.pricing.expenses, entry.property.pricing.expenses_currency, entry.provenance["property.pricing.expenses"], entry.provenance["property.pricing.expenses_currency"]))),
    row("Bedrooms", entries.map((entry) => value(entry.property.features.bedrooms, entry.provenance["property.features.bedrooms"]))),
    row("Bathrooms", entries.map((entry) => value(entry.property.features.bathrooms, entry.provenance["property.features.bathrooms"]))),
    row("Total area m²", entries.map((entry) => value(entry.property.features.area_total_m2, entry.provenance["property.features.area_total_m2"]))),
    row("Parking", entries.map((entry) => value(entry.property.features.parking_spaces, entry.provenance["property.features.parking_spaces"]))),
    row("Eligibility", entries.map((entry) => entry.evaluation.eligibility)),
    row("Score", entries.map((entry) => `${entry.evaluation.score_percentage}%`)),
    row("Maximum possible", entries.map((entry) => `${entry.evaluation.maximum_possible_percentage}%`)),
    row("Evidence coverage", entries.map((entry) => `${entry.evaluation.coverage_percentage}%`)),
    row("Recommendation", entries.map((entry) => entry.evaluation.recommendation)),
    row("Trade-offs", entries.map((entry) => entry.evaluation.trade_offs.join("; ") || "none")),
    row("Missing data", entries.map((entry) => entry.evaluation.missing_data.join("; ") || "none")),
    row("Red flags", entries.map((entry) => entry.evaluation.red_flags.join("; ") || "none")),
    row("Duplicate warning", entries.map((entry) => entry.duplicate.group_id ? `${entry.duplicate.group_id} (${entry.duplicate.confidence})` : "none"))
  ];
  return `# HomeOps Listing Comparison

- **Generated:** ${comparison.generated_at}
- **Inventory:** \`${safe(comparison.inventory_path)}\`
- **Tracker:** \`${safe(comparison.tracker_path)}\`
- **Profile:** \`${safe(comparison.profile_path)}\`

This is a neutral matrix, not a ranking. Unknown values are not unfavorable values, and monetary values in different currencies are not converted or ordered.

| Field | ${headers.join(" | ")} |
|---|${headers.map(() => "---").join("|")}|
${rows.join("\n")}
`;
}

async function atomicWrite(path, content) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function writeComparisonReports(directory, comparison) {
  await mkdir(directory, { recursive: true });
  const stem = `comparison-${comparison.generated_at.replace(/[:.]/g, "-")}`;
  const jsonPath = join(directory, `${stem}.json`);
  const markdownPath = join(directory, `${stem}.md`);
  await atomicWrite(jsonPath, `${JSON.stringify(comparison, null, 2)}\n`);
  await atomicWrite(markdownPath, renderComparisonReport(comparison));
  return { jsonPath, markdownPath };
}
