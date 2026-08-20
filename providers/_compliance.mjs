import { ProviderComplianceError } from "./_errors.mjs";
import { assertPublicHttpsUrl } from "./_http.mjs";

export function validateCompliance(source, now) {
  const compliance = source.compliance;
  if (compliance?.confirmed !== true) {
    throw new ProviderComplianceError(`${source.type} requires compliance.confirmed: true after reviewing the source terms`);
  }
  if (!compliance.terms_url) throw new ProviderComplianceError(`${source.type} requires compliance.terms_url`);
  try {
    assertPublicHttpsUrl(compliance.terms_url);
  } catch (error) {
    throw new ProviderComplianceError(`${source.type} compliance.terms_url is invalid: ${error.message}`, { cause: error });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(compliance.reviewed_at ?? "")) {
    throw new ProviderComplianceError(`${source.type} requires compliance.reviewed_at in YYYY-MM-DD format`);
  }
  const reviewed = new Date(`${compliance.reviewed_at}T00:00:00.000Z`).valueOf();
  const current = new Date(now).valueOf();
  const maxAgeDays = Number(compliance.max_age_days ?? 365);
  if (!Number.isFinite(reviewed)
    || new Date(reviewed).toISOString().slice(0, 10) !== compliance.reviewed_at
    || reviewed > current || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    throw new ProviderComplianceError(`${source.type} compliance review date or max_age_days is invalid`);
  }
  if (current - reviewed > maxAgeDays * 86_400_000) {
    throw new ProviderComplianceError(`${source.type} compliance review is older than ${maxAgeDays} days`);
  }
}
