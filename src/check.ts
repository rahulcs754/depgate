import { isAllowed } from "./config.js";
import { diffLockfiles, parseLockfile } from "./lockfile.js";
import { mapLimit, type FetchPackument } from "./registry.js";
import { allSignals } from "./signals/index.js";
import type { Change, Config, Finding, Severity } from "./types.js";

export interface CheckResult {
  changes: Change[];
  findings: Finding[];
  failed: boolean;
}

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export async function runCheck(opts: {
  baseLock: string | null;
  headLock: string;
  config: Config;
  fetchPackument: FetchPackument;
  now?: Date;
}): Promise<CheckResult> {
  const now = opts.now ?? new Date();
  const base = opts.baseLock ? parseLockfile(opts.baseLock) : [];
  const changes = diffLockfiles(base, parseLockfile(opts.headLock)).filter(
    (c) => !isAllowed(c.name, c.version, opts.config.allow),
  );

  const perChange = await mapLimit(changes, 8, async (change) => {
    const packument = isRegistry(change.resolved) ? await opts.fetchPackument(change.name) : null;
    return allSignals
      .map((signal) => signal({ change, packument, config: opts.config, now }))
      .filter((f): f is Finding => f !== null);
  });

  const findings = perChange.flat().sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.name.localeCompare(b.name));
  const failOn = opts.config.failOn;
  const failed = failOn !== "none" && findings.some((f) => RANK[f.severity] >= RANK[failOn]);
  return { changes, findings, failed };
}

function isRegistry(resolved: string | undefined): boolean {
  return !resolved || resolved.startsWith("https://registry.npmjs.org/");
}
