import { readFileSync } from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { runCheck } from "./check.js";
import { loadConfig } from "./config.js";
import { createRegistryClient } from "./registry.js";
import { COMMENT_MARKER, renderReport } from "./report.js";
import type { Severity } from "./types.js";

async function run(): Promise<void> {
  const lockPath = core.getInput("lockfile") || "package-lock.json";
  const token = core.getInput("github-token", { required: true });
  const config = loadConfig(core.getInput("config") || ".depgate.json");
  const failOn = core.getInput("fail-on");
  if (failOn) config.failOn = failOn as Severity | "none";

  const pr = github.context.payload.pull_request;
  if (!pr) {
    core.info("Not a pull_request event, nothing to check.");
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const baseLock = await readFileAtRef(octokit, owner, repo, lockPath, pr.base.sha as string);
  const headLock = readFileSync(lockPath, "utf8");

  const result = await runCheck({ baseLock, headLock, config, fetchPackument: createRegistryClient() });
  const body = renderReport(result);
  await core.summary.addRaw(body).write();

  if (result.changes.length > 0 || (await findComment(octokit, owner, repo, pr.number)) !== undefined) {
    await upsertComment(octokit, owner, repo, pr.number, body);
  }

  core.setOutput("findings", result.findings.length);
  if (result.failed) core.setFailed(`DepGate flagged risky packages (fail-on: ${config.failOn})`);
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
