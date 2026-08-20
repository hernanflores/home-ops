import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function content(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function lockIsStale(path, timeoutMs) {
  try {
    const owner = Number.parseInt((await readFile(path, "utf8")).trim().split(/\s+/)[0], 10);
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        return false;
      } catch (error) {
        return error.code === "ESRCH";
      }
    }
    return Date.now() - (await stat(path)).mtimeMs > timeoutMs;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function reclaimStaleLock(lockPath, timeoutMs, deadline) {
  const recoveryPath = `${lockPath}.recovery`;
  let recovery;
  while (!recovery) {
    try {
      recovery = await open(recoveryPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) return false;
      await delay(10);
    }
  }
  try {
    await recovery.writeFile(`${process.pid} ${Date.now()}\n`, "utf8");
    if (await lockIsStale(lockPath, timeoutMs)) await rm(lockPath, { force: true });
    return true;
  } finally {
    await recovery.close();
    await rm(recoveryPath, { force: true });
  }
}

export async function readMarketObservations(path, validate) {
  const source = await content(path);
  const records = source.split("\n").filter(Boolean).map((line, index) => {
    try {
      const record = JSON.parse(line);
      validate?.(record);
      return record;
    } catch (error) {
      throw new Error(`${path}:${index + 1}: ${error.message}`);
    }
  });
  return { records, source };
}

export async function writeMarketObservations(path, records, expectedSource = null) {
  await mkdir(dirname(path), { recursive: true });
  if (expectedSource !== null && await content(path) !== expectedSource) throw new Error(`Market observations changed during update: ${path}`);
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const output = records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
  try {
    await writeFile(temporary, output, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function withMarketLock(path, callback, timeoutMs = 5000) {
  await mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath, timeoutMs)) {
        if (!await reclaimStaleLock(lockPath, timeoutMs, deadline)) throw new Error(`Market evidence stale-lock recovery is held by another process: ${path}`);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Market evidence is locked by another update: ${path}`);
      await delay(10);
    }
  }
  try {
    await handle.writeFile(`${process.pid} ${Date.now()}\n`, "utf8");
    return await callback();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
