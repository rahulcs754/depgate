import { isAllowed } from "./config.js";
import { diffLockfiles, parseLockfile } from "./lockfile.js";
import { mapLimit, type FetchPackument } from "./registry.js";
import { allSignals, type SignalContext } from "./signals/index.js";
import type { FetchTarball } from "./tarball.js";
import type { Change, Config, Finding, Packument, Severity } from "./types.js";

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
  /** Omit to skip the code scan. */
  fetchTarball?: FetchTarball;
  now?: Date;
}): Promise<CheckResult> {
  const now = opts.now ?? new Date();
  const base = opts.baseLock ? parseLockfile(opts.baseLock) : [];
  const changes = diffLockfiles(base, parseLockfile(opts.headLock)).filter(
    (c) => !isAllowed(c.name, c.version, opts.config.allow),
  );

  const packuments = await mapLimit(changes, 8, (change) =>
    isRegistry(change.resolved) ? opts.fetchPackument(change.name) : Promise.resolve(null),
  );

  const toScan = new Set(
    opts.fetchTarball && opts.config.scanCode
      ? codeScanCandidates(changes, packuments).slice(0, opts.config.maxCodeScans)
      : [],
  );
  const perChange = await mapLimit(changes, 8, async (change, i) => {
    const packument = packuments[i] ?? null;
    const ctx: SignalContext = { change, packument, config: opts.config, now };
    if (packument && toScan.has(i)) ctx.files = await downloadFiles(opts.fetchTarball!, packument, change);
    return allSignals.map((signal) => signal(ctx)).filter((f): f is Finding => f !== null);
  });

  const findings = perChange.flat().sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.name.localeCompare(b.name));
  const failOn = opts.config.failOn;
  const failed = failOn !== "none" && findings.some((f) => RANK[f.severity] >= RANK[failOn]);
  return { changes, findings, failed };
}

/**
 * Indexes of changes whose files are worth downloading, most useful first:
 * updates that add an install hook, then other updates, then new packages with install hooks.
 * Plain new packages are skipped: there is no previous version to compare with.
 */
function codeScanCandidates(changes: Change[], packuments: Array<Packument | null>): number[] {
  const hasHook = (p: Packument | null, v: string | undefined) =>
    !!v && ["preinstall", "install", "postinstall"].some((h) => p?.versions[v]?.scripts?.[h]);
  const scored = changes.flatMap((c, i) => {
    const p = packuments[i] ?? null;
    if (!p?.versions[c.version]?.dist?.tarball) return [];
    const now = hasHook(p, c.version);
    if (c.previous) return [{ i, rank: now && !hasHook(p, c.previous) ? 0 : 1 }];
    return now ? [{ i, rank: 2 }] : [];
  });
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).map((s) => s.i);
}

async function downloadFiles(fetchTarball: FetchTarball, packument: Packument, change: Change) {
  const url = (v: string | undefined) => (v ? packument.versions[v]?.dist?.tarball : undefined);
  const [current, previous] = await Promise.all([
    fetchTarball(url(change.version)!),
    url(change.previous) ? fetchTarball(url(change.previous)!) : Promise.resolve(null),
  ]);
  return current ? { current, previous: previous ?? undefined } : undefined;
}

function isRegistry(resolved: string | undefined): boolean {
  return !resolved || resolved.startsWith("https://registry.npmjs.org/");
}
