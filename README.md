# HomeOps

HomeOps is a local-first, AI-agnostic property search and evaluation workspace.
It imports user-provided files and approved zero-key network sources, normalizes
them into a shared contract, detects duplicate candidates, tracks changes and
produces auditable scan reports, then evaluates canonical listings against a
private profile with deterministic filters and scoring.

Project milestones and their task checklists are tracked in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

No account, hosted backend or LLM API key is required for the deterministic
pipeline.

## Requirements

- Node.js 22 or newer.

## Setup

```bash
npm install
cp templates/config.example.yml config/home-ops.yml
cp templates/profile.example.yml config/profile.yml
```

`config/`, `data/` and `reports/` are private, ignored user paths. See
`DATA_CONTRACT.md` before changing their roles.

## Import One File

JSON input may be an array of listing objects or an object with a `listings`
array:

```bash
npm run scan -- --input /path/to/listings.json --provider saved-search
npm run scan -- --input /path/to/listings.csv --provider portal-export
```

The format is inferred from the extension. Use `--format json` or
`--format csv` to override it.

## Configured Sources

Edit the private `config/home-ops.yml`:

```yaml
region: uy-montevideo
inventory: data/listings.jsonl
reports_dir: reports
freshness:
  stale_after_days: 45
sources:
  - type: local-json
    path: data/imports/saved-search.json
    provider: saved-search
  - type: local-csv
    path: data/imports/export.csv
    provider: portal-export
```

Then run:

```bash
npm run scan
```

The command prints the canonical inventory and generated report paths.

## Evaluate Property Fit

Edit the private `config/profile.yml` to define hard filters, weighted criteria,
and recommendation thresholds. Criteria are restricted to normalized canonical
fields. Monetary criteria declare their currency because Milestone 3 does not
perform currency conversion.

The primary agent workflow is the `evaluate` mode. Evaluate every canonical
listing or select one stable ID through OpenCode:

```text
/home-ops evaluate
/home-ops evaluate lst_0123456789abcdef
/home-ops-evaluate lst_0123456789abcdef
```

The mode follows `modes/evaluate.md` and invokes the deterministic evaluator.
Evaluating the full inventory also atomically adds every untracked `monitor`,
`visit`, or `prioritize` result to `data/tracker.jsonl` as `watching`. Existing
tracker states are preserved, and evaluating one listing does not synchronize
the tracker.
For direct scripting, testing, or use without an agent, run the backend CLI:

```bash
npm run evaluate
npm run evaluate -- --listing lst_0123456789abcdef
npm run evaluate -- --listing lst_0123456789abcdef --json
```

### Profile Operators

Hard filters and weighted criteria use the same operators:

| Operator | Meaning | Supported fields |
|---|---|---|
| `equals` | Actual value equals the configured value | Text and numeric |
| `one_of` | Actual value equals one member of the configured list | Text only |
| `at_least` | Actual value is greater than or equal to the configured value | Numeric only |
| `at_most` | Actual value is less than or equal to the configured value | Numeric only |

Text comparisons are case-insensitive. Geographic fields also ignore accents,
punctuation, and whitespace differences, so `Cordón` and `Cordon` compare
equally. This is not fuzzy or substring matching: semantic variants must be
declared in the region's alias map, and `Pocitos` remains distinct from
`Pocitos Nuevo`. Each weighted criterion requires a positive `weight`; a
passing criterion earns its full weight and a failing or unknown criterion
earns zero. Monetary fields such as `property.pricing.price` also require
`currency`. Set `allow_inferred: true` explicitly when inferred canonical
evidence may satisfy a criterion.

Hard filters produce `eligible`, `ineligible`, or `indeterminate`. Unknown or
disallowed inferred values never pass. Weighted unknowns earn zero points while
evidence coverage reports how much of the configured score had usable evidence.
`recommendation.discard_below_score` can define a low-fit floor. The floor uses
the maximum possible score (earned weight plus all unknown weight), so missing
evidence cannot by itself cause a discard. A failed hard filter or a maximum
possible score below the floor produces `discard`; otherwise indeterminate
eligibility produces `monitor`, and eligible listings can reach `visit` or
`prioritize` at their configured thresholds. Omitting the floor preserves the
previous hard-filter-only discard behavior. The script deterministically
returns exactly one recommendation: `discard`, `monitor`, `visit`, or
`prioritize`.

## Tracker And Comparison

Tracker state is private canonical data in `data/tracker.jsonl`. Each record
references one canonical listing and preserves lifecycle, availability, notes,
questions, visits and decisions as immutable events. Source price history stays
in `data/listings.jsonl`.

Users normally invoke these workflows through the HomeOps command. The agent
routes the request through `modes/tracker.md` and runs the deterministic scripts
internally:

```text
/home-ops tracker start lst_0123456789abcdef
/home-ops tracker sync
/home-ops tracker shortlist lst_0123456789abcdef
/home-ops tracker status
/home-ops compare lst_0123456789abcdef lst_fedcba9876543210
/home-ops compare shortlist
```

Direct npm commands are the implementation layer. They remain available for
debugging, automation and non-agent CLI use:

```bash
npm run tracker -- start lst_0123456789abcdef
npm run tracker -- sync
npm run tracker -- transition lst_0123456789abcdef --to shortlisted
npm run tracker -- availability lst_0123456789abcdef --to available
npm run tracker -- note lst_0123456789abcdef --text "Review common expenses"
npm run tracker -- question lst_0123456789abcdef --text "Is parking assigned?"
npm run tracker -- answer lst_0123456789abcdef --question evt_0123456789abcdef --text "Reported as optional"
npm run tracker -- visit lst_0123456789abcdef --visited-at 2026-08-20T18:00:00Z --notes "User-recorded visit"
npm run tracker -- decision lst_0123456789abcdef --decision "Keep watching" --reason "Price uncertainty"
npm run tracker:check
npm run tracker -- report
```

The forward lifecycle is `watching → shortlisted → contacted → visited →
archived`. `watching` may move directly to `contacted`, any active state may be
archived, and archive is terminal. Availability is tracked independently as
`unknown`, `available`, `reserved`, `unavailable`, or `removed`.
Tracker synchronization is additive and idempotent: it starts missing
non-discarded listings in `watching` but never changes or archives an existing
record.

`reports/tracker.md` is a derived, one-row-per-listing table with lifecycle and
availability state, location, price, evaluation status, score, coverage,
recommendation, warnings, open-question count, last update and links to current
full evaluation reports. Rebuilding it does not modify either canonical JSONL
file; complete tracker event history remains in `data/tracker.jsonl`.

Compare explicit listings or the active shortlist:

```bash
npm run compare -- --listing lst_0123456789abcdef --listing lst_fedcba9876543210
npm run compare -- --shortlist
```

Comparison recomputes evaluations from the current profile and produces
timestamped JSON and Markdown reports. It is a neutral matrix: unknown values
remain unknown, provenance is shown, different currencies are not converted or
ordered, and duplicate source records remain separate.

The `contacted` and `visited` states only record actions reported by the user.
They do not authorize HomeOps to contact anyone, schedule a visit, submit data,
or take another external action.

## Market Valuation

Market evidence is private canonical data in
`data/market-observations.jsonl`. Synchronize current canonical listings as
explicitly typed asking-price observations, then value one subject listing:

```bash
npm run market -- sync
npm run valuation -- --listing lst_0123456789abcdef
npm run valuation -- --listing lst_0123456789abcdef --json
```

The valuation command is read-only. Synchronization is a separate append-only,
idempotent operation: unchanged observations keep stable IDs, while changed
valuation evidence creates a new immutable observation. Earlier observations
remain auditable and are excluded as superseded when a newer observation for
the same listing exists.

Verified closed-sale evidence can be imported from a local JSON array or an
object with an `observations` array:

```bash
npm run market -- import --input /path/to/verified-sales.json
```

Every imported record must explicitly declare
`evidence_type: verified_closed_sale`, include the effective transaction date,
and provide verification metadata and a non-empty evidence reference. HomeOps
never infers a sale from a removed listing, tracker state, or missing data.

The Montevideo baseline compares the same operation, property type, currency,
and exact normalized neighborhood. It applies Q1, median, and Q3 price per m²
to the subject's property-specific area basis. At least five eligible
comparables are required. Asking-price and verified closed-sale ranges remain
separate, no currency conversion or statistical outlier deletion occurs, and
every included or excluded observation is shown with its reason. Configuration
defaults live under `valuation` in the region file; use a private file based on
`templates/valuation.example.yml` with `--config` to override them.

Evidence confidence (`insufficient`, `low`, `medium`, or `high`) describes the
available comparable evidence. It is not a confidence interval or professional
appraisal confidence. Every report includes a non-appraisal disclaimer.

## Financing Scenarios

Financing is an offline, read-only mode for educational simulations. Copy
`templates/financing.example.yml` to the private `config/` directory, edit the
hypothetical scenarios, and run:

```bash
npm run financing -- --config config/financing.yml
npm run financing -- --config config/financing.yml --json
```

Each scenario reports the down payment, loan principal, fixed-rate monthly
installment, total interest, recurring costs, total cash outlay, and any
explicitly supplied currency-exposure conversion. Named scenarios can model
different rates, terms, or down payments for comparison. Values are not live
lender offers, affordability decisions, or financial advice; HomeOps does not
contact lenders or submit financing applications.

## Network Sources

Milestone 2 adds a shared provider runtime and four zero-key network adapters:

- `rss`: RSS or Atom property feeds.
- `houzez`: public WordPress REST property endpoints from Houzez-based sites.
- `infocasas`: bounded, opt-in personal-use extraction from one declared
  InfoCasas listing sitemap.
- `prop`: bounded, opt-in personal-use extraction from one declared PROP
  category page, using card data only.

Network sources are disabled until their source-specific terms have been
reviewed and recorded. See `templates/config.example.yml` for configuration and
[`docs/SOURCES.md`](docs/SOURCES.md) for policy and current source research.

The runtime uses HTTPS, DNS/private-address checks, host-pinned redirects,
timeouts, response-size limits, private cache, per-host pacing and bounded
retries. A failed source is reported without discarding valid sources. If every
enabled source fails, the inventory is not modified.

## Add A Portal

The canonical HomeOps skill can research and onboard a portal URL or discover
candidate portals for a geographic area:

```text
/home-ops-add-source Uruguay, Montevideo, apartments for sale and rent
/home-ops add-source https://portal.example/
```

The workflow reviews official terms, robots rules, APIs, feeds, sitemaps,
privacy, retention, and rate limits before selecting RSS, API, SSR HTML, or
Playwright. It reuses an existing provider where possible, otherwise adds an
isolated adapter with fixtures and hard limits. Initial live acceptance uses one
or two listings and temporary storage; private configuration is activated only
after the user chooses exact geography, operations, property types, and volume.

See `modes/add-source.md` for the complete reusable process. Claude and Codex
route equivalent natural-language requests through the same canonical skill.

## Input Fields

Adapters accept common English and Spanish aliases. Useful fields include:

- Identity: `external_id`, `listing_id`, `id`, `url`.
- Classification: `operation`, `property_type`, `title`, `description`.
- Location: `country_code`, `city`, `neighborhood`/`barrio`, `address`.
- Price: `price`, `currency`, `expenses`/`gastos_comunes`.
- Features: `bedrooms`/`dormitorios`, `bathrooms`, `area_total_m2`,
  `area_covered_m2`, `parking_spaces`.
- Dates: `published_at`.

Unknown fields remain `null` and are listed in `unknown_fields`. Values supplied
by a source are `reported`; URLs observed by the importer are `verified`; region
defaults such as country and currency are marked `inferred`.

## Outputs

- `data/listings.jsonl`: canonical, schema-validated inventory.
- `data/cache/providers/`: private expiring HTTP cache, safe to delete.
- `data/provider-runs.jsonl`: append-only source health ledger.
- `data/market-observations.jsonl`: canonical immutable asking-price and
  explicitly verified closed-sale evidence.
- `reports/scan-<timestamp>.md`: derived scan summary.
- `reports/evaluation-<listing-id>-<timestamp>.json`: structured deterministic
  evaluation.
- `reports/evaluation-<listing-id>-<timestamp>.md`: human-readable evaluation
  with evidence and uncertainty.
- `reports/valuation-<listing-id>-<timestamp>.json`: deterministic comparable
  selection, exclusions, statistics, ranges, and confidence factors.
- `reports/valuation-<listing-id>-<timestamp>.md`: human-readable non-appraisal
  report with all included and excluded evidence.

Stable IDs prefer source identifiers, then normalized URLs, then a conservative
property fingerprint. Exact source records are updated in place with change
history. Cross-source candidates remain separate and receive a duplicate group
with `medium` or `high` confidence.

## Agent Usage

The canonical Agent Skill is `.agents/skills/home-ops/SKILL.md`. OpenCode exposes
`/home-ops`, `/home-ops-evaluate`, `/home-ops-valuation`, and
`/home-ops-add-source`; Claude Code and Codex route equivalent natural-language
requests through the same workflows.

## Tests

```bash
npm test
```

The offline suite covers profile and evaluation schema validation, deterministic
hard filters, weighted scores, evidence coverage, evaluation reports, regional
normalization, URL cleanup, freshness, cross-source duplicate detection,
idempotent re-imports, price change history, provider isolation, RSS/Atom,
Houzez, cache, rate limits, response bounds, request-level cache exclusion,
InfoCasas SSR parsing, PROP card parsing and pagination, contact-data exclusion,
secret redaction, SSRF defenses, immutable market evidence, comparable
selection, quantiles, evidence separation, valuation reports, and canonical
data immutability.

## Milestone Boundary

This release supports local JSON/CSV, approved RSS/Atom and Houzez sources,
deterministic private-profile evaluation, event-backed tracking, deterministic
comparable-based valuation, and educational financing scenarios, plus
opt-in personal-use InfoCasas and PROP public-page providers. InfoCasas automation is
not expressly authorized or prohibited for that private local scope, so its
adapter enforces acknowledgement, pacing, bounds, no raw-page cache, and no
structured contact data or free-form descriptions. Playwright is not used
because the server-rendered HTML is sufficient. PROP publishes no terms of use
at all, so its adapter is disabled by default and requires a separate
`terms_absent_acknowledged` setting recording that the reuse scope is
undetermined rather than merely unspecified. HomeOps never bypasses login,
CAPTCHA, rate limits, robots directives or source terms.
