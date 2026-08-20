import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const TRACKED_PATHS = [
  "source.published_at", "property.operation", "property.property_type", "property.title",
  "property.description", "property.location", "property.pricing", "property.features",
  "provenance", "unknown_fields", "original"
];

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function changesBetween(previous, incoming) {
  const changes = {};
  for (const path of TRACKED_PATHS) {
    const before = getPath(previous, path);
    const after = getPath(incoming, path);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes[path] = { from: before, to: after };
  }
  return changes;
}

export async function readInventory(path) {
  try {
    const content = await readFile(path, "utf8");
    return content.split("\n").filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: ${error.message}`);
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export function mergeInventory(existing, incoming, now) {
  const byId = new Map(existing.map((listing) => [listing.id, listing]));
  const touched = [];

  for (const candidate of incoming) {
    const previous = byId.get(candidate.id);
    if (!previous) {
      byId.set(candidate.id, candidate);
      touched.push(candidate.id);
      continue;
    }

    const changes = changesBetween(previous, candidate);
    const changed = Object.keys(changes).length > 0;
    const merged = {
      ...candidate,
      status: changed ? "updated" : "unchanged",
      first_seen_at: previous.first_seen_at,
      last_seen_at: now,
      last_changed_at: changed ? now : previous.last_changed_at,
      history: changed ? [...previous.history, { at: now, changes }] : previous.history,
      duplicate: previous.duplicate
    };
    byId.set(candidate.id, merged);
    touched.push(candidate.id);
  }

  return { listings: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)), touched };
}

export async function writeInventory(path, listings) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  const content = listings.map((listing) => JSON.stringify(listing)).join("\n") + (listings.length ? "\n" : "");
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}
