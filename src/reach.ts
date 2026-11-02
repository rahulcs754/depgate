import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * ReachCheck: for each open Dependabot alert, is the vulnerable package (and,
 * when the advisory names them, the vulnerable functions) actually used by
 * your code? Static and best-effort: it reads imports, not the call graph.
 */

export interface Alert {
  number: number;
  package: string;
  severity: string;
  ghsa: string;
  summary: string;
  manifest?: string;
  scope?: "runtime" | "development" | null;
  relationship?: "direct" | "transitive" | "inconclusive" | null;
  vulnerableRange?: string;
  patched?: string;
  /** Vulnerable functions from the advisory, e.g. ["template"] or ["lodash.template"]. */
  functions: string[];
  url?: string;
}

export type Reach = "called" | "imported" | "imported-safe" | "via-dependency" | "unknown" | "not-imported" | "dev-only";

export interface ReachResult {
  alert: Alert;
  reach: Reach;
  evidence: string;
  /** "client" when a Next.js client component imports it, "server" when only server code does. */
  side?: "client" | "server" | "both";
}

// ---- source scan --------------------------------------------------------------

export interface SourceFile {
  path: string;
  text: string;
}

const CODE = /\.(c|m)?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage", "vendor", ".turbo", ".vercel"]);
const TEST = /(^|\/)(__tests__|__mocks__|tests?|e2e|cypress|playwright)\/|\.(test|spec|stories)\.[cm]?[jt]sx?$/;

export const isTestFile = (p: string) => TEST.test(p);

/** All JS/TS files under `root`, skipping node_modules and build output. */
export function readSources(root = ".", maxFiles = 5000): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (out.length >= maxFiles) return;
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(full);
      else if (CODE.test(name) && !name.endsWith(".d.ts") && st.size < 1_000_000) {
        out.push({ path: relative(root, full).split("\\").join("/"), text: readFileSync(full, "utf8") });
      }
    }
  };
  walk(root);
  return out;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;

/** "lodash/template" -> "lodash", "@scope/pkg/sub" -> "@scope/pkg". Relative and node: imports -> undefined. */
export function packageOf(spec: string): string | undefined {
  if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:") || spec.startsWith("#")) return undefined;
  const parts = spec.split("/");
  return spec.startsWith("@") ? (parts.length > 1 ? `${parts[0]}/${parts[1]}` : undefined) : parts[0];
}

/** Package name -> files that import it. */
export function importsByPackage(files: SourceFile[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of files) {
    for (const m of f.text.matchAll(IMPORT_RE)) {
      const pkg = packageOf(m[1]!);
      if (!pkg) continue;
      const list = map.get(pkg) ?? [];
      if (!list.includes(f.path)) list.push(f.path);
      map.set(pkg, list);
    }
  }
  return map;
}

function sideOf(file: SourceFile): "client" | "server" | undefined {
  if (/^\s*(\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(file.text)) return "client";
  if (/^\s*["']use server["']/.test(file.text) || /(^|\/)(pages\/api|app\/api)\//.test(file.path) || /(^|\/)(route|middleware)\.[jt]s$/.test(file.path)) return "server";
  if (/(^|\/)app\//.test(file.path)) return "server"; // App Router files are server components unless "use client"
  return undefined;
}

// ---- dependency graph from the lockfile --------------------------------------------

export interface DepGraph {
  /** Direct dependencies of the project (all workspaces), with whether they are dev-only. */
  direct: Map<string, { dev: boolean }>;
  /** child -> packages that depend on it. */
  parents: Map<string, Set<string>>;
  /** False when the lockfile format gave us no edges. */
  known: boolean;
}

const addEdge = (g: DepGraph, parent: string, child: string) => {
  const set = g.parents.get(child) ?? new Set<string>();
  set.add(parent);
  g.parents.set(child, set);
};

function nameFromKey(key: string): string {
  const id = key.replace(/^\//, "").replace(/\(.*$/, "");
  const at = id.lastIndexOf("@");
  if (at > 0) return id.slice(0, at);
  const slash = id.lastIndexOf("/"); // pnpm v5 "/name/1.0.0"
  return slash > 0 ? id.slice(0, slash) : id;
}

/** Reads dependency edges from package-lock.json, pnpm-lock.yaml or yarn.lock (v1; with package.json for roots). */
export function dependencyGraph(lockText: string, packageJson?: string): DepGraph {
  const g: DepGraph = { direct: new Map(), parents: new Map(), known: false };
  const addDirect = (deps: Record<string, unknown> | undefined, dev: boolean) => {
    for (const name of Object.keys(deps ?? {})) {
      const prev = g.direct.get(name);
      g.direct.set(name, { dev: prev ? prev.dev && dev : dev });
    }
  };
  const trimmed = lockText.trimStart();

  if (trimmed.startsWith("{")) {
    const raw = JSON.parse(lockText) as { packages?: Record<string, Record<string, any>> };
    for (const [path, info] of Object.entries(raw.packages ?? {})) {
      const idx = path.lastIndexOf("node_modules/");
      if (idx === -1) {
        // the root or a workspace folder
        addDirect(info.dependencies, false);
        addDirect(info.optionalDependencies, false);
        addDirect(info.devDependencies, true);
        continue;
      }
      const name = info.name ?? path.slice(idx + "node_modules/".length);
      for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const child of Object.keys(info[field] ?? {})) {
          addEdge(g, name, child);
          g.known = true;
        }
      }
    }
    return g;
  }

  if (/^lockfileVersion:/m.test(lockText)) {
    const raw = (parseYaml(lockText) ?? {}) as Record<string, any>;
    const importers = raw.importers ?? { ".": raw };
    for (const imp of Object.values<Record<string, any>>(importers)) {
      addDirect(imp.dependencies, false);
      addDirect(imp.optionalDependencies, false);
      addDirect(imp.devDependencies, true);
    }
    for (const section of [raw.packages, raw.snapshots]) {
      for (const [key, info] of Object.entries<Record<string, any>>(section ?? {})) {
        const name = nameFromKey(key);
        for (const field of ["dependencies", "optionalDependencies"]) {
          for (const child of Object.keys(info?.[field] ?? {})) {
            addEdge(g, name, child);
            g.known = true;
          }
        }
      }
    }
    return g;
  }

  if (packageJson) {
    const pkg = JSON.parse(packageJson) as Record<string, Record<string, string> | undefined>;
    addDirect(pkg.dependencies, false);
    addDirect(pkg.optionalDependencies, false);
    addDirect(pkg.devDependencies, true);
  }
  if (trimmed.includes("# yarn lockfile v1")) {
    let name: string | undefined;
    let inDeps = false;
    for (const line of lockText.split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      if (!line.startsWith(" ")) {
        const spec = line.replace(/:$/, "").split(",")[0]!.trim().replace(/^"|"$/g, "");
        name = spec.slice(0, spec.lastIndexOf("@") > 0 ? spec.lastIndexOf("@") : undefined);
        inDeps = false;
      } else if (/^ {2}\S/.test(line)) {
        inDeps = /^ {2}(optionalD|d)ependencies:/.test(line);
      } else if (inDeps && name && /^ {4}\S/.test(line)) {
        addEdge(g, name, line.trim().split(/\s+/)[0]!.replace(/^"|"$/g, ""));
        g.known = true;
      }
    }
  }
  return g;
}

/** Direct dependencies that pull `name` in, walking up the graph. */
export function directParents(g: DepGraph, name: string): string[] {
  const seen = new Set<string>([name]);
  const queue = [name];
  const found = new Set<string>();
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of g.parents.get(cur) ?? []) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (g.direct.has(p)) found.add(p);
      queue.push(p);
    }
  }
  return [...found].sort();
}

// ---- verdict ---------------------------------------------------------------------

/** "lodash.template" or "lodash#template" -> "template". */
const fnName = (f: string) => f.split(/[.#:]/).pop()!.replace(/\(.*$/, "");

function list(items: string[], max = 3): string {
  const shown = items.slice(0, max).map((s) => `\`${s}\``).join(", ");
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

export function checkReach(alerts: Alert[], files: SourceFile[], graph: DepGraph): ReachResult[] {
  const imports = importsByPackage(files);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const sideFor = (paths: string[]): ReachResult["side"] => {
    const sides = new Set(paths.map((p) => sideOf(byPath.get(p)!)).filter(Boolean));
    if (sides.has("client") && sides.has("server")) return "both";
    return sides.has("client") ? "client" : sides.has("server") ? "server" : undefined;
  };

  return alerts
    .map((alert): ReachResult => {
      const name = alert.package;
      const all = imports.get(name) ?? [];
      const prod = all.filter((p) => !isTestFile(p));

      if (alert.scope === "development" || graph.direct.get(name)?.dev) {
        if (!prod.length) return { alert, reach: "dev-only", evidence: "Dev dependency only. It does not ship to production." };
      }

      if (prod.length) {
        const side = sideFor(prod);
        const fns = alert.functions.map(fnName).filter(Boolean);
        if (fns.length) {
          const hits: string[] = [];
          for (const p of prod) {
            const lines = byPath.get(p)!.text.split("\n");
            lines.forEach((l, i) => {
              if (fns.some((fn) => new RegExp(`(^|[^\\w$])${fn.replace(/[$]/g, "\\$")}\\s*\\(`).test(l))) hits.push(`${p}:${i + 1}`);
            });
          }
          if (hits.length) return { alert, reach: "called", side, evidence: `Vulnerable function ${list(fns)} called at ${list(hits)}.` };
          return { alert, reach: "imported-safe", side, evidence: `Imported in ${list(prod)}, but the vulnerable function ${list(fns)} is not called there.` };
        }
        return { alert, reach: "imported", side, evidence: `Imported in ${prod.length} file${prod.length > 1 ? "s" : ""}: ${list(prod)}. The advisory does not name the vulnerable function.` };
      }

      if (!graph.known && !graph.direct.has(name)) {
        return { alert, reach: "unknown", evidence: "Transitive, and this lockfile format has no dependency graph to follow." };
      }
      const parents = directParents(graph, name);
      const used = parents.filter((p) => (imports.get(p) ?? []).some((f) => !isTestFile(f)));
      if (used.length) {
        const where = used.flatMap((p) => (imports.get(p) ?? []).filter((f) => !isTestFile(f)));
        return { alert, reach: "via-dependency", side: sideFor(where), evidence: `Pulled in by ${list(used)}, which your code imports (${list(where)}).` };
      }
      if (parents.length && parents.every((p) => graph.direct.get(p)?.dev)) {
        return { alert, reach: "dev-only", evidence: `Only pulled in by dev dependencies: ${list(parents)}.` };
      }
      if (all.length) return { alert, reach: "dev-only", evidence: `Only imported in tests: ${list(all)}.` };
      return {
        alert,
        reach: "not-imported",
        evidence: parents.length ? `Pulled in by ${list(parents)}, but your code imports none of them.` : "Not imported by your code.",
      };
    })
    .sort((a, b) => ORDER.indexOf(a.reach) - ORDER.indexOf(b.reach) || SEV.indexOf(a.alert.severity) - SEV.indexOf(b.alert.severity));
}

const ORDER: Reach[] = ["called", "imported", "via-dependency", "unknown", "imported-safe", "not-imported", "dev-only"];
const SEV = ["critical", "high", "medium", "moderate", "low"];

// ---- report ----------------------------------------------------------------------

export const REACH_LABEL: Record<Reach, string> = {
  called: "🔴 Reachable",
  imported: "🟠 Imported",
  "via-dependency": "🟠 Via dependency",
  unknown: "❔ Unknown",
  "imported-safe": "🟡 Imported, function not called",
  "not-imported": "⚪ Not imported",
  "dev-only": "⚪ Dev only",
};

/** Alerts that need action first: the code really uses the package. */
export const isReachable = (r: ReachResult) => r.reach === "called" || r.reach === "imported" || r.reach === "via-dependency";

export function renderReach(results: ReachResult[], note?: string): string {
  const lines = ["### DepGate ReachCheck: open Dependabot alerts", ""];
  if (note) {
    lines.push(note);
    return lines.join("\n");
  }
  if (!results.length) {
    lines.push("No open npm Dependabot alerts. ✅");
    return lines.join("\n");
  }
  const reachable = results.filter(isReachable).length;
  lines.push(
    `**${reachable}** of ${results.length} open alert${results.length > 1 ? "s" : ""} reach your code. Fix those first; the rest are lower priority.`,
    "",
    "| Reach | Alert | Package | Severity | Why | Fix |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const r of results.slice(0, 50)) {
    const a = r.alert;
    const alertCell = a.url ? `[#${a.number}](${a.url})` : `#${a.number}`;
    const side = r.side ? ` (${r.side === "both" ? "client + server" : r.side})` : "";
    lines.push(
      `| ${REACH_LABEL[r.reach]}${side} | ${alertCell} ${cell(a.summary)} | \`${a.package}\` | ${a.severity} | ${cell(r.evidence)} | ${a.patched ? `Upgrade to ${a.patched}` : "No patch yet"} |`,
    );
  }
  if (results.length > 50) lines.push(`| | and ${results.length - 50} more | | | | |`);
  lines.push("", "<sub>Static check of imports and function names. \"Not imported\" means lower priority, not safe forever.</sub>");
  return lines.join("\n");
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const SEVERITIES = ["low", "medium", "high", "critical"];

/** Error message when a reachable alert is at or above `level` ("none" never fails), else undefined. */
export function reachFailure(results: ReachResult[], level: string): string | undefined {
  const min = SEVERITIES.indexOf(level);
  if (min < 0) return undefined;
  const sev = (s: string) => SEVERITIES.indexOf(s === "moderate" ? "medium" : s);
  const bad = results.filter((r) => isReachable(r) && sev(r.alert.severity) >= min);
  return bad.length ? `${bad.length} reachable Dependabot alert(s) at ${level} or above: ${bad.map((r) => r.alert.package).join(", ")}` : undefined;
}
