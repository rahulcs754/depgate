import type { Change, Config, Finding, Packument } from "../types.js";
import type { PackageFiles } from "../tarball.js";
import { codeSignals } from "./code.js";
import { POPULAR } from "./popular.js";

export interface SignalContext {
  change: Change;
  packument: Packument | null;
  config: Config;
  now: Date;
  /** Package files, when the code scan downloaded them. */
  files?: { current: PackageFiles; previous?: PackageFiles };
}

export type Signal = (ctx: SignalContext) => Finding | null;

const HOUR = 3_600_000;
const INSTALL_HOOKS = ["preinstall", "install", "postinstall"] as const;
/** Commands in an install script that download or run arbitrary code. */
const DANGEROUS = /\b(curl|wget|child_process|eval|powershell|bash|sh)\b|node -e/;

function finding(ctx: SignalContext, f: Omit<Finding, "name" | "version">): Finding {
  return { name: ctx.change.name, version: ctx.change.version, ...f };
}

export const notOnRegistry: Signal = (ctx) =>
  ctx.packument || !isRegistryResolved(ctx.change.resolved)
    ? null
    : finding(ctx, { severity: "high", signal: "not-found", reason: "Not found on the npm registry" });

export const freshVersion: Signal = (ctx) => {
  const published = ctx.packument?.time?.[ctx.change.version];
  if (!published) return null;
  const ageHours = (ctx.now.getTime() - Date.parse(published)) / HOUR;
  if (ageHours >= ctx.config.minAgeHours) return null;
  return finding(ctx, {
    severity: "high",
    signal: "fresh-version",
    reason: `Version published ${Math.max(0, Math.round(ageHours))}h ago (under ${ctx.config.minAgeHours}h)`,
  });
};

export const newPackage: Signal = (ctx) => {
  const created = ctx.packument?.time?.created;
  if (!created) return null;
  const ageDays = (ctx.now.getTime() - Date.parse(created)) / (24 * HOUR);
  if (ageDays >= ctx.config.newPackageDays) return null;
  return finding(ctx, {
    severity: "high",
    signal: "new-package",
    reason: `Package first published ${Math.floor(ageDays)} days ago`,
  });
};

export const installScripts: Signal = (ctx) => {
  const current = ctx.packument?.versions[ctx.change.version]?.scripts ?? {};
  const prev = ctx.change.previous ? ctx.packument?.versions[ctx.change.previous]?.scripts ?? {} : {};
  const added = INSTALL_HOOKS.filter((h) => current[h] && current[h] !== prev[h]);
  if (added.length === 0) return null;
  const script = current[added[0]!]!;
  const danger = DANGEROUS.exec(script)?.[0];
  const what = ctx.change.previous ? `New or changed ${added.join(", ")} script` : `Has ${added.join(", ")} script`;
  return finding(ctx, {
    severity: ctx.change.previous || danger ? "high" : "medium",
    signal: "install-script",
    reason: `${what}${danger ? ` that runs \`${danger}\`` : ""}: \`${truncate(script, 60)}\``,
  });
};

export const maintainersChanged: Signal = (ctx) => {
  const { previous, version } = ctx.change;
  if (!previous || !ctx.packument) return null;
  const names = (v: string) => new Set((ctx.packument!.versions[v]?.maintainers ?? []).map((m) => m.name));
  const before = names(previous);
  const after = names(version);
  if (before.size === 0 || after.size === 0) return null;
  const added = [...after].filter((n) => !before.has(n));
  const publisher = ctx.packument.versions[version]?._npmUser?.name;
  const newPublisher = publisher && !before.has(publisher);
  if (added.length === 0 && !newPublisher) return null;
  const parts = [];
  if (added.length) parts.push(`new maintainer(s): ${added.join(", ")}`);
  if (newPublisher) parts.push(`published by ${publisher}, not a previous maintainer`);
  return finding(ctx, { severity: "medium", signal: "maintainer-change", reason: capitalize(parts.join("; ")) });
};

export const typosquat: Signal = (ctx) => {
  const { name } = ctx.change;
  if (name.length < 4 || POPULAR.has(name)) return null;
  for (const target of POPULAR) {
    if (Math.abs(target.length - name.length) <= 1 && editDistance(name, target) === 1) {
      return finding(ctx, { severity: "high", signal: "typosquat", reason: `Name is one letter away from \`${target}\`` });
    }
  }
  return null;
};

export const nonRegistrySource: Signal = (ctx) =>
  isRegistryResolved(ctx.change.resolved)
    ? null
    : finding(ctx, {
        severity: "medium",
        signal: "non-registry-source",
        reason: `Installed from ${truncate(ctx.change.resolved!, 60)}, not registry.npmjs.org`,
      });

export const deprecated: Signal = (ctx) => {
  const msg = ctx.packument?.versions[ctx.change.version]?.deprecated;
  return msg ? finding(ctx, { severity: "low", signal: "deprecated", reason: `Deprecated: ${truncate(msg, 80)}` }) : null;
};

export const allSignals: Signal[] = [
  notOnRegistry,
  typosquat,
  freshVersion,
  newPackage,
  installScripts,
  maintainersChanged,
  nonRegistrySource,
  deprecated,
  ...codeSignals,
];

function isRegistryResolved(resolved: string | undefined): boolean {
  return !resolved || resolved.startsWith("https://registry.npmjs.org/");
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
