# Providers

Providers adapt permitted listing sources to raw objects consumed by the
Milestone 1 normalization pipeline.

## Contract

Every non-underscore `*.mjs` file exports a default object:

```js
export default {
  id: "source-type",
  async fetch(source, context) {
    return { listings: [] };
  }
};
```

`context` supplies `now`, `resolvePath`, `fetchText`, and `fetchJson`. Network
providers must use the context transport so timeouts, HTTPS validation, cache,
rate limiting, retries, secret redaction, and diagnostics remain consistent.

## Source Policy

- Core network providers must work without shared or project-owned credentials.
- Review source terms before enabling a feed and record the review in config.
- Unspecified personal-use automation requires an explicit source-specific
  acknowledgement and conservative limits; it is never a generic opt-out.
- Public accessibility is not permission to automate.
- Never bypass login, CAPTCHA, rate limits, robots directives, or anti-bot controls.
- Pin request hosts and reject redirects for source-specific providers.
- Bound pagination and pace requests.
- Export pure parsers for fixture-based tests.
- Authenticated or ambiguous integrations start disabled and outside the core.

## Implemented Providers

- `local-json`: user-provided JSON.
- `local-csv`: user-provided CSV.
- `rss`: zero-key RSS or Atom feeds explicitly approved by the user.
- `houzez`: zero-key WordPress REST listings from Houzez-based agency sites,
  enabled only after a source-specific compliance review.
- `infocasas`: opt-in personal-use SSR listing extraction from one declared CDE
  sitemap, with strict pacing and limits. Structured contact branches and
  free-form descriptions are omitted because descriptions can contain broker
  or adviser contact details.
- `prop`: opt-in personal-use extraction of PROP category-page cards from one
  declared `/propiedades/{alquilar|comprar}/...` URL. Detail pages are never
  requested because the cards carry every field HomeOps keeps. The site
  publishes no terms of use, so the adapter additionally requires
  `compliance.terms_absent_acknowledged: true`.

Files beginning with `_` implement the shared registry, contract, HTTP
transport, runner, and error taxonomy and are never loaded as providers.

Market observations use a separate canonical contract and are not listing
provider output. Current listing asks are synchronized from canonical listings,
and verified closed sales are accepted only through explicit local JSON import.
No network market-evidence provider is currently implemented.
