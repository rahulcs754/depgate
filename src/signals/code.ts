import type { Finding } from "../types.js";
import type { SignalContext } from "./index.js";

const INSTALL_HOOKS = ["preinstall", "install", "postinstall"];
const TOKEN_NAMES = /\b(NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|AZURE_CLIENT_SECRET|GOOGLE_APPLICATION_CREDENTIALS)\b|\.npmrc\b/;
const NETWORK = /\b(https?\.request|https?\.get|fetch\s*\(|XMLHttpRequest|axios|net\.connect|dns\.resolve)/;
const PROCESS = /\bchild_process\b|\b(execSync|spawnSync|execFile)\s*\(/;
const EVAL_DECODED = /\b(eval|Function)\s*\(\s*(atob|Buffer\.from|decodeURIComponent|unescape|String\.fromCharCode)\s*\(/;
const OBFUSCATOR_NAME = /\b_0x[0-9a-f]{4,6}\b/g;
const LONG_BASE64 = /["'`][A-Za-z0-9+/=]{5000,}["'`]/;

/** JS files that are new or changed in this version, with their previous text. For a new package, every file. */
function changedFiles(ctx: SignalContext): Array<[path: string, text: string, previous: string]> {
  const files = ctx.files;
  if (!files) return [];
  return [...files.current]
    .filter(([path, text]) => /\.(c|m)?js$/.test(path) && files.previous?.get(path) !== text)
    .map(([path, text]) => [path, text, files.previous?.get(path) ?? ""]);
}

function finding(ctx: SignalContext, f: Omit<Finding, "name" | "version">): Finding {
  return { name: ctx.change.name, version: ctx.change.version, ...f };
}

export function snippet(text: string, index: number): string {
  const s = text.slice(index, index + 80).replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

export const credentialAccess = (ctx: SignalContext): Finding | null => {
  for (const [path, text, previous] of changedFiles(ctx)) {
    const token = TOKEN_NAMES.exec(text);
    if (token && NETWORK.test(text) && !TOKEN_NAMES.test(previous)) {
      return finding(ctx, {
        severity: "high",
        signal: "credential-access",
        reason: `\`${path}\` reads \`${token[0]}\` and makes network calls`,
      });
    }
  }
  return null;
};

export const evalDecoded = (ctx: SignalContext): Finding | null => {
  for (const [path, text, previous] of changedFiles(ctx)) {
    const m = EVAL_DECODED.exec(text);
    if (m && !EVAL_DECODED.test(previous)) {
      return finding(ctx, {
        severity: "high",
        signal: "eval-decoded",
        reason: `\`${path}\` runs decoded code: \`${snippet(text, m.index)}\``,
      });
    }
  }
  return null;
};

export const obfuscated = (ctx: SignalContext): Finding | null => {
  for (const [path, text, previous] of changedFiles(ctx)) {
    if (previous && (previous.match(OBFUSCATOR_NAME)?.length ?? 0) > 0) continue;
    const names = new Set(text.match(OBFUSCATOR_NAME) ?? []);
    if (names.size >= 10) {
      return finding(ctx, {
        severity: "medium",
        signal: "obfuscated-code",
        reason: `\`${path}\` looks obfuscated (${names.size} \`_0x…\` names)`,
      });
    }
    if (!ctx.files?.previous?.has(path) && LONG_BASE64.test(text)) {
      return finding(ctx, {
        severity: "medium",
        signal: "obfuscated-code",
        reason: `New file \`${path}\` has a large encoded string`,
      });
    }
  }
  return null;
};

/** Files that install hooks run with node, e.g. "node scripts/setup.js && echo ok" -> ["scripts/setup.js"]. */
export function installScriptFiles(scripts: Record<string, string> | undefined, only?: string[]): string[] {
  const out: string[] = [];
  for (const hook of only ?? INSTALL_HOOKS) {
    for (const part of (scripts?.[hook] ?? "").split(/&&|\|\||;/)) {
      const [cmd, ...args] = part.trim().split(/\s+/);
      const file = cmd === "node" ? args.find((a) => !a.startsWith("-")) : undefined;
      if (!file) continue;
      const path = file.replace(/^["']|["']$/g, "").replace(/^\.\//, "");
      out.push(/\.(c|m)?js$/.test(path) ? path : `${path}.js`);
    }
  }
  return out;
}

function capabilities(text: string): string[] {
  return [
    PROCESS.test(text) && "starts processes",
    NETWORK.test(text) && "makes network calls",
    TOKEN_NAMES.test(text) && "reads tokens",
  ].filter((c): c is string => typeof c === "string");
}

/**
 * Files run by install hooks that start processes, call the network or read tokens.
 * When the hook and file existed before, only capabilities the file did not have before count.
 */
export const installScriptCode = (ctx: SignalContext): Finding | null => {
  const versions = ctx.packument?.versions;
  const scripts = versions?.[ctx.change.version]?.scripts;
  const prevScripts = ctx.change.previous ? versions?.[ctx.change.previous]?.scripts : undefined;
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
        reason: `Install script \`${path}\` ${what.join(", ")}${hookIsNew ? "" : " (new in this version)"}`,
      });
    }
  }
  return null;
};

export const codeSignals = [credentialAccess, evalDecoded, installScriptCode, obfuscated];
