import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export async function createSchemaValidator(schemaPath, label = "document") {
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  return (value) => {
    if (!validate(value)) {
      const detail = validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
      const description = typeof label === "function" ? label(value) : label;
      throw new Error(`Invalid ${description}: ${detail}`);
    }
  };
}

export async function createListingValidator(schemaPath) {
  const validate = await createSchemaValidator(schemaPath, (listing) => `canonical listing ${listing.id ?? "unknown"}`);
  return (listing) => {
    validate(listing);
    if (!listing.source.url) return;
    const url = new URL(listing.source.url);
    const secret = [...url.searchParams.keys()].some((key) => /^(?:access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i.test(key));
    if (url.username || url.password || secret) throw new Error(`Invalid canonical listing ${listing.id}: unsafe source URL`);
  };
}

export async function createMarketObservationValidator(schemaPath) {
  const validate = await createSchemaValidator(schemaPath, (observation) => `market observation ${observation.id ?? "unknown"}`);
  return (observation) => {
    validate(observation);
    if (observation.evidence_type === "listing_ask" && observation.effective_at !== observation.observed_at) {
      throw new Error(`Invalid market observation ${observation.id}: listing ask effective_at must equal observed_at`);
    }
    if (!observation.source.url) return;
    const url = new URL(observation.source.url);
    const secret = [...url.searchParams.keys()].some((key) => /^(?:access_token|api_?key|token|key|client_secret|signature|sig|x-amz-(?:credential|signature|security-token))$/i.test(key));
    if (url.username || url.password || secret) throw new Error(`Invalid market observation ${observation.id}: unsafe source URL`);
  };
}
