#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";
import { findLockfile } from "./lockfile.js";
import { createRegistryClient } from "./registry.js";
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
  },
});

if (positionals.length > 0 && positionals[0] !== "check") {
  console.error("Usage: depgate check [--base <git ref or lockfile>] [--head <lockfile>] [--config .depgate.json] [--strict]");
  process.exit(2);
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
