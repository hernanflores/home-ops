import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function safe(value) {
  return String(value ?? "unknown").replace(/([\\|\[\]`*_<>])/g, "\\$1").replace(/\r?\n/g, " ");
}

function value(value) {
  return Array.isArray(value) ? value.join(", ") : value ?? "unknown";
}

function list(values) {
  return values.length ? values.map((entry) => `- ${safe(entry)}`).join("\n") : "_None._";
}

function criteriaTable(results, weighted = false) {
  if (!results.length) return "_None._";
  const weightHeaders = weighted ? " | Weight | Earned" : "";
  const weightRule = weighted ? "|---:|---:" : "";
  const rows = results.map((result) => {
    const currency = result.expected_currency
      ? `expected ${result.expected_currency}; actual ${result.actual_currency ?? "unknown"} (${result.actual_currency_provenance})`
      : "n/a";
    const cells = [result.label, result.field, result.actual, result.provenance, result.operator, value(result.expected), currency, result.allow_inferred, result.outcome, result.reason];
    if (weighted) cells.push(result.weight, result.earned);
    return `| ${cells.map(safe).join(" | ")} |`;
  }).join("\n");
  return `| Criterion | Field | Actual | Provenance | Operator | Expected | Currency | Allows inferred | Outcome | Reason${weightHeaders} |\n|---|---|---|---|---|---|---|---|---|---${weightRule}|\n${rows}`;
}

export function renderEvaluationReport(evaluation) {
  let sourceUrl = null;
  try {
    const candidate = new URL(evaluation.listing.source_url);
    const secret = [...candidate.searchParams.keys()].some((key) => /^(?:access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i.test(key));
    if (["http:", "https:"].includes(candidate.protocol) && !candidate.username && !candidate.password && !secret) sourceUrl = candidate.href;
  } catch {
    sourceUrl = null;
  }
  const source = sourceUrl
    ? `[${safe(sourceUrl)}](<${sourceUrl.replace(/[<>]/g, "")}>)`
    : "unknown";
  return `# HomeOps Property Evaluation

- **Evaluated:** ${evaluation.evaluated_at}
- **Profile:** ${safe(evaluation.profile.name)} (${safe(evaluation.profile.path)})
- **Canonical listing:** \`${evaluation.listing.id}\` in \`${safe(evaluation.listing.inventory_path)}\`
- **Source:** ${safe(evaluation.listing.provider)} / ${safe(evaluation.listing.external_id)} / ${source}
- **Eligibility:** ${evaluation.eligibility}
- **Score:** ${evaluation.score.earned}/${evaluation.score.maximum} (${evaluation.score.percentage}%)
- **Maximum possible score:** ${evaluation.score.maximum_possible_earned}/${evaluation.score.maximum} (${evaluation.score.maximum_possible_percentage}%)
- **Evidence coverage:** ${evaluation.score.evidence_weight}/${evaluation.score.maximum} (${evaluation.score.coverage_percentage}%)
- **Recommendation thresholds:** discard below ${evaluation.profile.recommendation.discard_below_score}% maximum possible, visit ${evaluation.profile.recommendation.visit_score}%, prioritize ${evaluation.profile.recommendation.prioritize_score}%
- **Freshness threshold:** ${evaluation.profile.stale_after_days} days
- **Recommendation:** **${evaluation.recommendation}**

## Hard Filters

${criteriaTable(evaluation.hard_filters)}

## Weighted Score

${criteriaTable(evaluation.score.criteria, true)}

## Matches

${list(evaluation.matches)}

## Trade-offs

${list(evaluation.trade_offs)}

## Missing Data

${list(evaluation.missing_data)}

## Red Flags

${list(evaluation.red_flags)}

## Suggested Questions

${list(evaluation.questions)}

These questions are suggestions only. HomeOps did not contact an owner or broker.

## Assumptions And Uncertainty

${list(evaluation.assumptions)}
`;
}

export async function writeEvaluationReports(directory, evaluation) {
  await mkdir(directory, { recursive: true });
  const timestamp = evaluation.evaluated_at.replace(/[:.]/g, "-");
  const stem = `evaluation-${evaluation.listing.id}-${timestamp}`;
  const jsonPath = join(directory, `${stem}.json`);
  const markdownPath = join(directory, `${stem}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(evaluation, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, renderEvaluationReport(evaluation), "utf8")
  ]);
  return { jsonPath, markdownPath };
}
