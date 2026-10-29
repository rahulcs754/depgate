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

describe("other lockfile formats", () => {
  const list = (file: string) =>
    parseLockfile(fixture(`lockfiles/${file}`))
      .map((e) => `${e.name}@${e.version}${e.resolved ? ` ${e.resolved}` : ""}`)
      .sort();

  it("reads pnpm v6 keys, including peer suffixes, v5 style keys and git deps", () => {
    expect(list("pnpm-v6.yaml")).toEqual([
      "@acme/utils@2.0.1",
      "git-thing@0.1.0 https://codeload.github.com/someone/git-thing/tar.gz/abc123",
      "left-pad@1.3.0",
      "react@18.3.1",
    ]);
  });

  it("reads pnpm v9", () => {
    expect(list("pnpm-v9.yaml")).toEqual(["@acme/utils@2.0.1", "react@18.3.1"]);
  });

  it("reads yarn v1 and treats registry.yarnpkg.com as the npm registry", () => {
    expect(list("yarn-v1.lock")).toEqual([
      "@acme/utils@2.0.1 https://registry.npmjs.org/@acme/utils/-/utils-2.0.1.tgz#deadbeef",
      "git-thing@0.1.0 git+https://github.com/someone/git-thing.git#abc123",
      "left-pad@1.3.0 https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
    ]);
  });

  it("reads yarn Berry and skips workspaces", () => {
    expect(list("yarn-berry.lock")).toEqual([
      "@acme/utils@2.0.1",
      "git-thing@0.1.0 https://github.com/someone/git-thing.git#commit=abc123",
      "left-pad@1.3.0",
    ]);
  });

  it("rejects unknown files", () => {
    expect(() => parseLockfile("hello: world")).toThrow(/Unsupported lockfile/);
  });
});
