import { gunzipSync } from "node:zlib";

/** Text files of a package, keyed by path inside the package (the leading "package/" is removed). */
export type PackageFiles = Map<string, string>;
export type FetchTarball = (url: string) => Promise<PackageFiles | null>;

const REGISTRY = "https://registry.npmjs.org/";
const MAX_TARBALL_BYTES = 30 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_FILE = /\.(c|m)?js$|\.json$|\.sh$|\.ts$/;

export function createTarballClient(fetchImpl: typeof fetch = fetch): FetchTarball {
  return async (url) => {
    if (!url.startsWith(REGISTRY)) return null; // only ever download from the npm registry
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > MAX_TARBALL_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > MAX_TARBALL_BYTES ? null : readTarball(buf);
  };
}

/** Reads a .tgz in memory and returns its text files. Nothing is written to disk or run. */
export function readTarball(tgz: Uint8Array): PackageFiles {
  const tar = gunzipSync(tgz);
  const files: PackageFiles = new Map();
  let offset = 0;
  let longName: string | undefined;

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
    longName = undefined;
    if ((type !== "0" && type !== "\0") || size > MAX_FILE_BYTES) continue;

    const path = name.replace(/^[^/]+\//, ""); // "package/lib/x.js" -> "lib/x.js"
    if (TEXT_FILE.test(path)) files.set(path, body.toString("utf8"));
  }
  return files;
}

function cString(buf: Uint8Array, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return Buffer.from(end === -1 ? slice : slice.subarray(0, end)).toString("utf8");
}
