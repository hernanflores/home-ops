import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

function safe(value) {
  return String(value ?? "unknown").replace(/[\r\n]+/g, " ").replace(/([\\|\[\]`*_<>])/g, "\\$1");
}

function amount(value) {
  return `${safe(value.currency)} ${Number(value.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function renderFinancingReport(result) {
  const scenarios = result.scenarios.map((scenario) => `## ${safe(scenario.label)}

- **Purchase price:** ${amount(scenario.inputs.purchase_price)}
- **Down payment:** ${scenario.inputs.down_payment_percent}% (${amount(scenario.down_payment)})
- **Loan principal:** ${amount(scenario.loan_principal)}
- **Interest rate / term:** ${scenario.inputs.annual_interest_rate_percent}% / ${scenario.inputs.term_months} months
- **Monthly installment:** ${amount(scenario.monthly_installment)}
- **Monthly housing cost:** ${amount(scenario.monthly_housing_cost)}
- **Total interest:** ${amount(scenario.total_interest)}
- **Total recurring costs:** ${amount(scenario.total_recurring_cost)}
- **Total cash outlay:** ${amount(scenario.total_cash_outlay)}

### Recurring costs

${scenario.recurring_costs.length ? scenario.recurring_costs.map((cost) => `- ${safe(cost.label)}: ${amount(cost.monthly)} monthly; ${amount(cost.total)} over term`).join("\n") : "None supplied."}

${scenario.currency_exposure ? `### Currency exposure\n\n- **Income currency:** ${safe(scenario.currency_exposure.income_currency)}\n- **Supplied rate:** ${scenario.currency_exposure.rate_income_per_loan} income currency per ${safe(result.currency)}\n- **Monthly installment at that rate:** ${amount(scenario.currency_exposure.monthly_installment)}\n- **Monthly housing cost at that rate:** ${amount(scenario.currency_exposure.monthly_housing_cost)}\n` : ""}`).join("\n");
  return `# HomeOps Financing Scenarios

- **Generated:** ${safe(result.generated_at)}
- **Currency:** ${safe(result.currency)}
- **Method:** ${safe(result.method)}

> ${safe(result.disclaimer)}

${scenarios}

## Assumptions and limitations

${result.assumptions.map((item) => `- ${safe(item)}`).join("\n")}
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

export async function writeFinancingReports(directory, result) {
  await mkdir(directory, { recursive: true });
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex").slice(0, 8);
  const stem = `financing-${result.generated_at.replace(/[:.]/g, "-")}-${digest}`;
  const jsonPath = join(directory, `${stem}.json`);
  const markdownPath = join(directory, `${stem}.md`);
  await atomicWrite(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await atomicWrite(markdownPath, renderFinancingReport(result));
  return { jsonPath, markdownPath };
}
