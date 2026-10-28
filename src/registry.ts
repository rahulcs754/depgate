import type { Packument } from "./types.js";

export type FetchPackument = (name: string) => Promise<Packument | null>;

const REGISTRY = "https://registry.npmjs.org";

export function createRegistryClient(fetchImpl: typeof fetch = fetch): FetchPackument {
  const cache = new Map<string, Promise<Packument | null>>();
  return (name) => {
    let hit = cache.get(name);
    if (!hit) {
      hit = (async () => {
        const res = await fetchImpl(`${REGISTRY}/${name.replace("/", "%2f")}`, {
          headers: { accept: "application/json" },
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`npm registry ${res.status} for ${name}`);
        return (await res.json()) as Packument;
      })();
      cache.set(name, hit);
    }
    return hit;
  };
}

/** Runs fn over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}
