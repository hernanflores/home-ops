# HomeOps Architecture

HomeOps is organized around a local canonical inventory and small deterministic
operations:

```text
Local files / approved sources
              |
          providers
              |
       normalization + validation
              |
       data/listings.jsonl
          /       |       \
     evaluate  valuation  financing
          \       |       /
          tracker + derived reports
```

The `data/` inventory, tracker, and market-observation ledger are canonical
user-owned files. Markdown and JSON reports under `reports/` are derived and
can be rebuilt. The AI layer consumes deterministic script output; it does not
reimplement calculations in prose.

## Boundaries

- `providers/` adapts permitted source formats and cannot alter canonical
  storage directly.
- `scripts/` owns normalization, identifiers, deduplication, scoring, market
  statistics, financing formulas, and integrity checks.
- `modes/` describes portable agent workflows.
- `regions/` contains public, schema-validated regional defaults.
- `config/`, `data/`, and `reports/` are private and ignored by Git.
- `plugins/` defines optional contracts; plugins are disabled by default and
  are not loaded by the core workflow.

Every external action remains human-approved. Network providers must use the
shared bounded transport and must not bypass logins, CAPTCHAs, robots rules,
rate limits, or source restrictions.
