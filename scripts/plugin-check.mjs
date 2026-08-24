#!/usr/bin/env node
import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { validatePluginSet } from "./lib/plugins.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPath = (path) => isAbsolute(path) ? path : resolve(ROOT, path);

async function exists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }
async function readManifests(directory) {
  if (!(await exists(directory))) return [];
  const files = (await readdir(directory)).filter((file) => file.endsWith(".yml") && file !== "activation.yml").sort();
  return Promise.all(files.map(async (file) => YAML.parse(await readFile(join(directory, file), "utf8"))));
}

export async function runPluginCheck(options = {}) {
  const manifestDirectory = projectPath(options.manifestDir ?? "plugins");
  const activationPath = projectPath(options.activation ?? "config/plugins.yml");
  const activation = await exists(activationPath) ? YAML.parse(await readFile(activationPath, "utf8")) : { schema_version: 1, enabled: [], grants: [] };
  const manifests = await readManifests(manifestDirectory);
  const result = await validatePluginSet(manifests, activation, ROOT);
  return { manifest_directory: manifestDirectory, activation_path: activationPath, plugin_count: manifests.length, ...result };
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--json") options.json = true;
    else if (argument.startsWith("--")) {
      const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      if (!["manifestDir", "activation"].includes(key)) throw new Error(`Unknown option: ${argument}`);
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      options[key] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  Promise.resolve().then(async () => {
    const options = parse(process.argv.slice(2));
    if (options.help) return process.stdout.write("Usage: npm run plugin:check -- [--manifest-dir <path>] [--activation <path>] [--json]\n");
    const result = await runPluginCheck(options);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : `Validated ${result.plugin_count} plugin manifest(s); enabled: ${result.enabled.join(", ") || "none"}.\n`);
  }).catch((error) => { process.stderr.write(`home-ops plugin-check: ${error.message}\n`); process.exitCode = 1; });
}
