const EPSILON = 1e-9;

function round(value) {
  return Math.round((value + EPSILON) * 100) / 100;
}

function money(amount, currency, unit) {
  return { amount: round(amount), currency, unit };
}

export function validateFinancingConfigSemantics(config, region = {}) {
  if (!config || config.schema_version !== 1) throw new Error("Financing configuration schema_version must be 1");
  if (!/^[A-Z]{3}$/.test(config.currency)) throw new Error("Financing currency must be an ISO-style uppercase code");
  if (!Array.isArray(config.scenarios) || config.scenarios.length === 0) throw new Error("Financing requires at least one scenario");
  if (region.financing?.currency && region.financing.currency !== config.currency) {
    throw new Error(`Financing currency ${config.currency} does not match region currency ${region.financing.currency}`);
  }
  const ids = new Set();
  for (const scenario of config.scenarios) {
    if (ids.has(scenario.id)) throw new Error(`Duplicate financing scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (scenario.down_payment_percent > 100) throw new Error(`Scenario ${scenario.id} down payment cannot exceed 100%`);
    if (scenario.currency_exposure?.income_currency === config.currency) throw new Error(`Scenario ${scenario.id} currency exposure must use a different income currency`);
  }
}

function calculateInstallment(principal, annualRatePercent, termMonths) {
  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate === 0) return principal / termMonths;
  return principal * monthlyRate / (1 - (1 + monthlyRate) ** -termMonths);
}

export function calculateScenario(scenario, currency) {
  const downPayment = scenario.purchase_price * scenario.down_payment_percent / 100;
  const principal = scenario.purchase_price - downPayment;
  const installment = calculateInstallment(principal, scenario.annual_interest_rate_percent, scenario.term_months);
  const totalInstallments = installment * scenario.term_months;
  const totalInterest = totalInstallments - principal;
  const costs = (scenario.recurring_costs ?? []).map((cost) => ({
    id: cost.id,
    label: cost.label,
    monthly: money(cost.monthly_amount, currency, "monthly"),
    total: money(cost.monthly_amount * scenario.term_months, currency, "total")
  }));
  const recurringMonthly = costs.reduce((sum, cost) => sum + cost.monthly.amount, 0);
  const recurringTotal = costs.reduce((sum, cost) => sum + cost.total.amount, 0);
  const exposure = scenario.currency_exposure
    ? {
        income_currency: scenario.currency_exposure.income_currency,
        rate_income_per_loan: scenario.currency_exposure.rate_income_per_loan,
        monthly_installment: money(installment * scenario.currency_exposure.rate_income_per_loan, scenario.currency_exposure.income_currency, "monthly"),
        monthly_housing_cost: money((installment + recurringMonthly) * scenario.currency_exposure.rate_income_per_loan, scenario.currency_exposure.income_currency, "monthly")
      }
    : null;
  return {
    id: scenario.id,
    label: scenario.label,
    inputs: {
      purchase_price: money(scenario.purchase_price, currency, "one_time"),
      down_payment_percent: scenario.down_payment_percent,
      annual_interest_rate_percent: scenario.annual_interest_rate_percent,
      term_months: scenario.term_months
    },
    down_payment: money(downPayment, currency, "one_time"),
    loan_principal: money(principal, currency, "one_time"),
    monthly_installment: money(installment, currency, "monthly"),
    total_installments: money(totalInstallments, currency, "total"),
    total_interest: money(Math.max(0, totalInterest), currency, "total"),
    recurring_costs: costs,
    monthly_housing_cost: money(installment + recurringMonthly, currency, "monthly"),
    total_recurring_cost: money(recurringTotal, currency, "total"),
    total_cash_outlay: money(downPayment + totalInstallments + recurringTotal, currency, "total"),
    currency_exposure: exposure,
    formula_assumptions: [
      "Fixed-rate, fully amortizing loan with monthly payments.",
      "Annual interest rate is divided by 12; no compounding or lender fees beyond supplied recurring costs are added.",
      "Recurring costs are assumed constant for every month in the loan term.",
      "Currency exposure uses the supplied income-currency-per-loan-currency rate and is not a forecast."
    ]
  };
}

export function calculateFinancing(config, { region = {}, now = new Date().toISOString() } = {}) {
  validateFinancingConfigSemantics(config, region);
  return {
    schema_version: 1,
    generated_at: new Date(now).toISOString(),
    currency: config.currency,
    method: "Fixed-rate monthly amortization with explicit user-supplied assumptions",
    disclaimer: "Educational simulation only; this is not financial advice, a loan offer, or a professional affordability assessment.",
    assumptions: [
      "Scenario values are hypothetical and supplied by the user.",
      "Taxes, fees, maintenance, insurance, and other recurring costs are excluded unless explicitly entered.",
      "The result does not check lender eligibility, income, credit, collateral, or product availability.",
      "No external service, lender, broker, or financing application is contacted."
    ],
    scenarios: config.scenarios.map((scenario) => calculateScenario(scenario, config.currency))
  };
}
