# Data Contract

HomeOps separates replaceable system files from private user-owned files.

## User layer

The updater and project tests must never overwrite these paths:

- `config/*`: active profile, source and regional settings.
- `data/*`: canonical listing inventory and imported source files.
- `reports/*`: generated personal reports.

The repository keeps only `.gitkeep` placeholders in these directories. Public
starting points live under `templates/`.

## System layer

The following paths contain versioned behavior and may be updated:

- `.agents/`, `.claude/`, `.opencode/`, `AGENTS.md`, and `CODEX.md`.
- `modes/`, `providers/`, `regions/`, `schemas/`, and `scripts/`.
- `templates/`, `tests/`, and public documentation.
- `plugins/`: public plugin manifests and contract documentation; plugin
  activation and credential values remain private under `config/`.
- `site/`: the public project site, which contains no user data.
- `.github/`: continuous integration and site deployment workflows.

## Canonical and derived data

`data/listings.jsonl` is the canonical source inventory. Each line is one
validated listing record. `data/tracker.jsonl` is the canonical user lifecycle
tracker; each line is one validated event-backed aggregate referencing a
listing ID. `data/market-observations.jsonl` is the canonical immutable market
evidence ledger. Each line is one explicitly typed asking-price or verified
closed-sale observation. Reports under `reports/` are derived views and can be
rebuilt.

HomeOps preserves source URLs, source identifiers, retrieval timestamps,
field provenance, missing fields, and change history. Candidate duplicate
listings remain separate records and are grouped rather than silently merged.
Tracker records preserve state, availability, notes, questions, visits and
decisions as immutable events. Source price changes remain in listing history
and are not duplicated into tracker data.

Market synchronization snapshots valuation-relevant listing fields as
`listing_ask` observations. An unchanged snapshot is idempotent; a changed
snapshot creates a new observation without deleting prior evidence. Closed-sale
observations require an explicit evidence type and verification reference. A
listing becoming unavailable, removed, archived, or absent from a bounded scan
is never evidence of a completed transaction. Valuation reads the evidence
ledger without modifying it; synchronization and imports are separate explicit
commands.

Network providers may additionally write:

- `data/cache/providers/*`: private, expiring HTTP response cache. Safe to delete.
- `data/provider-runs.jsonl`: append-only source health and diagnostics ledger.

Provider-specific retention rules override the generic cache lifetime. A source
whose terms do not permit local caching must set `cache: false`; credentials are
never stored in cache, inventory, reports, or the provider-run ledger.
