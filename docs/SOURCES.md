# Source Policy and Research

HomeOps indexes a network source only when access is technically public and the
intended use is not expressly prohibited. Explicit permission is preferred.
Genuinely unspecified personal use requires an opt-in source-specific adapter,
documented user acknowledgement, conservative limits, and no republication.
Public accessibility and `robots.txt` are evidence, not permission by themselves.

## Source Classification

| Classification | Treatment |
|---|---|
| Official zero-key API or feed with compatible terms | Core provider |
| Public HTML with automation explicitly permitted | Source-specific HTTP provider |
| JavaScript page with automation explicitly permitted | Source-specific Playwright provider |
| Personal local use genuinely unspecified and not prohibited | Opt-in source-specific provider with strict limits |
| Terms absent or ambiguous for the intended scope | Disabled candidate or assisted local import |
| Login, CAPTCHA, anti-bot challenge, or automation prohibition | Unsupported |

Every configured network source records `compliance.confirmed`, `terms_url`,
and `reviewed_at`. Reviews expire after 365 days by default. This is a safety
gate, not legal advice or an automated legal determination.

## Mercado Libre Uruguay

**Status:** Conditional API spike; no provider enabled.

Research performed on 2026-08-19 found:

- Official property search and location APIs are documented.
- Current examples require an OAuth bearer token.
- An anonymous categories request returned HTTP 403.
- Developer terms prohibit crawling and scraping.
- API content has source-specific freshness, retention, attribution, and derived
  information restrictions that conflict with permanent generic history.

Consequences:

- Mercado Libre is never a Playwright or HTML-scraping target.
- A future adapter must use the official API, be opt-in, and use credentials
  owned locally by the user.
- Retention and derived-analysis rules must be resolved before implementation.

References:

- https://developers.mercadolibre.com.uy/es_ar/items-y-busquedas
- https://developers.mercadolibre.com.uy/es_ar/localizar-inmuebles
- https://developers.mercadolibre.com.uy/es_ar/autenticacion-y-autorizacion
- https://developers.mercadolibre.com.uy/es-uy-terminos-y-condiciones

## Houzez / WordPress

**Status:** Provider implemented and fixture-tested; no agency pre-enabled.

Several Montevideo agency sites expose the standard Houzez custom post type at
`/wp-json/wp/v2/properties`. The public response can contain canonical property
URLs, price, currency, operation/status taxonomy, property type, bedrooms,
bathrooms, area, parking, address, publication date, and description. This is a
shared platform pattern analogous to public ATS boards in CareerOps.

Reconnaissance found public endpoints and property sitemaps on multiple sites,
with `robots.txt` not disallowing those API paths where a robots file existed.
No sufficiently explicit automation terms were found during this pass, so none
is shipped as enabled configuration. A site must pass its own review first.

The provider intentionally excludes Houzez analytics such as view counts from
canonical source evidence.

## InfoCasas Uruguay

**Status:** Opt-in personal-use HTTP provider implemented, tested, and accepted
against a bounded live scan.

Research performed on 2026-08-19 and revalidated on 2026-08-20 found:

- `robots.txt` exposes listing sitemaps and an RSS endpoint, while blocking a
  large list of named bots and selected application/filter paths.
- The listing sitemap index is active and split by property type, operation,
  and department.
- The advertised `/rss-listings` endpoint currently returns FincaRaiz Colombia
  listings rather than InfoCasas Uruguay inventory, so it is not usable.
- Listing pages are server-rendered Next.js HTML. Their `__NEXT_DATA__` block
  contains the listing facts needed by HomeOps, so Playwright and internal
  GraphQL/search services are unnecessary.
- The terms prohibit commercial/profit use and copying site information to
  another website or print medium without express written consent.
- The terms prohibit creating a database of third-party personal data,
  disproportionate infrastructure load, interference, and source-code
  extraction.
- The terms do not expressly prohibit automated access or private local history
  of non-personal property facts. They also do not expressly authorize either;
  this personal-use scope is genuinely unspecified.
- Wildcard `robots.txt` rules permit the declared CDE listing sitemaps and root
  listing-detail paths used by the provider. Internal/admin routes and selected
  compound filter paths remain disallowed.
- A live acceptance scan on 2026-08-19 retrieved two listings from one explicit
  Montevideo rental sitemap. It made three serial requests in 12.3 seconds with
  no retries. A second run was idempotent and left both listings unchanged.

Consequences:

- The provider requires `compliance.mode: personal-use` and an explicit
  `automation_unspecified_acknowledged: true` setting.
- Each source targets one declared CDE sitemap, scans at most 25 recently
  modified listings, waits at least five seconds between requests, uses no
  concurrency, and retries at most once.
- Do not use the provider commercially or republish its inventory or reports.
- Do not call internal GraphQL/search endpoints or use Playwright while the SSR
  response remains sufficient.
- Owner, broker, phone, WhatsApp, images, precise coordinates, free-form
  descriptions, and other contact-bearing fields are excluded by a strict
  whitelist.
- Detail-page HTML is processed in memory with request-level caching disabled,
  preventing raw contact-bearing responses from entering the private cache.
- Stop on authentication, access denial, rate limiting, CAPTCHA, or any other
  resistance. Never route around those controls.

On 2026-08-20, a second isolated acceptance used the same two-listing
Montevideo apartment-rental scope after tightening description exclusion. Both
runs made three serial requests in about 12 seconds with zero cache hits and
zero retries. The first created two sanitized records; the second retained the
same IDs and marked both unchanged. The cache contained only rate-limit state,
and the 32-test offline suite passed.

References:

- https://www.infocasas.com.uy/robots.txt
- https://www.infocasas.com.uy/sitemap.xml
- https://www.infocasas.com.uy/cde-sitemap-listings-index.xml
- https://www.infocasas.com.uy/rss-listings
- https://www.infocasas.com.uy/informacion#terminos-y-condiciones

## TuLugar

**Status:** Listing API unsupported; aggregate CSV approved as possible market
context but not integrated into comparable valuation.

Research performed on 2026-08-19 found:

- TuLugar documents a public, zero-key REST API for listings and advertises its
  use by applications, AI agents, MCP clients, and automated workflows.
- The general terms nevertheless prohibit scraping or automated collection of
  platform data, without an API-specific exception for listing retention.
- `robots.txt` permits `/api/market-data` but disallows the broader `/api/`
  prefix containing the documented `/api/v1/listings` endpoint.
- The open-data page explicitly permits journalistic, academic, and commercial
  use of aggregate market CSV files with attribution. It prohibits rehosting
  the datasets as a separate catalog or reselling them unchanged.
- The Uruguay snapshot is live and contains city-level counts and median offer
  prices, not individual property records.

Consequences:

- Do not use `/api/v1/listings` for canonical listing intake while the terms
  and robots policy conflict with automated collection.
- Do not put aggregate CSV rows in `data/listings.jsonl` or count them as a
  Milestone 2 listing-provider acceptance scan.
- The aggregate CSV is a compliant candidate for Milestone 5 market context,
  provided HomeOps preserves attribution and does not republish the dataset.
- City-level aggregate offer medians are not individual comparables or
  closed-sale evidence. The Milestone 5 baseline does not ingest or use them.

References:

- https://tulugar.com/es/api-docs
- https://tulugar.com/api/v1/openapi.json
- https://tulugar.com/es/datos
- https://tulugar.com/api/market-data?country=uruguay&dataset=snapshot
- https://tulugar.com/robots.txt
- https://tulugar.com/terms

## Gallito API

**Status:** Credentialed integration blocked pending API terms and production
approval.

Research performed on 2026-08-19 found:

- Gallito operates an official developer portal and REST API for managing and
  searching property listings.
- The documented sandbox requires a developer `user_key`. Private operations
  also require a login token with a 24-hour lifetime.
- The property search route is documented as `GET /v1/avisos/inmuebles`, with
  pagination, field selection, ordering, and OData-style filters.
- The public-search documentation is internally inconsistent: it says callers
  need not register, but requires a token obtained through login and elsewhere
  says every request requires a `user_key`.
- The production hostname is not public. Gallito supplies it only after an
  integration has been approved.
- The Basic plan lists a 30 requests/minute property-search limit, while its
  daily totals are inconsistent on the same page. Integration guidance also
  says calls must not be made less than one second apart.
- No public API agreement was found defining a license for retrieved listing
  content, cache or retention periods, delisting obligations, image/contact
  storage, attribution, key handling, or post-termination deletion.
- General site terms restrict commercial use and copying site information to
  another website without express written consent. They do not clarify rights
  granted to an approved API consumer.

Consequences:

- Do not register, request approval, or submit user/company details without
  explicit user authorization.
- Do not implement against the sandbox as if its undocumented assumptions were
  a stable production contract.
- A future opt-in adapter must receive a user-owned key and approved production
  base URL, keep credentials private, exclude phone/contact data by default,
  and encode Gallito's written cache, retention, deletion, and attribution
  rules before an acceptance scan.
- Gallito remains the strongest credentialed candidate, but it does not satisfy
  the current zero-key live-source exit criterion.

References:

- https://developer.gallito.com.uy/
- https://developer.gallito.com.uy/api-docs
- https://developer.gallito.com.uy/api-docs/v1/integracion
- https://developer.gallito.com.uy/api-docs/v1/inmuebles
- https://developer.gallito.com.uy/planes
- https://developer.gallito.com.uy/sandbox
- https://www.gallito.com.uy/politicas-de-privacidad.html
- https://www.gallito.com.uy/robots.txt

## Gallito Public Site

**Status:** Unsupported. Anti-bot challenge encountered; no provider implemented.

Research performed on 2026-08-20 against the public site found:

- `robots.txt` returned HTTP 200 for the honest `home-ops/0.2` user agent. The
  applicable group is the wildcard `User-agent: *` with `Allow: /`, and the file
  declares `Sitemap: https://www.gallito.com.uy/sitemap.xml`. Named crawlers
  including `ClaudeBot`, `GPTBot`, `CCBot`, `Bytespider`, `Amazonbot`,
  `Google-Extended`, `Applebot-Extended`, and `meta-externalagent` are fully
  disallowed.
- The same file carries a Cloudflare content-signal preamble stating that "As a
  condition of accessing this website, you agree to abide by the following
  content signals", with `Content-Signal: search=yes,ai-train=no,use=reference`
  applied to the wildcard group. `ai-train=no` is an express reservation of
  rights. `ai-input` is not listed, so it is neither granted nor restricted.
- `https://www.gallito.com.uy/sitemap.xml` returned HTTP 403 carrying a
  Cloudflare interstitial ("Just a moment...", `challenges.cloudflare.com`,
  `noindex,nofollow`) instead of sitemap XML.
- `https://www.gallito.com.uy/politicas-de-privacidad.html` returned the same
  HTTP 403 challenge, so neither the privacy policy nor the site terms could be
  read for this review.
- Research made two requests five seconds apart and stopped at the first
  challenge. No listing page was requested.

Consequences:

- The public site is Unsupported under the source-rule decision table: an
  HTTP 403 anti-bot challenge is a stop condition, not an obstacle to solve.
- Do not target gallito.com.uy with Playwright, stealth plugins, fingerprint
  spoofing, challenge solving, proxy rotation, or alternate exit nodes.
- A wildcard `Allow: /` is not permission when the operator enforces an access
  control on the content paths themselves.
- The site terms remain unread for the HomeOps scope. Terms that cannot be
  reviewed are treated as absent, which is independently disqualifying.
- Gallito's official API remains the only candidate path and stays blocked as
  documented above.

References:

- https://www.gallito.com.uy/robots.txt
- https://www.gallito.com.uy/sitemap.xml
- https://www.gallito.com.uy/politicas-de-privacidad.html

## Montevideo Portal Discovery (2026-08-20)

**Status:** Seven candidates researched. None enabled. No provider implemented.

Discovery pass triggered by a request for another Montevideo portal after the
Gallito public site was classified Unsupported. Every request used the honest
`home-ops/0.2` user agent, was paced at three to five seconds, and was limited
to `robots.txt`, sitemaps, public policy pages, one homepage per candidate, and
one category page. No listing detail page was retrieved and nothing was stored
in the canonical inventory.

### Portales del Uruguay

`www.portalesdeluruguay.com.uy`. Ambiguous terms; do not enable.

- `robots.txt` (updated 30/jun/2026) is actively maintained. The wildcard
  `User-agent: *` group disallows only administrative and authenticated routes
  (`/backend/`, `/es/perfil/`, `/es/mensajes/`, `/es/favoritos/`, and similar),
  leaving `/propiedades` allowed. No `Sitemap:` directive is declared.
- The operator blocks AI crawlers deliberately and documents it: `GPTBot` and
  `ClaudeBot` are "BLOQUEADOS a nivel Apache VirtualHost (403 antes de llegar al
  sitio)". `ShapBot` (Parallel.ai) is blocked after being "Detectado el
  14/jul/2026 recorriendo catálogo completo". `Claude-SearchBot` is explicitly
  described as "búsqueda en vivo, NO entrenamiento" and permitted with
  `Crawl-delay: 5`.
- Terms of use exist and are dated 1 December 2014. They contain no prohibition
  on automated access, robots, or scraping.
- Terms section 11.2 states users "no podrán reproducir, modificar, exhibir,
  vender, o distribuir el contenido, o usarlo de cualquier otro modo con objeto
  comercial o público." Whether the trailing commercial/public qualifier limits
  the whole list or only the final clause is genuinely ambiguous, and a retained
  local copy is plausibly "reproducir" under the stricter reading.
- Section 8.2 reserves the right to terminate service for any use outside the
  contract's stated purpose.
- The portal's own scope is tourist lodging: it describes an "ecosistema de
  alojamientos y propiedades turísticas" and its sibling portals are coastal
  destinations. Montevideo residential coverage is secondary.

Ambiguous terms for the requested scope means do not enable. This is the only
candidate in the pass whose operator publishes terms that could be clarified on
request, so it is the best target for seeking written permission.

### PROP

`prop.com.uy`. Opt-in personal-use provider implemented, tested, and accepted
against a bounded live scan. Terms are absent, so the reuse scope is
undetermined and activation is a documented user override, not an approval.

- Single Montevideo agency rather than a multi-agency portal.
- `robots.txt` declares `User-agent: *` with `Allow: /`, disallowing only
  `/admin/`, `/backend/`, `/cron/`, `/combine/`, `/storage/`, `/cdn-cgi/`,
  `/project-views`, `/property-views`, `/register-searchs`, `/search_list`, and
  tracking query strings. It declares `Sitemap: https://prop.com.uy/sitemap.xml`.
- The sitemap returns HTTP 200 with 1388 URLs, but they are facet and category
  pages only. All `lastmod` values equal the generation time, so the sitemap
  supports neither detail-page discovery nor incremental modification ordering.
- Category pages are server-rendered HTML with pagination. Listing detail URLs
  carry a stable external identifier, for example
  `/propiedades/alquiler-1-dormitorio-a-estrenar-la-blanqueada-p002812`.
- Category cards already expose title, price with currency, street address,
  neighborhood, city, and bedroom count, with no broker or contact data, so a
  card-level parser could avoid detail-page requests entirely.
- No JSON-LD, `__NEXT_DATA__`, or other embedded state was present, so a
  source-specific HTML parser would be required.
- The site publishes only `/legal/politica-de-privacidad`, a 2751-character
  analytics and personal-data notice with no intellectual-property, reuse, or
  automation clause. No terms of use exist anywhere on the site.

Absent terms are treated the same as unreadable terms: the scope is
undetermined. Under the standard decision table this source would stay
disabled. On 2026-08-20 the user reviewed that finding and directed HomeOps to
implement and accept the provider anyway, accepting the risk that PROP may
block it later. That decision is recorded here rather than being folded into
the InfoCasas "genuinely unspecified" classification, which it does not meet.

Consequences:

- The provider requires `compliance.mode: personal-use`,
  `automation_unspecified_acknowledged: true`, and an additional
  `terms_absent_acknowledged: true` that cannot be inherited from another
  source's review.
- Only `/propiedades/{alquilar|comprar}/...` category pages are requested. The
  only permitted query parameter is `page`; `robots.txt` disallows tracking
  parameters and `/search_list`.
- Listing detail pages are never fetched, because the cards already carry every
  field HomeOps retains. A full scan costs one request per page.
- Each source scans at most 25 listings across at most 3 pages, waits at least
  five seconds between requests, uses no concurrency, and retries at most once.
- Retained fields are external ID, canonical URL, title, price, currency,
  street address, neighborhood, department, bedrooms, bathrooms, and parking.
  Operation, property type, country, and city are marked `inferred` because
  they come from the requested category or configured defaults, not the card.
- Publication date, description, expenses, and areas stay unknown; the card
  does not carry them and they are never guessed.
- Images, agent names, and agency phone/email are excluded. Page-level agency
  contact markup is never read into a listing.
- Do not use the provider commercially or republish its inventory or reports.
- Stop on authentication, access denial, rate limiting, CAPTCHA, or any other
  resistance. Never route around those controls.

### PROP Acceptance Evidence

On 2026-08-20 two bounded live scans ran against an isolated temporary
inventory, cache, and report directory, never the canonical inventory. Scope
was one Montevideo apartment-rental category page limited to two listings.

- Each run made exactly one request with zero retries, completing in 612 ms and
  690 ms.
- The first run created two records; the second reported `0 new, 0 updated,
  2 unchanged` with identical stable IDs and unchanged `last_changed_at`.
- Both runs recorded zero cache hits: PROP returns the category page as
  non-cacheable, so no listing HTML was written to the private cache. The cache
  directory contained only rate-limit state.
- The stored records contained no `tel:` link, agency email, or phone number.
- Offline coverage grew to 44 tests, all passing without network access.

### Rejected Without Further Research

- `casasweb.com`: `robots.txt` returned HTTP 200 declaring
  `Sitemap: https://casasweb.com/sitemap.aspx`, but the homepage timed out after
  30 seconds and the sitemap returned HTTP 500 "The wait operation timed out".
  Too unstable to scan politely.
- `uruguay.buscocasita.com`: `robots.txt` contains only named-bot `Disallow: /`
  groups, with no wildcard group and no sitemap. No terms page is published or
  linked.
- `inmuebles.com.uy`: `robots.txt` returned HTTP 404. IIS-hosted. No terms page
  is published or linked.
- `www.buscandocasa.com`: `robots.txt` returned HTTP 404. IIS-hosted. No terms
  page is published or linked.

The absence of `robots.txt` is not permission, and none of these four publishes
terms defining any reuse scope.

### Conclusion

No candidate met the standard bar for approval. PROP was implemented and
accepted as an explicit user override of the absent-terms rule; see the PROP
section above. The remaining candidates stay disabled. Broader coverage is also
available by adding further declared InfoCasas CDE sitemaps under the existing
accepted classification, which requires no new policy determination.

References:

- https://www.portalesdeluruguay.com.uy/robots.txt
- https://www.portalesdeluruguay.com.uy/es/terminos_condiciones
- https://www.portalesdeluruguay.com.uy/es/politica_privacidad
- https://prop.com.uy/robots.txt
- https://prop.com.uy/sitemap.xml
- https://prop.com.uy/legal/politica-de-privacidad
- https://casasweb.com/robots.txt
- https://uruguay.buscocasita.com/robots.txt

## Other Uruguay Feed Research

**Status:** No live listing feed approved.

Research performed on 2026-08-19 found:

- Inmobiliaria Vignolo publishes a live RSS 2.0 listing feed and links it from
  the official site, but no terms authorizing automated local indexing and
  retained history were found. It remains an ambiguous disabled candidate.
- Inmobiliaria Tu Hogar publishes live sale, rent, and latest-listing RSS feeds,
  but its terms expressly prohibit robots, spiders, and other automated access
  for data collection without written consent. It is unsupported.
- NAI Uruguay documents a property API requiring an agency identifier, with no
  public reuse or retention license found. It is not a public intake source.

References:

- https://www.inmobiliariavignolo.com/portal/rss.php
- https://inmobiliariatuhogar.com.uy/rss-feeds
- https://inmobiliariatuhogar.com.uy/terms-conditions
- https://www.api.nai.com.uy/

## RSS and Atom

**Status:** Core provider implemented and fixture-tested.

RSS/Atom is accepted only with a source-specific compliance confirmation.
Generic WordPress `/feed/` endpoints often contain blog posts rather than
property inventory; users must verify that a feed actually publishes listings.
The provider does not infer property facts from prose.

### Controlled Live Acceptance

On 2026-08-19, the RSS provider completed two CLI scans against an HTTPS
response generated by HomeOps and served through `httpbin.org`, a public HTTP
request/response testing service:

- The first scan made one network request and created one canonical listing.
- The second scan made no network request, recorded one cache hit, and kept the
  listing unchanged.
- Normalization, provenance, validation, freshness, atomic inventory storage,
  the provider ledger, and report generation all completed successfully.

This proves the structured network pipeline end to end without collecting a
third party's property inventory. It does not satisfy the separate requirement
to approve a real external property source.

Reference:

- https://httpbin.org/

## Playwright

**Status:** No compliant source identified; not implemented in core.

Playwright remains an allowed future transport only for a source whose terms
permit automation and whose public listing data cannot be obtained through a
feed, API, SSR HTML, JSON-LD, or embedded application state. It will never be
used to bypass authentication, CAPTCHA, rate limits, robots directives, or
anti-bot controls.
