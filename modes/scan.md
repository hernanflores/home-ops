# Mode: Scan

This mode supports local JSON/CSV files, approved zero-key RSS/Atom and Houzez
sources, and source-specific personal-use providers such as InfoCasas and PROP
when their required acknowledgement and safeguards are configured.

## Workflow

1. Confirm the input is a local JSON or CSV file, or use sources configured in
   `config/home-ops.yml`.
2. If configuration is missing, recommend copying
   `templates/config.example.yml` to `config/home-ops.yml` and editing the copy.
3. Run `npm run scan -- --input <path> --provider <source-name>` for one file,
   or `npm run scan` for configured sources.
4. Read the generated report path printed by the command.
5. Summarize new, updated, stale and duplicate-candidate counts. Surface missing
   data without filling it in.
6. Report source health, cache usage, retries, and isolated failures.

Do not scan a portal without a current source-specific terms and robots review.
Use `modes/add-source.md` to onboard a new portal. Personal-use automation that
is genuinely unspecified requires explicit acknowledgement and strict limits;
an express prohibition remains unsupported. RSS requires
`compliance.confirmed`. Mercado Libre explicitly prohibits crawling and is not
a Playwright target.
