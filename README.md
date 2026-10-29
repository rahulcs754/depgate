# DepGate

A PR gate for **risky npm dependencies**. It checks every new or updated package in your lockfile for signs of a hijack before it reaches `main` or your CI secrets.

It never installs or runs the packages. It only reads the lockfile, npm registry metadata and the package files (in memory).

> Status: v0.2 (registry checks + package code scan, `package-lock.json`). pnpm/yarn are next. See [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## Why
- On 19 May 2026 a Shai-Hulud worm wave published 639 malicious versions across 323 npm packages in one hour.
- It stole GitHub, npm, cloud and CI tokens, re-published the victims' own packages, and planted backdoors in editor and AI agent config files.
- `npm audit` and Dependabot only know about published CVEs, so they miss fresh malware.

## What it checks

| Check | Risk |
| --- | --- |
| Version published under 72h ago | High |
| Package created under 30 days ago | High |
| New or changed `preinstall` / `install` / `postinstall` script on an update | High |
| Install script that runs `curl`, `wget`, `sh`, `eval`, `child_process`... | High |
| Name one letter away from a popular package (typosquat) | High |
| Not found on the npm registry | High |
| New maintainer, or published by someone who wasn't a maintainer before | Medium |
| Install script on a newly added package | Medium |
| Installed from git or a tarball URL instead of the registry | Medium |
| Deprecated version | Low |

**Code scan.** For updated packages (and new ones with install scripts), DepGate downloads the old and new tarballs from the npm registry and compares the JS files. Only code that is new in this version counts:

| Check | Risk |
| --- | --- |
| A changed file reads tokens (`NPM_TOKEN`, `GITHUB_TOKEN`, `.npmrc`, AWS keys...) and makes network calls | High |
| `eval` / `Function` run on decoded data (`atob`, `Buffer.from`...) | High |
| The file an install script runs starts processes, calls the network or reads tokens (for unchanged scripts, only new behaviour counts) | High |
| Obfuscated code (`_0x…` names) or a large encoded string in a new file | Medium |

## GitHub Action

```yaml
# .github/workflows/depgate.yml
name: DepGate
on:
  pull_request:
    paths: ["package-lock.json"]
permissions:
  contents: read
  pull-requests: write
jobs:
  depgate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: rahulcs754/depgate@main
        with:
          fail-on: high   # high | medium | low | none
```

It posts one PR comment (updated on re-runs) and fails the check at `fail-on` severity or above. No secrets needed.

Example comment:

| Risk | Package | Reason |
| --- | --- | --- |
| 🔴 High | `expresss@0.0.1` | Name is one letter away from `express` |
| 🟠 Medium | `esbuild@0.24.0` | Has postinstall script: `node install.js` |

## CLI

```bash
npm ci && npm run build
node dist/cli.js check --base main          # compare package-lock.json with main
node dist/cli.js check --base main --strict # also fail on Medium
node dist/cli.js check --base old-lock.json # or compare with a file
```

Exit code is 1 when the check fails.

## Config

Optional `.depgate.json` in the repo root (see [examples/.depgate.json](examples/.depgate.json)):

```json
{
  "failOn": "high",
  "minAgeHours": 72,
  "newPackageDays": 30,
  "scanCode": true,
  "maxCodeScans": 40,
  "allow": ["my-internal-pkg", "esbuild@0.24.0"]
}
```

## Develop

- `npm test`: Vitest with recorded registry fixtures (no network)
- `npm run lint`: type check
- `npm run build`: bundle to `dist/` (committed, because the Action runs `dist/index.js`)
