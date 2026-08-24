import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { money, openQuestions, safe, safeUrl, title } from "./tracker-text.mjs";

function recordRow(record, listing, evaluation, evaluationReport) {
  const url = safeUrl(listing.source.url);
  const listingCell = url ? `[${safe(title(listing))}](<${url}>)` : safe(title(listing));
  const warnings = [...evaluation.red_flags, ...evaluation.missing_data];
  if (listing.duplicate.group_id) warnings.push(`Duplicate candidate: ${listing.duplicate.group_id} (${listing.duplicate.confidence})`);
  const reportCell = evaluationReport
    ? `[full](<${evaluationReport.replace(/[<>]/g, "")}>)`
    : "unknown";
  const cells = [
    listingCell,
    `\`${record.listing_id}\``,
    `\`${record.state}\``,
    `\`${record.availability}\``,
    `${safe(listing.property.location.neighborhood)}, ${safe(listing.property.location.city)}`,
    safe(money(listing.property.pricing)),
    safe(evaluation.eligibility),
    `${evaluation.score.percentage}% (max ${evaluation.score.maximum_possible_percentage}%)`,
    `${evaluation.score.coverage_percentage}%`,
    `**${safe(evaluation.recommendation)}**`,
    warnings.length ? warnings.map(safe).join("; ") : "none",
    openQuestions(record).length,
    safe(record.updated_at),
    reportCell
  ];
  return `| ${cells.join(" | ")} |`;
}

export function renderTrackerReport({ now, trackerPath, inventoryPath, records, listings, evaluations, evaluationReports = new Map() }) {
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.listing.id, evaluation]));
  const counts = Object.fromEntries(["watching", "shortlisted", "contacted", "visited", "archived"].map((state) => [state, records.filter((record) => record.state === state).length]));
  return `# HomeOps Tracker Review

- **Generated:** ${now}
- **Canonical tracker:** \`${safe(trackerPath)}\`
- **Canonical inventory:** \`${safe(inventoryPath)}\`
- **Tracked:** ${records.length}
- **States:** watching ${counts.watching}; shortlisted ${counts.shortlisted}; contacted ${counts.contacted}; visited ${counts.visited}; archived ${counts.archived}

This report is derived. Edit tracker state only through the deterministic tracker command. HomeOps did not contact an owner, schedule a visit, or take any external action.

## Listings

${records.length ? `| Listing / Source | Canonical ID | State | Availability | Location | Price | Eligibility | Score | Coverage | Recommendation | Warnings | Open Questions | Last Update | Full Evaluation |
|---|---|---|---|---|---:|---|---:|---:|---|---|---:|---|---|
${records.map((record) => recordRow(record, listingById.get(record.listing_id), evaluationById.get(record.listing_id), evaluationReports.get(record.listing_id))).join("\n")}` : "_No tracked listings._"}
`;
}

export async function writeTrackerReport(path, report) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, report, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return path;
}
