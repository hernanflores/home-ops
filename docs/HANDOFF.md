# HomeOps — Build Handoff

## Objective

Build an open-source, local-first “CareerOps for real estate” project.

HomeOps should help an individual search for, evaluate, compare, and track rental or purchase properties using their own AI coding CLI and model provider: OpenCode, Claude Code, Codex, or compatible tools.

The project must not require a centralized SaaS backend, a proprietary LLM, or shared user credentials.

## Product principles

1. **Local-first**
    - Run locally against the user’s files.
    - Keep personal profile, financial assumptions, credentials, property history, and reports local by default.

2. **AI-agnostic**
    - Keep reasoning workflows in portable Markdown skills and modes.
    - Support OpenCode, Claude Code, Codex, and other Agent Skills-compatible CLIs.
    - Do not hardcode one model provider or API key.

3. **Human-in-the-loop**
    - The system may find, normalize, assess, and recommend properties.
    - The user must approve any external action: contacting an agent, scheduling a visit, making an offer, sharing personal data, or applying for financing.

4. **Transparent and auditable**
    - Use deterministic scripts for calculations, deduplication, normalization, currency conversion, and hard filters.
    - Use the LLM for extraction from descriptions, contextual evaluation, summaries, and uncertainty analysis.
    - Always preserve source URLs, source metadata, assumptions, and missing data.

5. **Source-compliant**
    - Prefer official APIs, user-provided exports, saved-search notifications, RSS/feeds, and permitted public data.
    - Do not bypass logins, CAPTCHAs, rate limits, robots directives, anti-bot controls, or portal terms.
    - Keep third-party integrations opt-in plugins.

## Reference implementation

Use https://github.com/santifer/career-ops as architectural inspiration, not as code to copy.

Important ideas to adapt:

- A canonical `.agents/skills/` skill shared across AI coding CLIs.
- Local files as the canonical source of truth.
- Strict separation between system files and user-owned files.
- Modes in Markdown as the LLM reasoning layer.
- Small deterministic scripts for repeated mechanics.
- Optional provider and plugin layers.
- Human review before external actions.
- User configuration that survives system updates.

## Core user capabilities

### 1. Property search

Search or import rental and purchase listings from configured, permitted sources.

Expected output:

- New listings.
- Duplicate detection across sources.
- Relevant listing fields normalized into a common format.
- Source links and freshness status.
- Clear distinction between verified fields and unknown fields.

### 2. Property evaluation

Given a listing, evaluate fit against a user profile.

The evaluation should include:

- Hard-filter eligibility.
- Transparent weighted score.
- Reasons it matches.
- Trade-offs.
- Missing information.
- Red flags.
- Suggested questions for the owner or broker.
- Recommendation: discard, monitor, visit, or prioritize.

### 3. Market valuation

Estimate a property’s market-value range from comparable listings.

Requirements:

- Never present the result as an appraisal or professional valuation.
- Show comparable listings used.
- Normalize price, area, currency, date, condition, and location where data allows.
- Provide a confidence level and explicit limitations.
- Distinguish listing price from closed-sale price when the data source does not provide transaction data.

### 4. Financing scenarios

Create deterministic financing simulations.

Potential outputs:

- Required down payment.
- Estimated monthly installment.
- Total financing cost.
- Interest-rate sensitivity.
- Currency-exposure sensitivity.
- Recurring ownership costs.
- Comparison of multiple hypothetical scenarios.

Requirements:

- Treat this as educational calculation, not financial advice.
- Store assumptions explicitly.
- Support regional financing rules through configuration.

### 5. Regional configuration

Support country, city, neighborhood, currency, units, and local business-rule differences without changing the core.

Initial example region:

- Uruguay / Montevideo.

The architecture must make it straightforward to add:

- Argentina / Buenos Aires.
- Brazil / São Paulo.
- Chile / Santiago.
- Mexico / CDMX.
- Colombia / Bogotá.
- Other LATAM cities.

## Architecture

```text
home-ops/
├── .agents/skills/home-ops/   # canonical Agent Skills entrypoint
├── .claude/                   # Claude Code compatibility wrapper/link
├── .opencode/                 # OpenCode configuration and wrappers
├── CODEX.md                   # Codex compatibility entrypoint
├── AGENTS.md                  # shared project instructions
├── modes/                     # LLM workflows
│   ├── _shared.md
│   ├── scan.md
│   ├── evaluate.md
│   ├── valuation.md
│   ├── financing.md
│   ├── region.md
│   └── tracker.md
├── providers/                 # permitted source adapters
├── plugins/                   # opt-in external integrations
├── scripts/                   # deterministic utilities
├── regions/                   # public country/city configuration
├── templates/                 # user-config templates
├── config/                    # user configuration; ignored by Git
├── data/                      # user data; ignored by Git
├── reports/                   # generated personal reports; ignored by Git
├── docs/
├── tests/
└── evals/