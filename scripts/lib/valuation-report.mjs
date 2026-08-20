import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function safe(value) {
  return String(value ?? "unknown").replace(/[\r\n]+/g, " ").replace(/([\\|\[\]`*_<>])/g, "\\$1");
}

function money(value, currency) {
  return value == null ? "unknown" : `${safe(currency)} ${value.toLocaleString("en-US")}`;
}

function includedTable(entries) {
  if (!entries.length) return "None.";
  const rows = entries.map((entry) => `| \`${entry.observation_id}\` | ${safe(entry.listing_id)} | ${safe(entry.source_url)} | ${money(entry.price, entry.currency)} | ${entry.area_m2} (${safe(entry.area_basis)}${entry.area_fallback ? ", fallback" : ""}) | ${entry.price_per_m2} | ${entry.age_days} | ${safe(entry.duplicate_group)} |`);
  return `| Observation | Listing | Source | Price | Area m² | Price/m² | Age days | Duplicate group |\n|---|---|---|---:|---|---:|---:|---|\n${rows.join("\n")}`;
}

function excludedTable(entries) {
  if (!entries.length) return "None.";
  const rows = entries.map((entry) => `| \`${entry.observation_id}\` | ${safe(entry.listing_id)} | ${safe(entry.source_url)} | ${safe(entry.reason)} | ${safe(entry.detail)} |`);
  return `| Observation | Listing | Source | Reason | Detail |\n|---|---|---|---|---|\n${rows.join("\n")}`;
}

function rangeSection(range, operation) {
  const label = range.evidence_type === "listing_ask"
    ? (operation === "rent" ? "Monthly Asking Rents" : "Sale Asking Prices")
    : "Verified Closed Sales";
  const result = range.status === "estimated"
    ? `- **Range:** ${money(range.estimate.low, range.currency)} to ${money(range.estimate.high, range.currency)}\n- **Central estimate:** ${money(range.estimate.central, range.currency)}\n- **Price/m² (Q1 / median / Q3):** ${range.statistics.low_price_per_m2} / ${range.statistics.central_price_per_m2} / ${range.statistics.high_price_per_m2}`
    : "- **Result:** Insufficient evidence; no estimate was produced.";
  return `## ${label}

- **Evidence type:** \`${range.evidence_type}\`
- **Eligible comparables:** ${range.eligible_count}
- **Evidence confidence:** ${range.confidence.label}
- **Confidence factors:** ${range.confidence.factors.map(safe).join("; ")}
${result}

### Included

${includedTable(range.included)}

### Excluded

${excludedTable(range.excluded)}
`;
}

export function renderValuationReport(valuation) {
  return `# HomeOps Market Valuation

- **Generated:** ${valuation.generated_at}
- **Subject:** \`${valuation.subject.listing_id}\`
- **Operation:** ${safe(valuation.subject.operation)}
- **Property type:** ${safe(valuation.subject.property_type)}
- **Location:** ${safe(valuation.subject.neighborhood)}, ${safe(valuation.subject.city)}
- **Subject area:** ${safe(valuation.subject.area_m2)} m² (${safe(valuation.subject.area_basis)}${valuation.subject.area_fallback ? ", fallback" : ""}; ${safe(valuation.subject.area_provenance)})
- **Currency policy:** same currency only; no conversion
- **Inventory:** \`${safe(valuation.inventory_path)}\`
- **Market evidence:** \`${safe(valuation.observations_path)}\`
- **Configuration:** \`${safe(valuation.config_path)}\`

> ${safe(valuation.disclaimer)}

Listing asking prices are not completed transaction prices. Asking-price and verified closed-sale evidence are calculated separately and never blended.

${valuation.ranges.map((range) => rangeSection(range, valuation.subject.operation)).join("\n")}

## Assumptions

${valuation.assumptions.map((item) => `- ${safe(item)}`).join("\n")}

## Limitations

${valuation.limitations.map((item) => `- ${safe(item)}`).join("\n")}
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

export async function writeValuationReports(directory, valuation) {
  await mkdir(directory, { recursive: true });
  const digest = createHash("sha256").update(JSON.stringify(valuation)).digest("hex").slice(0, 8);
  const stem = `valuation-${valuation.subject.listing_id}-${valuation.generated_at.replace(/[:.]/g, "-")}-${digest}`;
  const jsonPath = join(directory, `${stem}.json`);
  const markdownPath = join(directory, `${stem}.md`);
  await atomicWrite(jsonPath, `${JSON.stringify(valuation, null, 2)}\n`);
  await atomicWrite(markdownPath, renderValuationReport(valuation));
  return { jsonPath, markdownPath };
}
