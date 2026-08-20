import { readFile } from "node:fs/promises";

function parseRows(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted && char === '"' && input[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export async function load(options) {
  const rows = parseRows((await readFile(options.path, "utf8")).replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error(`${options.path}: empty CSV header`);

  return rows.slice(1).map((row, rowIndex) => {
    if (row.length !== headers.length) {
      throw new Error(`${options.path}:${rowIndex + 2}: expected ${headers.length} columns, got ${row.length}`);
    }
    return {
      ...Object.fromEntries(headers.map((header, index) => [header, row[index].trim()])),
      _home_ops_source: {
        provider: options.provider,
        retrieved_at: options.retrievedAt
      }
    };
  });
}

export default {
  id: "local-csv",
  async fetch(source, context) {
    if (!source.path) throw new Error("local-csv requires path");
    return {
      listings: await load({
        path: context.resolvePath(source.path),
        provider: source.provider ?? source.id ?? "local-csv",
        retrievedAt: context.now
      })
    };
  }
};
