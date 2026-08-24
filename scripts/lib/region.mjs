import { join } from "node:path";
import { createSchemaValidator } from "./validate.mjs";

export async function validateRegion(region, root) {
  const validate = await createSchemaValidator(join(root, "schemas/region.schema.json"), "regional configuration");
  validate(region);
  const validateValuation = await createSchemaValidator(join(root, "schemas/valuation-config.schema.json"), "regional valuation configuration");
  validateValuation(region.valuation);
  if (region.financing.currency !== region.currency) throw new Error(`Regional financing currency ${region.financing.currency} does not match region currency ${region.currency}`);
  for (const [alias, canonical] of Object.entries(region.neighborhood_aliases)) {
    if (!/^[a-z0-9_]+$/.test(alias)) throw new Error(`Neighborhood alias must use lowercase letters, digits, and underscores: ${alias}`);
    if (!canonical.trim()) throw new Error(`Neighborhood alias ${alias} cannot be blank`);
  }
  return region;
}
