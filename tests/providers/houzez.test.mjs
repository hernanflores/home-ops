import assert from "node:assert/strict";
import test from "node:test";
import houzez, { parseHouzezItem } from "../../providers/houzez.mjs";

const SOURCE = {
  id: "agency-properties",
  type: "houzez",
  url: "https://agency.example.test/wp-json/wp/v2/properties",
  provider: "example-agency",
  per_page: 2,
  max_pages: 3,
  compliance: {
    confirmed: true,
    terms_url: "https://agency.example.test/terms",
    reviewed_at: "2026-08-19"
  },
  defaults: { country_code: "UY", city: "Montevideo" }
};

const ITEM = {
  id: 3091,
  date_gmt: "2026-07-17T18:21:28",
  modified_gmt: "2026-07-17T22:15:24",
  status: "publish",
  link: "https://agency.example.test/property/inversion-con-garaje/",
  title: { rendered: "Inversión con garaje" },
  content: { rendered: "<p>Dos dormitorios y patio.</p>" },
  class_list: ["property", "property_type-apartamento", "property_status-venta", "property_area-pocitos-nuevo"],
  property_meta: {
    fave_property_price: ["138000"],
    fave_property_price_prefix: ["U$D"],
    fave_property_bedrooms: ["2"],
    fave_property_bathrooms: ["1"],
    fave_property_garage: ["1"],
    fave_property_size: ["65"],
    fave_property_map_address: ["Pocitos Nuevo, Montevideo, Uruguay"],
    houzez_total_property_views: ["999"]
  }
};

test("Houzez maps public WordPress property fields and drops unrelated analytics", () => {
  const listing = parseHouzezItem(ITEM, SOURCE, "2026-08-19T12:00:00.000Z");
  assert.equal(listing.external_id, "3091");
  assert.equal(listing.operation, "sale");
  assert.equal(listing.property_type, "apartment");
  assert.equal(listing.neighborhood, "pocitos nuevo");
  assert.equal(listing.price, "138000");
  assert.equal(listing.currency, "USD");
  assert.equal(listing.description, "Dos dormitorios y patio.");
  assert.equal(listing._provider_payload.property_meta.houzez_total_property_views, undefined);
  assert.deepEqual(listing._home_ops_inferred_fields.sort(), ["property.location.city", "property.location.country_code"]);
});

test("Houzez paginates sequentially and stops on a short page", async () => {
  const urls = [];
  const result = await houzez.fetch(SOURCE, {
    now: "2026-08-19T12:00:00.000Z",
    async fetchJson(url) {
      urls.push(url);
      return urls.length === 1 ? [ITEM, { ...ITEM, id: 3092, link: "https://agency.example.test/property/3092/" }] : [];
    }
  });

  assert.equal(result.listings.length, 2);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /page=1/);
  assert.match(urls[0], /per_page=2/);
  assert.match(urls[1], /page=2/);
});

test("Houzez fails loudly at the configured pagination cap", async () => {
  await assert.rejects(
    houzez.fetch({ ...SOURCE, max_pages: 1 }, {
      now: "2026-08-19T12:00:00.000Z",
      async fetchJson() {
        return [ITEM, { ...ITEM, id: 3092 }];
      }
    }),
    /reached max_pages=1/
  );
});

test("Houzez treats WordPress invalid-page 400 as completion after a full final page", async () => {
  let page = 0;
  const result = await houzez.fetch(SOURCE, {
    now: "2026-08-19T12:00:00.000Z",
    async fetchJson() {
      page += 1;
      if (page === 1) return [ITEM, { ...ITEM, id: 3092, link: "https://agency.example.test/property/3092/" }];
      throw Object.assign(new Error("HTTP 400 Bad Request"), {
        status: 400,
        responseCode: "rest_post_invalid_page_number"
      });
    }
  });
  assert.equal(result.listings.length, 2);
  assert.equal(page, 2);
});

test("Houzez does not hide unrelated page-2 HTTP 400 errors", async () => {
  let page = 0;
  await assert.rejects(houzez.fetch(SOURCE, {
    now: "2026-08-19T12:00:00.000Z",
    async fetchJson() {
      page += 1;
      if (page === 1) return [ITEM, { ...ITEM, id: 3092 }];
      throw Object.assign(new Error("invalid parameter"), { status: 400, responseCode: "rest_invalid_param" });
    }
  }), /invalid parameter/);
});

test("Houzez marks regional fallback currency as inferred when source currency is unusable", () => {
  const listing = parseHouzezItem({
    ...ITEM,
    property_meta: { ...ITEM.property_meta, fave_currency: ["Dólares"], fave_property_price_prefix: [""] }
  }, { ...SOURCE, defaults: { ...SOURCE.defaults, currency: "USD" } }, "2026-08-19T12:00:00.000Z");
  assert.equal(listing.currency, "USD");
  assert.ok(listing._home_ops_inferred_fields.includes("property.pricing.currency"));
});
