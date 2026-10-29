#!/usr/bin/env node
import { createRequire } from 'module'; const require = createRequire(import.meta.url);

// src/cli.ts
import { execFileSync } from "child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { parseArgs } from "util";

// src/config.ts
import { existsSync, readFileSync } from "fs";

// src/types.ts
var defaultConfig = {
  failOn: "high",
  minAgeHours: 72,
  newPackageDays: 30,
  allow: [],
  scanCode: true,
  maxCodeScans: 40
};

// src/config.ts
function loadConfig(path = ".depgate.json") {
  if (!existsSync(path)) return defaultConfig;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { ...defaultConfig, ...raw };
}
function isAllowed(name, version, allow) {
  return allow.some((entry) => {
    const at = entry.lastIndexOf("@");
    if (at <= 0) return entry === name;
    return entry.slice(0, at) === name && entry.slice(at + 1) === version;
  });
}

// src/lockfile.ts
function parseLockfile(text) {
  const raw = JSON.parse(text);
  if (!raw.packages) {
    throw new Error('Unsupported lockfile: no "packages" field (npm lockfile v2 or v3 needed)');
  }
  const seen = /* @__PURE__ */ new Map();
  for (const [path, info] of Object.entries(raw.packages)) {
    if (path === "" || info.link || !info.version) continue;
    const idx = path.lastIndexOf("node_modules/");
    if (idx === -1) continue;
    const name = info.name ?? path.slice(idx + "node_modules/".length);
    const key = `${name}@${info.version}`;
    if (!seen.has(key)) seen.set(key, { name, version: info.version, resolved: info.resolved });
  }
  return [...seen.values()];
}
function diffLockfiles(base, head) {
  const baseKeys = new Set(base.map((e) => `${e.name}@${e.version}`));
  const baseVersions = /* @__PURE__ */ new Map();
  for (const e of base) baseVersions.set(e.name, e.version);
  return head.filter((e) => !baseKeys.has(`${e.name}@${e.version}`)).map((e) => ({ name: e.name, version: e.version, previous: baseVersions.get(e.name), resolved: e.resolved })).sort((a, b) => a.name.localeCompare(b.name));
}

// src/registry.ts
var REGISTRY = "https://registry.npmjs.org";
function createRegistryClient(fetchImpl = fetch) {
  const cache = /* @__PURE__ */ new Map();
  return (name) => {
    let hit = cache.get(name);
    if (!hit) {
      hit = (async () => {
        const res = await fetchImpl(`${REGISTRY}/${name.replace("/", "%2f")}`, {
          headers: { accept: "application/json" }
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`npm registry ${res.status} for ${name}`);
        return await res.json();
      })();
      cache.set(name, hit);
    }
    return hit;
  };
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// src/signals/code.ts
var INSTALL_HOOKS = ["preinstall", "install", "postinstall"];
var TOKEN_NAMES = /\b(NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AZURE_CLIENT_SECRET|GOOGLE_APPLICATION_CREDENTIALS)\b|\.npmrc\b/;
var NETWORK = /\b(https?\.request|https?\.get|fetch\s*\(|XMLHttpRequest|axios|net\.connect|dns\.resolve)/;
var PROCESS = /\bchild_process\b|\b(execSync|spawnSync|execFile)\s*\(/;
var EVAL_DECODED = /\b(eval|Function)\s*\(\s*(atob|Buffer\.from|decodeURIComponent|unescape|String\.fromCharCode)\s*\(/;
var OBFUSCATOR_NAME = /\b_0x[0-9a-f]{4,6}\b/g;
var LONG_BASE64 = /["'`][A-Za-z0-9+/=]{5000,}["'`]/;
function changedFiles(ctx) {
  const files = ctx.files;
  if (!files) return [];
  return [...files.current].filter(([path, text]) => /\.(c|m)?js$/.test(path) && files.previous?.get(path) !== text).map(([path, text]) => [path, text, files.previous?.get(path) ?? ""]);
}
function finding(ctx, f) {
  return { name: ctx.change.name, version: ctx.change.version, ...f };
}
function snippet(text, index) {
  const s = text.slice(index, index + 80).replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 59)}\u2026` : s;
}
var credentialAccess = (ctx) => {
  for (const [path, text, previous] of changedFiles(ctx)) {
    const token = TOKEN_NAMES.exec(text);
    if (token && NETWORK.test(text) && !TOKEN_NAMES.test(previous)) {
      return finding(ctx, {
        severity: "high",
        signal: "credential-access",
        reason: `\`${path}\` reads \`${token[0]}\` and makes network calls`
      });
    }
  }
  return null;
};
var evalDecoded = (ctx) => {
  for (const [path, text, previous] of changedFiles(ctx)) {
    const m = EVAL_DECODED.exec(text);
    if (m && !EVAL_DECODED.test(previous)) {
      return finding(ctx, {
        severity: "high",
        signal: "eval-decoded",
        reason: `\`${path}\` runs decoded code: \`${snippet(text, m.index)}\``
      });
    }
  }
  return null;
};
var obfuscated = (ctx) => {
  for (const [path, text, previous] of changedFiles(ctx)) {
    if (previous && (previous.match(OBFUSCATOR_NAME)?.length ?? 0) > 0) continue;
    const names = new Set(text.match(OBFUSCATOR_NAME) ?? []);
    if (names.size >= 10) {
      return finding(ctx, {
        severity: "medium",
        signal: "obfuscated-code",
        reason: `\`${path}\` looks obfuscated (${names.size} \`_0x\u2026\` names)`
      });
    }
    if (!ctx.files?.previous?.has(path) && LONG_BASE64.test(text)) {
      return finding(ctx, {
        severity: "medium",
        signal: "obfuscated-code",
        reason: `New file \`${path}\` has a large encoded string`
      });
    }
  }
  return null;
};
function installScriptFiles(scripts, only) {
  const out = [];
  for (const hook of only ?? INSTALL_HOOKS) {
    for (const part of (scripts?.[hook] ?? "").split(/&&|\|\||;/)) {
      const [cmd, ...args] = part.trim().split(/\s+/);
      const file = cmd === "node" ? args.find((a) => !a.startsWith("-")) : void 0;
      if (!file) continue;
      const path = file.replace(/^["']|["']$/g, "").replace(/^\.\//, "");
      out.push(/\.(c|m)?js$/.test(path) ? path : `${path}.js`);
    }
  }
  return out;
}
function capabilities(text) {
  return [
    PROCESS.test(text) && "starts processes",
    NETWORK.test(text) && "makes network calls",
    TOKEN_NAMES.test(text) && "reads tokens"
  ].filter((c) => typeof c === "string");
}
var installScriptCode = (ctx) => {
  const versions = ctx.packument?.versions;
  const scripts = versions?.[ctx.change.version]?.scripts;
  const prevScripts = ctx.change.previous ? versions?.[ctx.change.previous]?.scripts : void 0;
  for (const hook of INSTALL_HOOKS) {
    const hookIsNew = scripts?.[hook] !== prevScripts?.[hook];
    for (const path of installScriptFiles(scripts, [hook])) {
      const text = ctx.files?.current.get(path);
      if (!text) continue;
      const before = hookIsNew ? [] : capabilities(ctx.files?.previous?.get(path) ?? "");
      const what = capabilities(text).filter((c) => !before.includes(c));
      if (what.length === 0) continue;
      return finding(ctx, {
        severity: ctx.change.previous ? "high" : "medium",
        signal: "install-script-code",
        reason: `Install script \`${path}\` ${what.join(", ")}${hookIsNew ? "" : " (new in this version)"}`
      });
    }
  }
  return null;
};
var codeSignals = [credentialAccess, evalDecoded, installScriptCode, obfuscated];

// src/signals/popular.ts
var POPULAR = /* @__PURE__ */ new Set([
  "react",
  "react-dom",
  "next",
  "vue",
  "svelte",
  "angular",
  "preact",
  "solid-js",
  "express",
  "fastify",
  "koa",
  "lodash",
  "underscore",
  "axios",
  "node-fetch",
  "chalk",
  "commander",
  "yargs",
  "debug",
  "dotenv",
  "uuid",
  "moment",
  "dayjs",
  "date-fns",
  "classnames",
  "clsx",
  "prop-types",
  "typescript",
  "eslint",
  "prettier",
  "webpack",
  "vite",
  "rollup",
  "esbuild",
  "babel-loader",
  "jest",
  "vitest",
  "mocha",
  "chai",
  "sinon",
  "tslib",
  "rxjs",
  "zod",
  "yup",
  "joi",
  "ajv",
  "semver",
  "glob",
  "minimatch",
  "rimraf",
  "mkdirp",
  "fs-extra",
  "chokidar",
  "cross-env",
  "nodemon",
  "concurrently",
  "husky",
  "lint-staged",
  "tailwindcss",
  "postcss",
  "autoprefixer",
  "sass",
  "less",
  "styled-components",
  "emotion",
  "redux",
  "react-redux",
  "zustand",
  "mobx",
  "jotai",
  "recoil",
  "immer",
  "react-router",
  "react-router-dom",
  "react-query",
  "swr",
  "graphql",
  "apollo-client",
  "mongoose",
  "sequelize",
  "prisma",
  "typeorm",
  "knex",
  "pg",
  "mysql",
  "mysql2",
  "redis",
  "ioredis",
  "socket.io",
  "ws",
  "jsonwebtoken",
  "bcrypt",
  "bcryptjs",
  "passport",
  "cors",
  "helmet",
  "body-parser",
  "cookie-parser",
  "multer",
  "morgan",
  "winston",
  "pino",
  "bluebird",
  "async",
  "colors",
  "inquirer",
  "ora",
  "execa",
  "cheerio",
  "puppeteer",
  "playwright",
  "sharp",
  "jquery",
  "bootstrap",
  "core-js",
  "regenerator-runtime",
  "whatwg-fetch",
  "qs",
  "ms",
  "nanoid",
  "cross-spawn",
  "which",
  "kleur",
  "picocolors",
  "ansi-styles",
  "supports-color",
  "strip-ansi",
  "string-width",
  "wrap-ansi",
  "escape-string-regexp",
  "is-number",
  "isarray",
  "inherits",
  "safe-buffer",
  "readable-stream",
  "through2",
  "event-stream",
  "minimist",
  "browserslist",
  "caniuse-lite",
  "electron",
  "nx",
  "turbo",
  "lerna",
  "storybook",
  "framer-motion",
  "three",
  "d3",
  "chart.js",
  "recharts",
  "socket.io-client",
  "form-data",
  "formik",
  "react-hook-form",
  "i18next",
  "react-i18next",
  "marked",
  "highlight.js",
  "prismjs",
  "validator",
  "xml2js",
  "yaml",
  "js-yaml",
  "handlebars",
  "ejs",
  "pug",
  "mustache",
  "nock",
  "supertest",
  "cypress",
  "ts-node",
  "tsx",
  "nodemailer",
  "stripe",
  "firebase",
  "aws-sdk",
  "openai",
  "dotenv-expand",
  "node-gyp",
  "nan",
  "bindings",
  "web-vitals"
]);

// src/signals/index.ts
var HOUR = 36e5;
var INSTALL_HOOKS2 = ["preinstall", "install", "postinstall"];
var DANGEROUS = /\b(curl|wget|child_process|eval|powershell|bash|sh)\b|node -e/;
function finding2(ctx, f) {
  return { name: ctx.change.name, version: ctx.change.version, ...f };
}
var notOnRegistry = (ctx) => ctx.packument || !isRegistryResolved(ctx.change.resolved) ? null : finding2(ctx, { severity: "high", signal: "not-found", reason: "Not found on the npm registry" });
var freshVersion = (ctx) => {
  const published = ctx.packument?.time?.[ctx.change.version];
  if (!published) return null;
  const ageHours = (ctx.now.getTime() - Date.parse(published)) / HOUR;
  if (ageHours >= ctx.config.minAgeHours) return null;
  return finding2(ctx, {
    severity: "high",
    signal: "fresh-version",
    reason: `Version published ${Math.max(0, Math.round(ageHours))}h ago (under ${ctx.config.minAgeHours}h)`
  });
};
var newPackage = (ctx) => {
  const created = ctx.packument?.time?.created;
  if (!created) return null;
  const ageDays = (ctx.now.getTime() - Date.parse(created)) / (24 * HOUR);
  if (ageDays >= ctx.config.newPackageDays) return null;
  return finding2(ctx, {
    severity: "high",
    signal: "new-package",
    reason: `Package first published ${Math.floor(ageDays)} days ago`
  });
};
var installScripts = (ctx) => {
  const current = ctx.packument?.versions[ctx.change.version]?.scripts ?? {};
  const prev = ctx.change.previous ? ctx.packument?.versions[ctx.change.previous]?.scripts ?? {} : {};
  const added = INSTALL_HOOKS2.filter((h) => current[h] && current[h] !== prev[h]);
  if (added.length === 0) return null;
  const script = current[added[0]];
  const danger = DANGEROUS.exec(script)?.[0];
  const what = ctx.change.previous ? `New or changed ${added.join(", ")} script` : `Has ${added.join(", ")} script`;
  return finding2(ctx, {
    severity: ctx.change.previous || danger ? "high" : "medium",
    signal: "install-script",
    reason: `${what}${danger ? ` that runs \`${danger}\`` : ""}: \`${truncate(script, 60)}\``
  });
};
var maintainersChanged = (ctx) => {
  const { previous, version } = ctx.change;
  if (!previous || !ctx.packument) return null;
  const names = (v) => new Set((ctx.packument.versions[v]?.maintainers ?? []).map((m) => m.name));
  const before = names(previous);
  const after = names(version);
  if (before.size === 0 || after.size === 0) return null;
  const added = [...after].filter((n) => !before.has(n));
  const publisher = ctx.packument.versions[version]?._npmUser?.name;
  const newPublisher = publisher && !before.has(publisher);
  if (added.length === 0 && !newPublisher) return null;
  const parts = [];
  if (added.length) parts.push(`new maintainer(s): ${added.join(", ")}`);
  if (newPublisher) parts.push(`published by ${publisher}, not a previous maintainer`);
  return finding2(ctx, { severity: "medium", signal: "maintainer-change", reason: capitalize(parts.join("; ")) });
};
var typosquat = (ctx) => {
  const { name } = ctx.change;
  if (name.length < 4 || POPULAR.has(name)) return null;
  for (const target of POPULAR) {
    if (Math.abs(target.length - name.length) <= 1 && editDistance(name, target) === 1) {
      return finding2(ctx, { severity: "high", signal: "typosquat", reason: `Name is one letter away from \`${target}\`` });
    }
  }
  return null;
};
var nonRegistrySource = (ctx) => isRegistryResolved(ctx.change.resolved) ? null : finding2(ctx, {
  severity: "medium",
  signal: "non-registry-source",
  reason: `Installed from ${truncate(ctx.change.resolved, 60)}, not registry.npmjs.org`
});
var deprecated = (ctx) => {
  const msg = ctx.packument?.versions[ctx.change.version]?.deprecated;
  return msg ? finding2(ctx, { severity: "low", signal: "deprecated", reason: `Deprecated: ${truncate(msg, 80)}` }) : null;
};
var allSignals = [
  notOnRegistry,
  typosquat,
  freshVersion,
  newPackage,
  installScripts,
  maintainersChanged,
  nonRegistrySource,
  deprecated,
  ...codeSignals
];
function isRegistryResolved(resolved) {
  return !resolved || resolved.startsWith("https://registry.npmjs.org/");
}
function editDistance(a, b) {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
}
function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// src/check.ts
var RANK = { high: 3, medium: 2, low: 1 };
async function runCheck(opts) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const base = opts.baseLock ? parseLockfile(opts.baseLock) : [];
  const changes = diffLockfiles(base, parseLockfile(opts.headLock)).filter(
    (c) => !isAllowed(c.name, c.version, opts.config.allow)
  );
  const packuments = await mapLimit(
    changes,
    8,
    (change) => isRegistry(change.resolved) ? opts.fetchPackument(change.name) : Promise.resolve(null)
  );
  const toScan = new Set(
    opts.fetchTarball && opts.config.scanCode ? codeScanCandidates(changes, packuments).slice(0, opts.config.maxCodeScans) : []
  );
  const perChange = await mapLimit(changes, 8, async (change, i) => {
    const packument = packuments[i] ?? null;
    const ctx = { change, packument, config: opts.config, now };
    if (packument && toScan.has(i)) ctx.files = await downloadFiles(opts.fetchTarball, packument, change);
    return allSignals.map((signal) => signal(ctx)).filter((f) => f !== null);
  });
  const findings = perChange.flat().sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.name.localeCompare(b.name));
  const failOn = opts.config.failOn;
  const failed = failOn !== "none" && findings.some((f) => RANK[f.severity] >= RANK[failOn]);
  return { changes, findings, failed };
}
function codeScanCandidates(changes, packuments) {
  const hasHook = (p, v) => !!v && ["preinstall", "install", "postinstall"].some((h) => p?.versions[v]?.scripts?.[h]);
  const scored = changes.flatMap((c, i) => {
    const p = packuments[i] ?? null;
    if (!p?.versions[c.version]?.dist?.tarball) return [];
    const now = hasHook(p, c.version);
    if (c.previous) return [{ i, rank: now && !hasHook(p, c.previous) ? 0 : 1 }];
    return now ? [{ i, rank: 2 }] : [];
  });
  return scored.sort((a, b) => a.rank - b.rank || a.i - b.i).map((s) => s.i);
}
async function downloadFiles(fetchTarball, packument, change) {
  const url = (v) => v ? packument.versions[v]?.dist?.tarball : void 0;
  const [current, previous] = await Promise.all([
    fetchTarball(url(change.version)),
    url(change.previous) ? fetchTarball(url(change.previous)) : Promise.resolve(null)
  ]);
  return current ? { current, previous: previous ?? void 0 } : void 0;
}
function isRegistry(resolved) {
  return !resolved || resolved.startsWith("https://registry.npmjs.org/");
}

// src/report.ts
var COMMENT_MARKER = "<!-- depgate-report -->";
var ICON = { high: "\u{1F534} High", medium: "\u{1F7E0} Medium", low: "\u26AA Low" };
function renderReport(result2) {
  const lines = [COMMENT_MARKER, "### DepGate: npm package risk check", ""];
  const { changes, findings, failed } = result2;
  if (changes.length === 0) {
    lines.push("No new or updated npm packages in this PR.");
    return lines.join("\n");
  }
  const flagged = new Set(findings.map((f) => `${f.name}@${f.version}`)).size;
  lines.push(
    `Checked **${changes.length}** new or updated package${changes.length === 1 ? "" : "s"}. ` + (findings.length === 0 ? "Nothing risky found. \u2705" : `**${flagged}** flagged.${failed ? " \u274C This check fails." : ""}`)
  );
  if (findings.length > 0) {
    lines.push("", "| Risk | Package | Reason |", "| --- | --- | --- |");
    for (const f of findings) {
      lines.push(`| ${ICON[f.severity]} | \`${f.name}@${f.version}\` | ${escapeCell(f.reason)} |`);
    }
    lines.push(
      "",
      '<sub>False positive? Add the package to `allow` in `.depgate.json`, e.g. `"allow": ["name@1.2.3"]`.</sub>'
    );
  }
  return lines.join("\n");
}
function escapeCell(s) {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// src/tarball.ts
import { gunzipSync } from "zlib";
var REGISTRY2 = "https://registry.npmjs.org/";
var MAX_TARBALL_BYTES = 30 * 1024 * 1024;
var MAX_FILE_BYTES = 2 * 1024 * 1024;
var TEXT_FILE = /\.(c|m)?js$|\.json$|\.sh$|\.ts$/;
function createTarballClient(fetchImpl = fetch) {
  return async (url) => {
    if (!url.startsWith(REGISTRY2)) return null;
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > MAX_TARBALL_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > MAX_TARBALL_BYTES ? null : readTarball(buf);
  };
}
function readTarball(tgz) {
  const tar = gunzipSync(tgz);
  const files = /* @__PURE__ */ new Map();
  let offset = 0;
  let longName;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(cString(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = cString(header, 345, 155);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = cString(body, 0, body.length);
      continue;
    }
    if (type === "x") {
      longName = /\d+ path=([^\n]+)\n/.exec(body.toString())?.[1] ?? longName;
      continue;
    }
    const name = longName ?? (prefix ? `${prefix}/` : "") + cString(header, 0, 100);
    longName = void 0;
    if (type !== "0" && type !== "\0" || size > MAX_FILE_BYTES) continue;
    const path = name.replace(/^[^/]+\//, "");
    if (TEXT_FILE.test(path)) files.set(path, body.toString("utf8"));
  }
  return files;
}
function cString(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return Buffer.from(end === -1 ? slice : slice.subarray(0, end)).toString("utf8");
}

// src/cli.ts
var { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: "main" },
    head: { type: "string", default: "package-lock.json" },
    config: { type: "string", default: ".depgate.json" },
    strict: { type: "boolean", default: false }
  }
});
if (positionals.length > 0 && positionals[0] !== "check") {
  console.error("Usage: depgate check [--base <git ref or lockfile>] [--head package-lock.json] [--config .depgate.json] [--strict]");
  process.exit(2);
}
var config = loadConfig(values.config);
if (values.strict) config.failOn = "medium";
var result = await runCheck({
  baseLock: readBase(values.base, values.head),
  headLock: readFileSync2(values.head, "utf8"),
  config,
  fetchPackument: createRegistryClient(),
  fetchTarball: createTarballClient()
});
console.log(renderReport(result));
process.exit(result.failed ? 1 : 0);
function readBase(base, lockPath) {
  if (existsSync2(base)) return readFileSync2(base, "utf8");
  try {
    return execFileSync("git", ["show", `${base}:${lockPath}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}
