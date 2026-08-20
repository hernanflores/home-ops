# HomeOps Roadmap

This document is the persistent source of truth for milestones and project
tasks. Update checkboxes and status when scope is completed or changed.

Before starting milestone work, review this roadmap and confirm the target
milestone status. Do not advance a completed, blocked, or unapproved milestone
without reconciling its status and scope here first.

## Status Legend

- `Completed`: implemented and verified.
- `In progress`: active implementation work.
- `Planned`: agreed scope, not started.
- `Proposed`: provisional scope requiring review.

## Milestone 1: Local Listing Intake

**Status:** Completed

Build a deterministic local pipeline from user-provided files to an auditable
canonical property inventory.

### Deliverables

- [x] Initialize the Node.js project and test runner.
- [x] Define the system/user data boundary in `DATA_CONTRACT.md`.
- [x] Keep `config/`, `data/`, and `reports/` private and ignored by Git.
- [x] Define and validate the canonical listing JSON Schema.
- [x] Add the initial Uruguay/Montevideo regional configuration.
- [x] Import user-provided JSON and CSV files through isolated providers.
- [x] Normalize identifiers, URLs, dates, prices, currencies, areas, and location.
- [x] Preserve source metadata, original payload, field provenance, and unknowns.
- [x] Persist the canonical inventory atomically in `data/listings.jsonl`.
- [x] Detect exact duplicates and cross-source duplicate candidates.
- [x] Preserve separate source records instead of destructively merging candidates.
- [x] Track updates and price changes with history.
- [x] Classify listing freshness using configurable regional thresholds.
- [x] Generate derived Markdown scan reports.
- [x] Add the canonical Agent Skill and OpenCode, Claude Code, and Codex wrappers.
- [x] Document setup, input fields, commands, and outputs.
- [x] Cover normalization, deduplication, idempotency, freshness, and history with tests.

### Exit Criteria

- [x] Re-importing unchanged data produces no new listings.
- [x] Updating a listing preserves its stable ID and records its changes.
- [x] Every canonical record validates against the schema.
- [x] Every normalized value retains source provenance or an inferred/unknown marker.
- [x] `npm test` passes.
- [x] An end-to-end example produces an inventory and report.

## Milestone 2: Compliant Source Providers

**Status:** Completed

Discover listings from permitted network sources while preserving the same
canonical intake pipeline established in Milestone 1.

Implementation starts with zero-key RSS/Atom feeds and a reusable provider
runtime. Mercado Libre remains excluded from crawling. InfoCasas supplies the
bounded opt-in public-page acceptance source for personal use; its terms leave
that scope unspecified rather than expressly permitting or prohibiting it.

### Deliverables

- [x] Define the provider interface, result contract, and error taxonomy.
- [x] Add provider-level health, diagnostics, and bounded retry behavior.
- [x] Prioritize official APIs, exports, RSS/feeds, and saved-search notifications.
- [x] Add HTTP caching, explicit user agent, timeouts, and rate limiting.
- [x] Evaluate source terms and robots directives before enabling each adapter.
- [x] Add bounded public-page extraction where the scoped use is not prohibited.
- [x] Keep Playwright conditional; no approved source currently requires it.
- [x] Never bypass login, CAPTCHA, anti-bot controls, or access restrictions.
- [x] Store retrieval metadata and enough source evidence for auditing.
- [x] Isolate provider failures so one source cannot abort the complete scan.
- [x] Use recorded fixtures in deterministic tests; keep live checks optional.
- [x] Document supported sources, access method, limitations, and compliance notes.
- [x] Implement zero-key RSS/Atom and Houzez/WordPress providers against fixtures.
- [x] Approve one source-specific live provider and run a bounded read-only acceptance scan.

### Exit Criteria

- [x] At least one structured network provider works end to end against a
      controlled live HTTPS feed.
- [x] At least one scoped public-page provider works end to end.
- [x] Repeated scans respect cache and rate-limit settings.
- [x] Provider failures produce diagnostics without corrupting the inventory.
- [x] No core provider requires shared credentials or a centralized backend.
- [x] `npm test` passes without network access.

Acceptance evidence: on 2026-08-20 the InfoCasas provider completed two bounded
live scans of two listings after excluding contact-bearing descriptions. The
first created both records; the second kept both unchanged. Requests were
serial, raw listing HTML was not cached, no contact branches or descriptions
were persisted, and the 32-test offline suite passed. See `docs/SOURCES.md`.

On 2026-08-20 a second scoped public-page provider, `prop`, was implemented and
accepted the same way against two bounded live scans of one Montevideo category
page. PROP publishes no terms of use, so it does not meet the "genuinely
unspecified" bar InfoCasas met; it was enabled as an explicit user override
recorded in `docs/SOURCES.md` and gated behind a separate
`terms_absent_acknowledged` setting. The offline suite grew to 44 tests.

## Milestone 3: Profile and Property Evaluation

**Status:** Completed

Evaluate canonical listings against a private user profile using deterministic
hard filters and a transparent AI-assisted assessment workflow.

### Deliverables

- [x] Define the private profile template and scoring configuration.
- [x] Implement deterministic hard filters and weighted score calculations.
- [x] Add an `evaluate` mode that consumes script output rather than recalculating it.
- [x] Report eligibility, score breakdown, matches, trade-offs, missing data, and red flags.
- [x] Suggest questions for the owner or broker without contacting them.
- [x] Produce one recommendation: discard, monitor, visit, or prioritize.
- [x] Preserve assumptions, evidence, and uncertainty in each report.
- [x] Add fixtures and evaluation consistency tests.

### Exit Criteria

- [x] Hard-filter and weighted-score results are deterministic and tested.
- [x] Unknown listing fields never become guessed profile matches.
- [x] Every recommendation links back to canonical listing and source evidence.
- [x] No external action occurs without explicit user approval.

Acceptance evidence: on 2026-08-20 the deterministic evaluator added tri-state
hard filters, fixed-maximum weighted scoring with evidence coverage, current
freshness checks, currency-safe comparisons, auditable JSON/Markdown reports,
and one scripted recommendation per canonical record. The 52-test offline suite
passed, including repeatability, inventory immutability, malformed inputs,
future timestamps, unsafe source URLs, and uncertainty preservation.

## Milestone 4: Tracker and Comparison

**Status:** Completed

Track the lifecycle of interesting properties and compare shortlisted options.

### Deliverables

- [x] Define canonical tracker states and valid transitions.
- [x] Track notes, visits, questions, decisions, and listing availability changes.
- [x] Add deterministic tracker update and integrity scripts.
- [x] Compare multiple listings using normalized fields and evaluation results.
- [x] Generate shortlist and status reports from canonical files.
- [x] Preserve history for status and price changes.
- [x] Add untracked non-discarded evaluations to the tracker as watching.

### Exit Criteria

- [x] Invalid state transitions are rejected.
- [x] Rebuilding reports does not alter canonical data.
- [x] Comparisons clearly distinguish unknown values from unfavorable values.

Acceptance evidence: on 2026-08-20 the event-backed tracker added validated
forward-only lifecycle transitions, independent manual availability, immutable
notes/questions/visits/decisions, atomic locked persistence, replay-based
integrity checks, a stable one-row-per-listing tracker review with linked full evaluations,
and neutral JSON/Markdown comparisons using fresh deterministic evaluations.
Canonical immutability, unknown handling, duplicate warnings, Markdown safety,
concurrent writes, stale-lock recovery and terminal archive behavior are covered
by the offline suite. Full evaluations also perform an additive, idempotent
tracker synchronization while preserving every existing lifecycle state.

## Milestone 5: Market Valuation

**Status:** Completed

Estimate a transparent market-value range from comparable listings without
presenting the result as a professional appraisal.

The initial scope produces separate sale asking-value and monthly asking-rent
ranges. Comparable evidence is preserved in a private canonical ledger;
listing asks and explicitly verified closed sales remain separate evidence
classes and are never blended. The baseline uses same-currency records from the
exact normalized neighborhood and property type, property-specific area rules,
median price per square meter, and an interquartile range. Fewer than five
eligible comparables produces `insufficient_evidence`, not an estimate.

### Deliverables

- [x] Define deterministic comparable-selection and normalization inputs.
- [x] Normalize price, currency, area, date, condition, and location where possible.
- [x] Distinguish listing prices from verified closed-sale prices.
- [x] Show all comparables used and excluded, with reasons.
- [x] Produce value ranges, confidence, assumptions, and limitations.
- [x] Add region-specific valuation parameters without changing the core.
- [x] Persist immutable, explicitly typed market observations and idempotently
      synchronize canonical listing asks.
- [x] Keep market evidence synchronization separate from read-only valuation.
- [x] Add deterministic valuation CLI, reports, agent workflow, and offline tests.

### Exit Criteria

- [x] Every estimate is reproducible from stored comparables and configuration.
- [x] Reports include the non-appraisal disclaimer and source limitations.
- [x] Missing transaction data cannot be presented as closed-sale evidence.
- [x] Asking-price and closed-sale ranges are calculated and reported separately.
- [x] Valuation never mutates listings, tracker records, or market observations.

Acceptance evidence: on 2026-08-20 the immutable market-evidence ledger added
content-addressed listing asks, explicit verified closed-sale imports, stable
transaction identity, atomic locked persistence, supersession, duplicate-group
control, same-currency exact-neighborhood selection, property-specific area
bases, deterministic quartile ranges, evidence confidence, and complete
included/excluded JSON and Markdown reports. Asking rents and sale asks are
reported separately from verified transactions; fewer than five comparables
produces no estimate. Unchanged rescans, A-B-A price history, conflicting
transaction evidence, unsafe URLs, zero prices, condition normalization,
concurrent writers, stale-lock recovery, canonical immutability, and report
disclaimers are covered by the 75-test offline suite.

## Milestone 6: Financing Scenarios

**Status:** Proposed

Provide deterministic educational financing simulations with explicit regional
assumptions.

### Deliverables

- [ ] Define financing assumptions and regional rule configuration.
- [ ] Calculate down payment, installment, total cost, and recurring costs.
- [ ] Add interest-rate and currency-exposure sensitivity scenarios.
- [ ] Compare multiple hypothetical financing options.
- [ ] Keep calculations independent from the AI reasoning layer.
- [ ] Include educational-use and non-financial-advice disclaimers.

### Exit Criteria

- [ ] All calculations are covered by deterministic tests.
- [ ] Every result exposes its inputs, formula assumptions, currency, and units.
- [ ] No financing application or personal-data submission is initiated.

## Milestone 7: Regional and Plugin Expansion

**Status:** In progress

Make HomeOps straightforward to extend across LATAM while keeping optional
integrations outside the core.

### Deliverables

- [ ] Formalize the regional configuration schema and validation.
- [ ] Add reference configurations for Buenos Aires, Sao Paulo, Santiago, CDMX,
      and Bogota.
- [ ] Define an opt-in plugin manifest and permission model.
- [ ] Keep credentials and private plugin configuration in ignored user paths.
- [ ] Add compatibility checks for Agent Skills-capable CLIs.
- [ ] Document how to add a region, provider, and plugin.
- [x] Add a reusable Agent Skill workflow for geographic portal discovery,
      policy review, provider implementation, and bounded live acceptance.

### Exit Criteria

- [ ] A new region can be added without modifying core normalization logic.
- [ ] Plugins are disabled by default and require explicit activation.
- [ ] Core workflows remain usable without plugins, hosted services, or a
      proprietary model provider.

## Cross-Cutting Backlog

- [ ] Select and add an explicit open-source license.
- [ ] Add continuous integration for `npm test`.
- [ ] Add contribution and security-reporting documentation.
- [ ] Define safe system-update behavior that never overwrites user-owned paths.
- [ ] Add migration tests before changing the canonical listing schema.
- [ ] Add privacy checks preventing personal data from entering public fixtures.
- [ ] Keep `README.md`, `DATA_CONTRACT.md`, and this roadmap synchronized with
      shipped behavior.
