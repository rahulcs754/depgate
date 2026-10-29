import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import type { FetchPackument } from "../src/registry.js";
import type { Packument } from "../src/types.js";

export const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const packuments = JSON.parse(fixture("packuments.json")) as Record<string, Packument>;
export const fakeRegistry: FetchPackument = async (name) => packuments[name] ?? null;

export const NOW = new Date("2026-10-28T08:00:00Z");

/** Builds a .tgz in memory, like `npm pack` does (files under "package/"). */
export function makeTgz(files: Record<string, string>): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const body = Buffer.from(text, "utf8");
    const header = Buffer.alloc(512);
    header.write(`package/${path}`, 0, 100);
    header.write("0000644\0", 100);
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("0", 156);
    header.write("ustar\0", 257);
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
