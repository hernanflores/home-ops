import assert from "node:assert/strict";
import test from "node:test";
import infocasas, { parseInfoCasasListing, parseInfoCasasSitemap } from "../../providers/infocasas.mjs";

const SOURCE = {
  id: "infocasas-pocitos-rent",
  type: "infocasas",
  url: "https://www.infocasas.com.uy/cde-sitemap-listings-apartamento-en-alquiler-montevideo.xml",
  provider: "infocasas",
  max_listings: 2,
  min_interval_ms: 5_000,
  max_retries: 1,
  compliance: {
    confirmed: true,
    terms_url: "https://www.infocasas.com.uy/informacion#terminos-y-condiciones",
    reviewed_at: "2026-08-19",
    mode: "personal-use",
    automation_unspecified_acknowledged: true
  }
};

function listingHtml(id, overrides = {}) {
  const data = {
    id,
    link: `/apartamento-de-prueba/${id}`,
    created_at: "2026-08-10",
    updated_at: "2026-08-18",
    operation_type: { id: 2, name: "Alquiler" },
    property_type: { id: 2, name: "Apartamento" },
    title: "Apartamento <b>luminoso</b>",
    description: "<p>Dos ambientes. Asesora Persona privada, 099 000 000.</p>",
    price: { amount: 48750, hidePrice: false, currency: { id: 2, name: "$" } },
    commonExpenses: { amount: 7500, hidePrice: false, currency: { id: 2, name: "$" } },
    locations: {
      country: [{ name: "Uruguay" }],
      state: [{ name: "Montevideo" }],
      city: [],
      neighbourhood: [{ name: "Pocitos" }]
    },
    showAddress: false,
    address: "Dirección no pública",
    bedrooms: 1,
    bathrooms: 1,
    garage: 1,
    m2: 75,
    m2Built: 85,
    m2Terrace: 8,
    owner: { name: "Persona privada", masked_phone: "099 000 000", whatsapp_phone: "59899000000" },
    ...overrides
  };
  const state = {
    props: {
      pageProps: {
        data,
        apolloState: {
          "Filter:price": {
            options: [
              { id: 2, nombre: "$", iso_code: "UYU" },
              { id: 1, nombre: "U$S", iso_code: "USD" }
            ]
          }
        }
      }
    }
  };
  return `<!doctype html><html><body><script>ignored()</script><script type="application/json" id="__NEXT_DATA__">${JSON.stringify(state)}</script></body></html>`;
}

const SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.infocasas.com.uy/apartamento-viejo/100</loc><lastmod>2026-08-17T12:00:00-03:00</lastmod></url>
  <url><loc>https://www.infocasas.com.uy/apartamento-nuevo/200</loc><lastmod>2026-08-19T12:00:00-03:00</lastmod></url>
</urlset>`;

test("InfoCasas parses SSR state and excludes owner/contact data", () => {
  const listing = parseInfoCasasListing(
    listingHtml(200),
    SOURCE,
    "2026-08-19T15:00:00.000Z",
    "https://www.infocasas.com.uy/apartamento-de-prueba/200"
  );
  assert.equal(listing.external_id, "200");
  assert.equal(listing.operation, "rent");
  assert.equal(listing.property_type, "apartment");
  assert.equal(listing.title, "Apartamento luminoso");
  assert.equal(listing.description, null);
  assert.equal(listing.currency, "UYU");
  assert.equal(listing.expenses, 7500);
  assert.equal(listing.city, "Montevideo");
  assert.equal(listing.address, null);
  assert.equal(listing.area_total_m2, 75);
  assert.equal(listing.area_covered_m2, 85);
  assert.doesNotMatch(JSON.stringify(listing), /Persona privada|099 000 000|whatsapp_phone/);
});

test("InfoCasas accepts slug drift only when listing IDs match", () => {
  const requested = "https://www.infocasas.com.uy/apartamento-2-banos/200";
  const listing = parseInfoCasasListing(
    listingHtml(200, { link: "/apartamento-2-baños/200" }),
    SOURCE,
    "2026-08-19T15:00:00.000Z",
    requested
  );
  assert.equal(listing.url, requested);
  assert.throws(
    () => parseInfoCasasListing(listingHtml(201), SOURCE, "2026-08-19T15:00:00.000Z", requested),
    /canonical URL does not match/
  );
});

test("InfoCasas sitemap prioritizes recently changed listings", () => {
  assert.deepEqual(parseInfoCasasSitemap(SITEMAP).map((item) => item.url), [
    "https://www.infocasas.com.uy/apartamento-nuevo/200",
    "https://www.infocasas.com.uy/apartamento-viejo/100"
  ]);
});

test("InfoCasas fetch is serial, bounded, and disables raw HTML caching", async () => {
  const requests = [];
  const result = await infocasas.fetch({ ...SOURCE, max_listings: 1 }, {
    now: "2026-08-19T15:00:00.000Z",
    async fetchText(url, options) {
      requests.push({ url, options });
      return requests.length === 1 ? SITEMAP : listingHtml(200, { link: "/apartamento-nuevo/200" });
    }
  });
  assert.equal(result.listings.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.cache, false);
});

test("InfoCasas requires personal-use acknowledgement and conservative limits", async () => {
  const context = { now: "2026-08-19T15:00:00.000Z", fetchText: async () => assert.fail("must not fetch") };
  await assert.rejects(infocasas.fetch({ ...SOURCE, compliance: { ...SOURCE.compliance, automation_unspecified_acknowledged: false } }, context), /personal-use acknowledgement/);
  await assert.rejects(infocasas.fetch({ ...SOURCE, min_interval_ms: 1000 }, context), /at least 5000/);
  await assert.rejects(infocasas.fetch({ ...SOURCE, max_listings: 26 }, context), /from 1 to 25/);
});

test("InfoCasas rejects unexpected hosts and paths", () => {
  const badHost = SITEMAP.replace("www.infocasas.com.uy/apartamento-viejo/100", "example.test/apartamento-viejo/100");
  assert.throws(() => parseInfoCasasSitemap(badHost), /must use https:\/\/www\.infocasas\.com\.uy/);
  assert.throws(() => parseInfoCasasListing(listingHtml(200, { link: "/venta/casas/montevideo/200" }), SOURCE, "2026-08-19T15:00:00.000Z"), /path is not allowed/);
});
