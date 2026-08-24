import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { runFinancing } from "../scripts/financing.mjs";
import { calculateScenario } from "../scripts/lib/financing.mjs";

const NOW = "2026-08-24T12:00:00.000Z";
const REGION = { id: "uy-montevideo", currency: "USD", financing: { currency: "USD" } };

function scenario(overrides = {}) {
  return {
    id: "baseline",
    label: "Baseline",
    purchase_price: 100000,
    down_payment_percent: 20,
    annual_interest_rate_percent: 6,
    term_months: 120,
    recurring_costs: [{ id: "hoa", label: "Common expenses", monthly_amount: 100 }],
    ...overrides
  };
}

test("fixed-rate financing calculates down payment, installment, interest, and recurring totals", () => {
  const result = calculateScenario(scenario(), "USD");
  assert.equal(result.down_payment.amount, 20000);
  assert.equal(result.loan_principal.amount, 80000);
  assert.equal(result.monthly_installment.amount, 888.16);
  assert.equal(result.total_installments.amount, 106579.68);
  assert.equal(result.total_interest.amount, 26579.68);
  assert.equal(result.monthly_housing_cost.amount, 988.16);
  assert.equal(result.total_recurring_cost.amount, 12000);
  assert.equal(result.total_cash_outlay.amount, 138579.68);
});

test("zero-interest financing is deterministic and supports currency exposure", () => {
  const result = calculateScenario(scenario({ annual_interest_rate_percent: 0, term_months: 10, recurring_costs: [], currency_exposure: { income_currency: "UYU", rate_income_per_loan: 40 } }), "USD");
  assert.equal(result.monthly_installment.amount, 8000);
  assert.equal(result.total_interest.amount, 0);
  assert.equal(result.currency_exposure.monthly_installment.amount, 320000);
  assert.equal(result.currency_exposure.monthly_installment.currency, "UYU");
});

test("financing CLI validates config, emits reports, and does not mutate inputs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-financing-"));
  const config = join(directory, "financing.yml");
  const region = join(directory, "region.yml");
  const reportsDir = join(directory, "reports");
  await writeFile(config, YAML.stringify({ schema_version: 1, currency: "USD", scenarios: [scenario(), scenario({ id: "shorter", label: "Shorter" })] }));
  await writeFile(region, YAML.stringify(REGION));
  const before = await readFile(config, "utf8");
  const result = await runFinancing({ config, region, reportsDir, now: NOW });
  assert.equal(result.result.generated_at, NOW);
  assert.equal(result.result.scenarios.length, 2);
  assert.match(await readFile(result.reportPaths.markdownPath, "utf8"), /Educational simulation only/);
  assert.equal(await readFile(config, "utf8"), before);
  assert.ok(result.reportPaths.jsonPath.startsWith(resolve(reportsDir)));
});

test("invalid financing scenarios are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "home-ops-financing-invalid-"));
  const config = join(directory, "financing.yml");
  const region = join(directory, "region.yml");
  await writeFile(config, YAML.stringify({ schema_version: 1, currency: "USD", scenarios: [scenario({ down_payment_percent: 101 })] }));
  await writeFile(region, YAML.stringify(REGION));
  await assert.rejects(runFinancing({ config, region, now: NOW }), /<= 100|cannot exceed 100/);
});
