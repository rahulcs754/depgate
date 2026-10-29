export type Severity = "high" | "medium" | "low";

export interface LockEntry {
  name: string;
  version: string;
  resolved?: string;
}

export interface Change {
  name: string;
  version: string;
  /** Version of the same package in the base lockfile, if it was there. */
  previous?: string;
  resolved?: string;
}

export interface Finding {
  name: string;
  version: string;
  severity: Severity;
  signal: string;
  reason: string;
}

/** The subset of the npm registry "packument" that DepGate reads. */
export interface Packument {
  name: string;
  time?: Record<string, string>;
  versions: Record<string, PackumentVersion>;
}

export interface PackumentVersion {
  version: string;
  deprecated?: string;
  scripts?: Record<string, string>;
  maintainers?: Array<{ name: string; email?: string }>;
  _npmUser?: { name: string; email?: string };
}

export interface Config {
  failOn: Severity | "none";
  minAgeHours: number;
  newPackageDays: number;
  /** Entries like "left-pad" or "left-pad@1.3.0" that are never flagged. */
  allow: string[];
}

export const defaultConfig: Config = {
  failOn: "high",
  minAgeHours: 72,
  newPackageDays: 30,
  allow: [],
};
