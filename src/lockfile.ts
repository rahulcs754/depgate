import { existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Change, LockEntry } from "./types.js";

export const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] as const;

/** The first lockfile found in the current folder. */
export function findLockfile(): string {
  const found = LOCKFILES.find((f) => existsSync(f));
  if (!found) throw new Error(`No lockfile found (looked for ${LOCKFILES.join(", ")})`);
  return found;
}

/** Reads package-lock.json (v2/v3), pnpm-lock.yaml or yarn.lock (v1 and Berry). Returns one entry per name@version. */
export function parseLockfile(text: string): LockEntry[] {
  const trimmed = text.trimStart();
  let entries: LockEntry[];
  if (trimmed.startsWith("{")) entries = parseNpm(text);
  else if (trimmed.includes("# yarn lockfile v1")) entries = parseYarnV1(text);
  else if (/^__metadata:/m.test(text)) entries = parseYarnBerry(text);
  else if (/^lockfileVersion:/m.test(text)) entries = parsePnpm(text);
  else throw new Error("Unsupported lockfile: expected package-lock.json, pnpm-lock.yaml or yarn.lock");

  const seen = new Map<string, LockEntry>();
  for (const e of entries) {
    const key = `${e.name}@${e.version}`;
    if (!seen.has(key)) seen.set(key, { ...e, resolved: normalizeResolved(e.resolved) });
  }
  return [...seen.values()];
}

interface NpmLockfile {
  packages?: Record<string, { version?: string; resolved?: string; link?: boolean; name?: string }>;
}

function parseNpm(text: string): LockEntry[] {
  const raw = JSON.parse(text) as NpmLockfile;
  if (!raw.packages) {
    throw new Error("Unsupported lockfile: no \"packages\" field (npm lockfile v2 or v3 needed)");
  }
  const out: LockEntry[] = [];
  for (const [path, info] of Object.entries(raw.packages)) {
    if (path === "" || info.link || !info.version) continue;
    const idx = path.lastIndexOf("node_modules/");
    if (idx === -1) continue; // workspace folders
    out.push({ name: info.name ?? path.slice(idx + "node_modules/".length), version: info.version, resolved: info.resolved });
  }
  return out;
}

interface PnpmLockfile {
  packages?: Record<string, { resolution?: { tarball?: string; repo?: string; commit?: string }; name?: string; version?: string }>;
}

/** pnpm v5 ("/name/1.0.0"), v6 ("/name@1.0.0(peer@1)") and v9 ("name@1.0.0") package keys. */
function parsePnpm(text: string): LockEntry[] {
  const raw = (parseYaml(text) ?? {}) as PnpmLockfile;
  const out: LockEntry[] = [];
  for (const [key, info] of Object.entries(raw.packages ?? {})) {
    const id = key.replace(/^\//, "").replace(/\(.*$/, "");
    const at = id.lastIndexOf("@");
    let name: string;
    let version: string;
    if (at > 0) [name, version] = [id.slice(0, at), id.slice(at + 1)];
    else {
      const slash = id.lastIndexOf("/");
      [name, version] = [id.slice(0, slash), id.slice(slash + 1)];
    }
    if (!name || !version) continue;
    const res = info.resolution;
    const resolved = res?.tarball ?? (res?.repo ? `${res.repo}#${res.commit ?? ""}` : undefined);
    // Non-registry versions look like "https://..." or "github.com/x/y/abc"; keep pnpm's "version" when given.
    if (!/^\d/.test(version)) {
      out.push({ name: info.name ?? name, version: info.version ?? version, resolved: resolved ?? version });
      continue;
    }
    out.push({ name, version, resolved });
  }
  return out;
}

function parseYarnV1(text: string): LockEntry[] {
  const out: LockEntry[] = [];
  let name: string | undefined;
  let entry: Partial<LockEntry> = {};
  const flush = () => {
    if (name && entry.version) out.push({ name, version: entry.version, resolved: entry.resolved });
    entry = {};
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      flush();
      const spec = line.replace(/:$/, "").split(",")[0]!.trim().replace(/^"|"$/g, "");
      name = spec.slice(0, spec.lastIndexOf("@") > 0 ? spec.lastIndexOf("@") : undefined);
      continue;
    }
    const m = /^ {2}(version|resolved) "?([^"]+)"?$/.exec(line);
    if (m) entry[m[1] as "version" | "resolved"] = m[2];
  }
  flush();
  return out;
}

function parseYarnBerry(text: string): LockEntry[] {
  const raw = (parseYaml(text) ?? {}) as Record<string, { version?: string; resolution?: string }>;
  const out: LockEntry[] = [];
  for (const [key, info] of Object.entries(raw)) {
    if (key === "__metadata" || !info.version || !info.resolution) continue;
    const { resolution, version } = info;
    if (/@(workspace|patch|portal|link):/.test(resolution)) continue;
    const npm = resolution.lastIndexOf("@npm:");
    if (npm > 0) {
      out.push({ name: resolution.slice(0, npm), version });
      continue;
    }
    const at = resolution.indexOf("@", 1);
    out.push({ name: resolution.slice(0, at), version, resolved: resolution.slice(at + 1) });
  }
  return out;
}

/** Yarn's registry mirror counts as the npm registry. */
function normalizeResolved(resolved: string | undefined): string | undefined {
  return resolved?.replace(/^https:\/\/registry\.yarnpkg\.com\//, "https://registry.npmjs.org/");
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
