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

Derived reports render in Markdown and JSON. The tracker additionally
renders a read-only HTML reading copy at `reports/tracker.html` for someone
who will not open a terminal. It is a rendering of the same deterministic
output as `reports/tracker.md`, produced in the same evaluation pass, and is
never a second source of truth.

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
- `site/` is a public static landing page. It contains no user data and is
  not part of the tool. Its pages load Google Fonts from
  `fonts.googleapis.com` and `fonts.gstatic.com`, the only external runtime
  dependency in the shipped surface and a deliberate exception to the
  local-first principle.
- `.github/` holds continuous integration and the site deployment workflow.

Every external action remains human-approved. Network providers must use the
shared bounded transport and must not bypass logins, CAPTCHAs, robots rules,
rate limits, or source restrictions.
