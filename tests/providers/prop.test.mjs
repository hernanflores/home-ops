import assert from "node:assert/strict";
import test from "node:test";
import prop, { parsePropCategory, parsePropPrice } from "../../providers/prop.mjs";

const SOURCE = {
  id: "prop-apartments-rent-montevideo",
  type: "prop",
  url: "https://prop.com.uy/propiedades/alquilar/apartamento",
  provider: "prop",
  max_listings: 2,
  max_pages: 1,
  min_interval_ms: 5_000,
  max_retries: 1,
  defaults: { country_code: "UY", city: "Montevideo" },
  compliance: {
    confirmed: true,
    terms_url: "https://prop.com.uy/legal/politica-de-privacidad",
    reviewed_at: "2026-08-20",
    mode: "personal-use",
    automation_unspecified_acknowledged: true,
    terms_absent_acknowledged: true
  }
};

const CATEGORY = "https://prop.com.uy/propiedades/alquilar/apartamento";

function card(id, overrides = {}) {
  const {
    slug = "alquiler-monoambiente-centro",
    title = "Alquiler monoambiente Centro",
    price = "UYU 30.500",
    address = "Calle Falsa 1234",
    location = "Cordón, Montevideo",
    bedrooms = "1",
    bathrooms = "1",
    garages = "0",
    href = `https://prop.com.uy/propiedades/${slug}-${id}`
  } = overrides;
  const feature = (value, label) => `
    <div class="col-4 text-center single-place-features">
      <p class="py-1 font-secondary">${value}</p>
      <p alt="${label}" data-bs-toggle="tooltip" title="${label}"><i class="fas"></i></p>
    </div>`;
  return `
  <div class="property-grid-card col-12 mb-20">
    <a href="${href}" target="_blank">
      <div class="single-place-wrap">
        <span class="single-place-title" title="${title}">${title}</span>
        <div class="single-place-content row">
          <div class="col-7">
            <h3 class="mb-0 bold">${price}</h3>
            ${address === null ? "" : `<p class="address">${address}</p>`}
            <p class="font-secondary">${location}</p>
          </div>
          <div class="col-5 row">
            ${feature(bedrooms, "Dormitorios")}${feature(bathrooms, "Baños")}${feature(garages, "Garajes")}
          </div>
        </div>
      </div>
    </a>
  </div>`;
}

function page(cards) {
  return `<!doctype html><html><body>
    <header><a href="tel:+59829000000">29 00 00 00</a><p>Consultas: ventas@prop.com.uy</p></header>
    <div class="row">${cards.join("")}</div>
  </body></html>`;
}

test("PROP maps card fields and marks category-derived taxonomy as inferred", () => {
  const [listing] = parsePropCategory(page([card("p002812")]), SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY);
  assert.equal(listing.external_id, "P002812");
  assert.equal(listing.url, "https://prop.com.uy/propiedades/alquiler-monoambiente-centro-p002812");
  assert.equal(listing.operation, "rent");
  assert.equal(listing.property_type, "apartment");
  assert.equal(listing.title, "Alquiler monoambiente Centro");
  assert.equal(listing.price, 30500);
  assert.equal(listing.currency, "UYU");
  assert.equal(listing.neighborhood, "Cordón");
  assert.equal(listing.admin_area, "Montevideo");
  assert.equal(listing.address, "Calle Falsa 1234");
  assert.equal(listing.bedrooms, 1);
  assert.equal(listing.parking_spaces, 0);
  assert.deepEqual(listing._home_ops_inferred_fields, [
    "property.operation",
    "property.property_type",
    "property.location.country_code",
    "property.location.city"
  ]);
});

test("PROP leaves fields the card never carries unknown", () => {
  const [listing] = parsePropCategory(page([card("p000001")]), SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY);
  assert.equal(listing.published_at, null);
  assert.equal(listing.description, null);
  assert.equal(listing.area_total_m2, undefined);
  assert.equal(listing.expenses, undefined);
});

test("PROP derives operation and property type only from known category segments", () => {
  const sale = parsePropCategory(page([card("p000002")]), SOURCE, "2026-08-20T04:00:00.000Z",
    "https://prop.com.uy/propiedades/comprar/casa/con-renta");
  assert.equal(sale[0].operation, "sale");
  assert.equal(sale[0].property_type, "house");
  const vague = parsePropCategory(page([card("p000003")]), SOURCE, "2026-08-20T04:00:00.000Z",
    "https://prop.com.uy/propiedades/comprar/vivienda-promovida");
  assert.equal(vague[0].property_type, "unknown");
  assert.equal(vague[0]._home_ops_inferred_fields.includes("property.property_type"), false);
});

test("PROP parses Uruguayan price formatting and rejects unusable prices", () => {
  assert.deepEqual(parsePropPrice("UYU 30.500"), { price: 30500, currency: "UYU" });
  assert.deepEqual(parsePropPrice("USD 675"), { price: 675, currency: "USD" });
  assert.deepEqual(parsePropPrice("U$S 1.250.000"), { price: 1250000, currency: "USD" });
  assert.deepEqual(parsePropPrice("Consultar"), { price: null, currency: null });
  assert.deepEqual(parsePropPrice(""), { price: null, currency: null });
});

test("PROP keeps hidden prices and missing addresses unknown instead of guessing", () => {
  const [listing] = parsePropCategory(
    page([card("p000004", { price: "Consultar precio", address: null })]),
    SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY
  );
  assert.equal(listing.price, null);
  assert.equal(listing.currency, null);
  assert.equal(listing.address, null);
});

test("PROP excludes agency contact data present elsewhere on the page", () => {
  const listings = parsePropCategory(page([card("p000005")]), SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY);
  const serialized = JSON.stringify(listings);
  assert.doesNotMatch(serialized, /tel:|29 00 00 00|ventas@prop\.com\.uy/);
});

test("PROP rejects unexpected hosts, paths, and query strings", () => {
  assert.throws(
    () => parsePropCategory(page([card("p000006", { href: "https://example.test/propiedades/casa-p000006" })]),
      SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY),
    /must use https:\/\/prop\.com\.uy/
  );
  assert.throws(
    () => parsePropCategory(page([card("p000007", { href: "https://prop.com.uy/agentes/juan-perez" })]),
      SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY),
    /listing path is not allowed/
  );
  assert.throws(
    () => parsePropCategory(page([card("p000008")]), SOURCE, "2026-08-20T04:00:00.000Z",
      "https://prop.com.uy/search_list?q=montevideo"),
    /category url may only use the page parameter/
  );
  assert.throws(
    () => parsePropCategory(page([card("p000009")]), SOURCE, "2026-08-20T04:00:00.000Z",
      "https://prop.com.uy/propiedades/alquilar/apartamento?ref=partner"),
    /category url may only use the page parameter/
  );
});

test("PROP reports a parse error when the card markup disappears", () => {
  assert.throws(
    () => parsePropCategory("<!doctype html><html><body><p>Sin resultados</p></body></html>",
      SOURCE, "2026-08-20T04:00:00.000Z", CATEGORY),
    /no property cards/
  );
});

test("PROP paginates serially, caps listings, and drops repeated cards", async () => {
  const requests = [];
  const result = await prop.fetch({ ...SOURCE, max_listings: 3, max_pages: 3 }, {
    now: "2026-08-20T04:00:00.000Z",
    async fetchText(url, options) {
      requests.push({ url, options });
      return requests.length === 1
        ? page([card("p000100"), card("p000101")])
        : page([card("p000101"), card("p000102")]);
    }
  });
  assert.deepEqual(result.listings.map((item) => item.external_id), ["P000100", "P000101", "P000102"]);
  assert.deepEqual(requests.map((item) => item.url), [
    "https://prop.com.uy/propiedades/alquilar/apartamento",
    "https://prop.com.uy/propiedades/alquilar/apartamento?page=2"
  ]);
});

test("PROP requires acknowledgement of both personal use and absent terms", async () => {
  const context = { now: "2026-08-20T04:00:00.000Z", fetchText: async () => assert.fail("must not fetch") };
  await assert.rejects(
    prop.fetch({ ...SOURCE, compliance: { ...SOURCE.compliance, terms_absent_acknowledged: false } }, context),
    /publishes no terms of use/
  );
  await assert.rejects(
    prop.fetch({ ...SOURCE, compliance: { ...SOURCE.compliance, automation_unspecified_acknowledged: false } }, context),
    /personal-use acknowledgement/
  );
  await assert.rejects(
    prop.fetch({ ...SOURCE, compliance: { ...SOURCE.compliance, confirmed: false } }, context),
    /compliance.confirmed/
  );
});

test("PROP enforces conservative pacing, retry, and volume limits", async () => {
  const context = { now: "2026-08-20T04:00:00.000Z", fetchText: async () => assert.fail("must not fetch") };
  await assert.rejects(prop.fetch({ ...SOURCE, min_interval_ms: 1_000 }, context), /at least 5000/);
  await assert.rejects(prop.fetch({ ...SOURCE, max_listings: 26 }, context), /from 1 to 25/);
  await assert.rejects(prop.fetch({ ...SOURCE, max_pages: 4 }, context), /from 1 to 3/);
  await assert.rejects(prop.fetch({ ...SOURCE, max_retries: 2 }, context), /max_retries cannot exceed 1/);
});
