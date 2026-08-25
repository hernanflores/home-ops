import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function escapeCell(value) {
  return String(value ?? "unknown")
    .replace(/\\/g, "\\\\")
    .replace(/([|\[\]`*_<>])/g, "\\$1")
    .replace(/\r?\n/g, " ");
}

function money(listing) {
  const { price, currency } = listing.property.pricing;
  return price === null ? "unknown" : `${currency ?? "?"} ${price.toLocaleString("en-US")}`;
}

function label(listing) {
  return (listing.property.title ?? [listing.property.property_type, listing.property.location.neighborhood]
    .filter(Boolean).join(" in ")) || listing.id;
}

function listingTable(listings) {
  if (listings.length === 0) return "_None._\n";
  const rows = listings.map((listing) => {
    const cells = [
    label(listing), listing.property.operation, listing.property.location.neighborhood,
    money(listing), listing.freshness.state
    ].map(escapeCell);
    cells.push(listing.source.url ? `[source](<${listing.source.url.replace(/[<>]/g, "")}>)` : "no URL");
    return cells.join(" | ");
  });
  return `| Listing | Operation | Neighborhood | Price | Freshness | Source |\n|---|---|---|---:|---|---|\n${rows.map((row) => `| ${row} |`).join("\n")}\n`;
}

export function renderReport({ now, region, touched, duplicateGroups, diagnostics = [] }) {
  const fresh = touched.filter((listing) => listing.status === "new");
  const updated = touched.filter((listing) => listing.status === "updated");
  const unchanged = touched.filter((listing) => listing.status === "unchanged");
  const stale = touched.filter((listing) => listing.freshness.state === "potentially_stale");
  const missing = touched.filter((listing) => listing.unknown_fields.length > 0);

  const duplicateText = duplicateGroups.length === 0
    ? "_None._\n"
    : duplicateGroups.map((group) => {
      const sources = group.map((listing) => `${listing.source.provider}: ${listing.source.url ?? listing.id}`).join("; ");
      return `- **${group[0].duplicate.group_id}** (${group[0].duplicate.confidence}): ${sources}`;
    }).join("\n") + "\n";

  const missingText = missing.length === 0
    ? "_None._\n"
    : missing.map((listing) => `- **${escapeCell(label(listing))}**: ${listing.unknown_fields.join(", ")}`).join("\n") + "\n";

  const healthText = diagnostics.length === 0
    ? "_No source diagnostics._\n"
    : `| Source | Provider | Status | Listings | Skipped | Requests | Cache hits | Retries | Error |\n|---|---|---|---:|---:|---:|---:|---:|---|\n${diagnostics.map((diagnostic) => `| ${[
      diagnostic.id,
      diagnostic.provider,
      diagnostic.status,
      diagnostic.count,
      diagnostic.skipped ?? 0,
      diagnostic.requests,
      diagnostic.cache_hits,
      diagnostic.retries,
      diagnostic.error ? `${diagnostic.error.code}: ${diagnostic.error.message}` : ""
    ].map(escapeCell).join(" | ")} |`).join("\n")}\n`;

  const skippedEntries = diagnostics.flatMap((diagnostic) =>
    (diagnostic.warnings ?? []).map((warning) => `- **${escapeCell(diagnostic.id)}**: ${escapeCell(warning)}`));
  const skippedText = skippedEntries.length === 0 ? "_None._\n" : `${skippedEntries.join("\n")}\n`;

  return `# HomeOps Scan Report

- **Run:** ${now}
- **Region:** ${region.id}
- **Processed:** ${touched.length}
- **New:** ${fresh.length}
- **Updated:** ${updated.length}
- **Unchanged:** ${unchanged.length}
- **Potentially stale:** ${stale.length}

## Source Health

${healthText}
## Skipped Entries

${skippedText}
## New Listings

${listingTable(fresh)}
## Updated Listings

${listingTable(updated)}
## Potentially Stale

${listingTable(stale)}
## Duplicate Candidates

${duplicateText}
## Missing Information

${missingText}`;
}

export async function writeReport(directory, now, content) {
  await mkdir(directory, { recursive: true });
  const filename = `scan-${now.replace(/[:.]/g, "-")}.md`;
  const path = join(directory, filename);
  await writeFile(path, content, "utf8");
  return path;
}
