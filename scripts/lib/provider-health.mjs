import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendProviderRuns(path, now, diagnostics) {
  if (diagnostics.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const lines = diagnostics.map((diagnostic) => JSON.stringify({ run_at: now, ...diagnostic })).join("\n") + "\n";
  await appendFile(path, lines, "utf8");
}
