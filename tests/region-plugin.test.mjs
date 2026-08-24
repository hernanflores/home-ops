import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";
import { runCompatibilityCheck } from "../scripts/compatibility.mjs";
import { validatePluginSet } from "../scripts/lib/plugins.mjs";
import { validateRegion } from "../scripts/lib/region.mjs";

const ROOT = resolve(".");

test("all LATAM reference regions pass the shared regional schema", async () => {
  const regions = ["uy-montevideo", "ar-buenos-aires", "br-sao-paulo", "cl-santiago", "mx-cdmx", "co-bogota"];
  for (const id of regions) {
    const region = YAML.parse(await readFile(resolve(`regions/${id}.yml`), "utf8"));
    assert.equal((await validateRegion(region, ROOT)).id, id);
  }
});

test("regional validation rejects currency drift and unsafe alias keys", async () => {
  const region = YAML.parse(await readFile(resolve("regions/uy-montevideo.yml"), "utf8"));
  await assert.rejects(validateRegion({ ...region, financing: { ...region.financing, currency: "EUR" } }, ROOT), /does not match/);
  await assert.rejects(validateRegion({ ...region, neighborhood_aliases: { "Bad Alias": "Bad" } }, ROOT), /lowercase/);
});

test("plugins are disabled by default and grants cannot exceed manifest permissions", async () => {
  const manifest = { manifest_version: 1, id: "example-provider", name: "Example", version: "1.0.0", api_version: 1, entrypoint: "./plugin.mjs", capabilities: ["provider"], permissions: ["read:listings"] };
  const inactive = await validatePluginSet([manifest], undefined, ROOT);
  assert.deepEqual(inactive.enabled, []);
  await assert.rejects(validatePluginSet([manifest], { schema_version: 1, enabled: ["example-provider"], grants: [{ plugin_id: "example-provider", permissions: ["network:https"] }] }, ROOT), /undeclared permission/);
});

test("plugin activation validates explicit least-privilege grants", async () => {
  const manifest = { manifest_version: 1, id: "example-provider", name: "Example", version: "1.0.0", api_version: 1, entrypoint: "./plugin.mjs", capabilities: ["provider"], permissions: ["read:listings", "network:https"], network_hosts: ["agency.example"] };
  const result = await validatePluginSet([manifest], { schema_version: 1, enabled: ["example-provider"], grants: [{ plugin_id: "example-provider", permissions: ["read:listings"] }] }, ROOT);
  assert.deepEqual(result.enabled, ["example-provider"]);
});

test("compatibility report sees the portable skill wrappers and financing mode", async () => {
  const report = await runCompatibilityCheck();
  assert.equal(report.tools.codex, "compatible");
  assert.equal(report.tools.claude_code, "compatible");
  assert.equal(report.tools.opencode, "compatible");
  assert.equal(report.checks.financing_mode, "compatible");
  assert.deepEqual(report.warnings, []);
});
