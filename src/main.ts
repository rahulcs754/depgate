import { existsSync, readFileSync } from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { fetchAlerts } from "./alerts.js";
import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";
import { findLockfile } from "./lockfile.js";
import { createRegistryClient } from "./registry.js";
import { COMMENT_MARKER, renderReport } from "./report.js";
import { checkReach, dependencyGraph, isReachable, reachFailure, readSources, renderReach, type ReachResult } from "./reach.js";
import { createTarballClient } from "./tarball.js";
import type { Severity } from "./types.js";

async function run(): Promise<void> {
  const lockPath = core.getInput("lockfile") || findLockfile();
  const token = core.getInput("github-token", { required: true });
  const config = loadConfig(core.getInput("config") || ".depgate.json");
  const failOn = core.getInput("fail-on");
  if (failOn) config.failOn = failOn as Severity | "none";

  const { owner, repo } = github.context.repo;
  const reach = core.getBooleanInput("alerts") ? await reachCheck(core.getInput("alerts-token") || token, owner, repo, lockPath) : undefined;
  const failReach = reach ? reachFailure(reach.results, core.getInput("fail-on-reachable") || "none") : undefined;
  if (reach) core.setOutput("reachable-alerts", reach.results.filter(isReachable).length);

  const pr = github.context.payload.pull_request;
  if (!pr) {
    // push / schedule / manual run: only the alert report makes sense.
    if (reach) await core.summary.addRaw(reach.md).write();
    else core.info("Not a pull_request event and alerts are off, nothing to check.");
    if (failReach) core.setFailed(failReach);
    return;
  }

  const octokit = github.getOctokit(token);
  const baseLock = await readFileAtRef(octokit, owner, repo, lockPath, pr.base.sha as string);
  const headLock = readFileSync(lockPath, "utf8");

  const result = await runCheck({
    baseLock,
    headLock,
    config,
    fetchPackument: createRegistryClient(),
    fetchTarball: createTarballClient(),
  });
  const body = reach ? `${renderReport(result)}\n\n${reach.md}` : renderReport(result);
  await core.summary.addRaw(body).write();

  const reachable = reach?.results.some(isReachable) ?? false;
  if (result.changes.length > 0 || reachable || (await findComment(octokit, owner, repo, pr.number)) !== undefined) {
    await upsertComment(octokit, owner, repo, pr.number, body);
  }

  core.setOutput("findings", result.findings.length);
  if (result.failed) core.setFailed(`DepGate flagged risky packages (fail-on: ${config.failOn})`);
  else if (failReach) core.setFailed(failReach);
}

/** ReachCheck over open Dependabot alerts. A missing permission becomes a note, not a failure. */
async function reachCheck(token: string, owner: string, repo: string, lockPath: string): Promise<{ results: ReachResult[]; md: string }> {
  try {
    const alerts = await fetchAlerts({ token, owner, repo, apiUrl: process.env.GITHUB_API_URL });
    const graph = dependencyGraph(readFileSync(lockPath, "utf8"), existsSync("package.json") ? readFileSync("package.json", "utf8") : undefined);
    const results = checkReach(alerts, readSources("."), graph);
    return { results, md: renderReach(results) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.warning(`ReachCheck skipped: ${msg}`);
    return { results: [], md: renderReach([], `Skipped: ${msg}`) };
  }
}

type Octokit = ReturnType<typeof github.getOctokit>;

async function readFileAtRef(octokit: Octokit, owner: string, repo: string, path: string, ref: string) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref, mediaType: { format: "raw" } });
    return data as unknown as string;
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null; // lockfile is new in this PR
    throw err;
  }
}

async function findComment(octokit: Octokit, owner: string, repo: string, issue_number: number) {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number, per_page: 100 });
  return comments.find((c) => c.body?.includes(COMMENT_MARKER))?.id;
}

async function upsertComment(octokit: Octokit, owner: string, repo: string, issue_number: number, body: string) {
  const id = await findComment(octokit, owner, repo, issue_number);
  if (id) await octokit.rest.issues.updateComment({ owner, repo, comment_id: id, body });
  else await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
}

run().catch((err: unknown) => core.setFailed(err instanceof Error ? err.message : String(err)));
