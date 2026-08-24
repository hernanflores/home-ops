import { join } from "node:path";
import { createSchemaValidator } from "./validate.mjs";

const PERMISSIONS = new Set(["read:listings", "read:profile", "read:tracker", "write:derived-reports", "network:https", "credentials:declared"]);

export async function validatePluginSet(manifests, activation, root) {
  const validateManifest = await createSchemaValidator(join(root, "schemas/plugin-manifest.schema.json"), "plugin manifest");
  const validateActivation = await createSchemaValidator(join(root, "schemas/plugin-activation.schema.json"), "plugin activation");
  manifests.forEach(validateManifest);
  validateActivation(activation ?? { schema_version: 1, enabled: [], grants: [] });
  const byId = new Map();
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) throw new Error(`Duplicate plugin id: ${manifest.id}`);
    byId.set(manifest.id, manifest);
    if (manifest.permissions.includes("network:https") && !(manifest.network_hosts?.length)) throw new Error(`Plugin ${manifest.id} must declare network_hosts for network:https`);
    if (manifest.permissions.includes("credentials:declared") && !(manifest.credential_refs?.length)) throw new Error(`Plugin ${manifest.id} must declare credential_refs for credentials:declared`);
  }
  const enabled = new Set(activation?.enabled ?? []);
  for (const id of enabled) if (!byId.has(id)) throw new Error(`Enabled plugin has no manifest: ${id}`);
  const grants = new Map((activation?.grants ?? []).map((grant) => [grant.plugin_id, grant]));
  for (const [id, grant] of grants) {
    const manifest = byId.get(id);
    if (!manifest) throw new Error(`Grant has no plugin manifest: ${id}`);
    if (!enabled.has(id)) throw new Error(`Plugin grant is present but plugin is not enabled: ${id}`);
    for (const permission of grant.permissions) {
      if (!PERMISSIONS.has(permission) || !manifest.permissions.includes(permission)) throw new Error(`Plugin ${id} was granted undeclared permission: ${permission}`);
    }
    for (const ref of grant.credential_refs ?? []) if (!manifest.credential_refs?.includes(ref)) throw new Error(`Plugin ${id} was granted undeclared credential reference: ${ref}`);
  }
  return { manifests, enabled: [...enabled].sort(), grants: [...grants.values()] };
}
