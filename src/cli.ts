#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fetchAlerts, toAlert } from "./alerts.js";
import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";
import { findLockfile } from "./lockfile.js";
import { createRegistryClient } from "./registry.js";
import { checkReach, dependencyGraph, reachFailure, readSources, renderReach } from "./reach.js";
import { renderReport } from "./report.js";
import { createTarballClient } from "./tarball.js";
import type { Severity } from "./types.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: "main" },
    head: { type: "string" },
    config: { type: "string", default: ".depgate.json" },
    strict: { type: "boolean", default: false },
    repo: { type: "string" },
    "alerts-file": { type: "string" },
    "fail-on": { type: "string", default: "none" },
  },
});

const USAGE = `Usage:
  depgate check [--base <git ref or lockfile>] [--head <lockfile>] [--config .depgate.json] [--strict]
  depgate reach [--repo owner/name | --alerts-file alerts.json] [--head <lockfile>] [--fail-on high]`;

const command = positionals[0] ?? "check";
if (command !== "check" && command !== "reach") {
  console.error(USAGE);
  process.exit(2);
}

if (command === "reach") {
  // ReachCheck: which open Dependabot alerts does this code actually use?
  const lockPath = values.head ?? findLockfile();
  let alerts;
  if (values["alerts-file"]) {
    alerts = (JSON.parse(readFileSync(values["alerts-file"], "utf8")) as unknown[]).map((a) => toAlert(a));
  } else {
    const [owner, repo] = (values.repo ?? process.env.GITHUB_REPOSITORY ?? "").split("/");
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!owner || !repo || !token) {
      console.error("depgate reach needs --repo owner/name and GITHUB_TOKEN (or --alerts-file).");
      process.exit(2);
    }
    alerts = await fetchAlerts({ token, owner, repo });
  }
  const graph = dependencyGraph(readFileSync(lockPath, "utf8"), existsSync("package.json") ? readFileSync("package.json", "utf8") : undefined);
  const results = checkReach(alerts, readSources("."), graph);
  console.log(renderReach(results));
  const fail = reachFailure(results, values["fail-on"]!);
  if (fail) console.error(fail);
  process.exit(fail ? 1 : 0);
}

const headPath = values.head ?? findLockfile();
const config = loadConfig(values.config);
if (values.strict) config.failOn = "medium" satisfies Severity;

const result = await runCheck({
  baseLock: readBase(values.base!, headPath),
  headLock: readFileSync(headPath, "utf8"),
  config,
  fetchPackument: createRegistryClient(),
  fetchTarball: createTarballClient(),
});
console.log(renderReport(result));
process.exit(result.failed ? 1 : 0);

/** `--base` is a lockfile path if it exists, else a git ref to read the lockfile from. */
function readBase(base: string, lockPath: string): string | null {
  if (existsSync(base)) return readFileSync(base, "utf8");
  try {
    return execFileSync("git", ["show", `${base}:${lockPath}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null; // lockfile did not exist at that ref
  }
}
