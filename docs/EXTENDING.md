# Extending HomeOps

## Add a region

1. Copy an existing file under `regions/`.
2. Set the country, city, currency, locale, freshness, and neighborhood aliases.
3. Keep valuation and financing assumptions explicit; do not invent unknown
   local rules.
4. Run `npm run compatibility` and `npm test`.

The shared `schemas/region.schema.json` and validator ensure a new region does
not require city-specific changes in normalization logic.

## Add a provider

Use the workflow in `modes/add-source.md`. Prefer official APIs, exports,
RSS/Atom feeds, and saved-search notifications. Keep the adapter isolated under
`providers/`, use the shared transport, bound requests, review terms and robots
directives, and add recorded fixtures plus offline tests. Never include
credentials or personal data in public fixtures.

## Add a plugin

Create a manifest based on `templates/plugin-manifest.example.yml`. Declare the
smallest necessary capabilities, permissions, network hosts, and credential
names. Put activation in private `config/plugins.yml`; plugins are disabled when
that file is absent or the plugin is not listed under `enabled`.

Run:

```bash
npm run plugin:check
```

The core validates manifests and grants but does not install or execute third-
party plugin code.
