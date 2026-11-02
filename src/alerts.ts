import type { Alert } from "./reach.js";

/** Open npm Dependabot alerts for a repo, plus vulnerable function names from each advisory. */
export async function fetchAlerts(opts: {
  token: string;
  owner: string;
  repo: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<Alert[]> {
  const api = opts.apiUrl ?? "https://api.github.com";
  const f = opts.fetchImpl ?? fetch;
  const get = async (url: string) => {
    const res = await f(url, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${opts.token}`, "x-github-api-version": "2022-11-28" },
    });
    if (!res.ok) {
      const hint =
        res.status === 403 || res.status === 404
          ? " Give the workflow `security-events: read`, or pass a token with Dependabot alerts read access as `alerts-token`."
          : "";
      throw new Error(`GitHub API ${new URL(url).pathname} returned ${res.status}.${hint}`);
    }
    return res.json() as Promise<any>;
  };

  const raw: any[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = (await get(`${api}/repos/${opts.owner}/${opts.repo}/dependabot/alerts?state=open&ecosystem=npm&per_page=100&page=${page}`)) as any[];
    raw.push(...batch);
    if (batch.length < 100) break;
  }

  const functions = new Map<string, Promise<Record<string, string[]>>>();
  const fnsFor = (ghsa: string) => {
    let p = functions.get(ghsa);
    if (!p) {
      p = get(`${api}/advisories/${ghsa}`)
        .then((adv) => {
          const out: Record<string, string[]> = {};
          for (const v of adv.vulnerabilities ?? []) if (v.package?.name) out[v.package.name] = v.vulnerable_functions ?? [];
          return out;
        })
        .catch(() => ({})); // functions are a bonus; the alert still counts
      functions.set(ghsa, p);
    }
    return p;
  };

  return Promise.all(raw.map(async (a) => toAlert(a, (await fnsFor(a.security_advisory?.ghsa_id ?? ""))[a.dependency?.package?.name] ?? [])));
}

/** Maps one Dependabot alert from the REST API (or a saved JSON file) to our shape. */
export function toAlert(a: any, functions: string[] = []): Alert {
  return {
    number: a.number,
    package: a.dependency?.package?.name ?? a.security_vulnerability?.package?.name,
    severity: a.security_vulnerability?.severity ?? a.security_advisory?.severity ?? "unknown",
    ghsa: a.security_advisory?.ghsa_id ?? "",
    summary: a.security_advisory?.summary ?? "",
    manifest: a.dependency?.manifest_path,
    scope: a.dependency?.scope ?? null,
    relationship: a.dependency?.relationship ?? null,
    vulnerableRange: a.security_vulnerability?.vulnerable_version_range,
    patched: a.security_vulnerability?.first_patched_version?.identifier,
    functions: a.vulnerable_functions ?? functions,
    url: a.html_url,
  };
}
