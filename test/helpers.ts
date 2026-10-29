import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchPackument } from "../src/registry.js";
import type { Packument } from "../src/types.js";

export const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const packuments = JSON.parse(fixture("packuments.json")) as Record<string, Packument>;
export const fakeRegistry: FetchPackument = async (name) => packuments[name] ?? null;

export const NOW = new Date("2026-10-28T08:00:00Z");
