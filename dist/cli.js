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
  allow: []
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
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

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
var INSTALL_HOOKS = ["preinstall", "install", "postinstall"];
var DANGEROUS = /\b(curl|wget|child_process|eval|powershell|bash|sh)\b|node -e/;
function finding(ctx, f) {
  return { name: ctx.change.name, version: ctx.change.version, ...f };
}
var notOnRegistry = (ctx) => ctx.packument || !isRegistryResolved(ctx.change.resolved) ? null : finding(ctx, { severity: "high", signal: "not-found", reason: "Not found on the npm registry" });
var freshVersion = (ctx) => {
  const published = ctx.packument?.time?.[ctx.change.version];
  if (!published) return null;
  const ageHours = (ctx.now.getTime() - Date.parse(published)) / HOUR;
  if (ageHours >= ctx.config.minAgeHours) return null;
  return finding(ctx, {
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
  return finding(ctx, {
    severity: "high",
    signal: "new-package",
    reason: `Package first published ${Math.floor(ageDays)} days ago`
  });
};
var installScripts = (ctx) => {
  const current = ctx.packument?.versions[ctx.change.version]?.scripts ?? {};
  const prev = ctx.change.previous ? ctx.packument?.versions[ctx.change.previous]?.scripts ?? {} : {};
  const added = INSTALL_HOOKS.filter((h) => current[h] && current[h] !== prev[h]);
  if (added.length === 0) return null;
  const script = current[added[0]];
  const danger = DANGEROUS.exec(script)?.[0];
  const what = ctx.change.previous ? `New or changed ${added.join(", ")} script` : `Has ${added.join(", ")} script`;
  return finding(ctx, {
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
  return finding(ctx, { severity: "medium", signal: "maintainer-change", reason: capitalize(parts.join("; ")) });
};
var typosquat = (ctx) => {
  const { name } = ctx.change;
  if (name.length < 4 || POPULAR.has(name)) return null;
  for (const target of POPULAR) {
    if (Math.abs(target.length - name.length) <= 1 && editDistance(name, target) === 1) {
      return finding(ctx, { severity: "high", signal: "typosquat", reason: `Name is one letter away from \`${target}\`` });
    }
  }
  return null;
};
var nonRegistrySource = (ctx) => isRegistryResolved(ctx.change.resolved) ? null : finding(ctx, {
  severity: "medium",
  signal: "non-registry-source",
  reason: `Installed from ${truncate(ctx.change.resolved, 60)}, not registry.npmjs.org`
});
var deprecated = (ctx) => {
  const msg = ctx.packument?.versions[ctx.change.version]?.deprecated;
  return msg ? finding(ctx, { severity: "low", signal: "deprecated", reason: `Deprecated: ${truncate(msg, 80)}` }) : null;
};
var allSignals = [
  notOnRegistry,
  typosquat,
  freshVersion,
  newPackage,
  installScripts,
  maintainersChanged,
  nonRegistrySource,
  deprecated
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
  const perChange = await mapLimit(changes, 8, async (change) => {
    const packument = isRegistry(change.resolved) ? await opts.fetchPackument(change.name) : null;
    return allSignals.map((signal) => signal({ change, packument, config: opts.config, now })).filter((f) => f !== null);
  });
  const findings = perChange.flat().sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.name.localeCompare(b.name));
  const failOn = opts.config.failOn;
  const failed = failOn !== "none" && findings.some((f) => RANK[f.severity] >= RANK[failOn]);
  return { changes, findings, failed };
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
  fetchPackument: createRegistryClient()
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
