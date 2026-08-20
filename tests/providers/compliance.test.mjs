import assert from "node:assert/strict";
import test from "node:test";
import { validateCompliance } from "../../providers/_compliance.mjs";

test("compliance review rejects nonexistent and expired dates", () => {
  const source = {
    type: "rss",
    compliance: {
      confirmed: true,
      terms_url: "https://agency.example.test/terms",
      reviewed_at: "2026-02-31"
    }
  };
  assert.throws(() => validateCompliance(source, "2026-08-19T12:00:00.000Z"), /date or max_age_days is invalid/);
  assert.throws(() => validateCompliance({
    ...source,
    compliance: { ...source.compliance, reviewed_at: "2025-01-01" }
  }, "2026-08-19T12:00:00.000Z"), /older than 365 days/);
});
