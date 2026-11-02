import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchAlerts, toAlert } from "../src/alerts.js";
import { checkReach, dependencyGraph, directParents, packageOf, reachFailure, readSources, renderReach } from "../src/reach.js";
import { fixture } from "./helpers.js";

const ROOT = fileURLToPath(new URL("./fixtures/reach", import.meta.url));
const alerts = (JSON.parse(readFileSync(`${ROOT}/alerts.json`, "utf8")) as unknown[]).map((a) => toAlert(a));
const graph = dependencyGraph(readFileSync(`${ROOT}/package-lock.json`, "utf8"));
const results = checkReach(alerts, readSources(ROOT), graph);
const byPkg = Object.fromEntries(results.map((r) => [r.alert.package, r]));

describe("ReachCheck", () => {
  it("reads package names from import specifiers", () => {
    expect(packageOf("lodash/template")).toBe("lodash");
    expect(packageOf("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageOf("./local")).toBeUndefined();
    expect(packageOf("node:fs")).toBeUndefined();
  });

  it("follows the lockfile graph up to direct dependencies", () => {
    expect(directParents(graph, "semver")).toEqual(["next"]);
    expect(directParents(graph, "minimist")).toEqual(["mocha"]);
    expect(graph.direct.get("mocha")).toEqual({ dev: true });
  });

  it("ranks each alert by how much the code uses it", () => {
    expect(byPkg.lodash).toMatchObject({ reach: "called", side: "client" });
    expect(byPkg.lodash!.evidence).toContain("src/app/cart/page.tsx:6");
    expect(byPkg.axios).toMatchObject({ reach: "imported", side: "server" });
    expect(byPkg.semver).toMatchObject({ reach: "via-dependency" });
    expect(byPkg.semver!.evidence).toContain("`next`");
    expect(byPkg.debug).toMatchObject({ reach: "not-imported" }); // express is only used in tests
    expect(byPkg.minimist).toMatchObject({ reach: "dev-only" });
    expect(results.map((r) => r.alert.package)).toEqual(["lodash", "axios", "semver", "debug", "minimist"]);
  });

  it("says when the vulnerable function is imported but not called", () => {
    const safe = checkReach([{ ...alerts[0]!, functions: ["merge"] }], readSources(ROOT), graph);
    expect(safe[0]!.reach).toBe("imported-safe");
  });

  it("handles pnpm and yarn graphs", () => {
    const yarn = dependencyGraph(fixture("lockfiles/yarn-v1.lock"), JSON.stringify({ dependencies: { "@acme/utils": "^2" } }));
    expect(directParents(yarn, "left-pad")).toEqual(["@acme/utils"]);
    const pnpm = dependencyGraph(fixture("lockfiles/pnpm-v9.yaml"));
    expect(pnpm.direct.has("react")).toBe(true);
  });

  it("renders a report and fails only on reachable alerts", () => {
    const md = renderReach(results);
    expect(md).toContain("**3** of 5 open alerts reach your code");
    expect(md).toContain("| 🔴 Reachable (client) | [#1](https://github.com/acme/shop/security/dependabot/1)");
    expect(md).toContain("Upgrade to 4.17.21");
    expect(reachFailure(results, "high")).toMatch(/2 reachable .*lodash, axios/);
    expect(reachFailure(results, "critical")).toBeUndefined(); // minimist is critical but dev-only
    expect(reachFailure(results, "none")).toBeUndefined();
    expect(renderReach([])).toContain("No open npm Dependabot alerts");
  });

  it("fetches alerts and advisory functions from the GitHub API", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(new URL(url).pathname);
      if (url.includes("/dependabot/alerts")) {
        const { vulnerable_functions: _, ...raw } = JSON.parse(readFileSync(`${ROOT}/alerts.json`, "utf8"))[0];
        return new Response(JSON.stringify([raw]));
      }
      return new Response(JSON.stringify({ vulnerabilities: [{ package: { name: "lodash" }, vulnerable_functions: ["lodash.template"] }] }));
    }) as typeof fetch;
    const got = await fetchAlerts({ token: "t", owner: "acme", repo: "shop", fetchImpl: fakeFetch });
    expect(got[0]).toMatchObject({ package: "lodash", functions: ["lodash.template"], patched: "4.17.21" });
    expect(calls).toEqual(["/repos/acme/shop/dependabot/alerts", "/advisories/GHSA-35jh-r3h4-6jhm"]);
  });

  it("explains a missing permission", async () => {
    const denied = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchAlerts({ token: "t", owner: "a", repo: "b", fetchImpl: denied })).rejects.toThrow(/security-events: read/);
  });
});
