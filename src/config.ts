import { existsSync, readFileSync } from "node:fs";
import { defaultConfig, type Config } from "./types.js";

export function loadConfig(path = ".depgate.json"): Config {
  if (!existsSync(path)) return defaultConfig;
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  return { ...defaultConfig, ...raw };
}

export function isAllowed(name: string, version: string, allow: string[]): boolean {
  return allow.some((entry) => {
    const at = entry.lastIndexOf("@");
    if (at <= 0) return entry === name; // "pkg" or "@scope/pkg"
    return entry.slice(0, at) === name && entry.slice(at + 1) === version;
  });
}
