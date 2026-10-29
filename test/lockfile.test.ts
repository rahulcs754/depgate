import { describe, expect, it } from "vitest";
import { diffLockfiles, parseLockfile } from "../src/lockfile.js";
import { fixture } from "./helpers.js";

describe("parseLockfile", () => {
  it("reads nested and scoped packages, skips root, workspaces and links", () => {
    const entries = parseLockfile(fixture("head-lock.json")).map((e) => `${e.name}@${e.version}`);
    expect(entries).toContain("@acme/utils@2.0.1");
    expect(entries).toContain("left-pad@1.1.0");
    expect(entries).not.toContain("demo@undefined");
    expect(entries.some((e) => e.startsWith("local@"))).toBe(false);
  });

  it("rejects v1 lockfiles", () => {
    expect(() => parseLockfile(JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toThrow(/v2 or v3/);
  });
});

describe("diffLockfiles", () => {
  it("lists only new name@version pairs, with the previous version", () => {
    const diff = diffLockfiles(parseLockfile(fixture("base-lock.json")), parseLockfile(fixture("head-lock.json")));
    expect(diff.map((c) => `${c.name}@${c.version}<-${c.previous ?? ""}`)).toEqual([
      "@acme/utils@2.0.1<-2.0.0",
      "git-thing@0.1.0<-",
      "left-pad@1.1.0<-1.3.0",
      "reactt@1.0.0<-",
    ]);
  });
});
