import type { Change, LockEntry } from "./types.js";

interface RawLockfile {
  lockfileVersion?: number;
  packages?: Record<string, { version?: string; resolved?: string; link?: boolean; name?: string }>;
}

/** Reads npm lockfile v2/v3 (the "packages" map). Returns one entry per name@version. */
export function parseLockfile(text: string): LockEntry[] {
  const raw = JSON.parse(text) as RawLockfile;
  if (!raw.packages) {
    throw new Error("Unsupported lockfile: no \"packages\" field (npm lockfile v2 or v3 needed)");
  }
  const seen = new Map<string, LockEntry>();
  for (const [path, info] of Object.entries(raw.packages)) {
    if (path === "" || info.link || !info.version) continue;
    const idx = path.lastIndexOf("node_modules/");
    if (idx === -1) continue; // workspace folders
    const name = info.name ?? path.slice(idx + "node_modules/".length);
    const key = `${name}@${info.version}`;
    if (!seen.has(key)) seen.set(key, { name, version: info.version, resolved: info.resolved });
  }
  return [...seen.values()];
}

/** Packages (name@version) present in head but not in base. */
export function diffLockfiles(base: LockEntry[], head: LockEntry[]): Change[] {
  const baseKeys = new Set(base.map((e) => `${e.name}@${e.version}`));
  const baseVersions = new Map<string, string>();
  for (const e of base) baseVersions.set(e.name, e.version);

  return head
    .filter((e) => !baseKeys.has(`${e.name}@${e.version}`))
    .map((e) => ({ name: e.name, version: e.version, previous: baseVersions.get(e.name), resolved: e.resolved }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
