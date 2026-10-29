# DepGate: MVP plan

**One line:** A TypeScript CLI + GitHub Action that diffs lockfiles in a PR and scores each added or bumped npm package for supply-chain risk.

## How it works
1. **Lockfile diff:** parse `package-lock.json`, `pnpm-lock.yaml` and `yarn.lock` on base and head. List added and changed `name@version`.
2. **Registry metadata:** fetch `https://registry.npmjs.org/<name>` for publish time, maintainers, `_npmUser`, and whether there is provenance.
3. **Tarball diff:** download old and new tarballs, compare `package.json` scripts and file list, and look for new obfuscated files (long lines, high entropy, `eval`, `Function(`, base64 blobs).
4. **Score:** each check adds points. Result is pass, warn or block.
5. **Report:** PR comment table + JSON. Exit code 1 on block (or on warn with `--strict`).

## Checks (MVP)
| Check | Level |
|---|---|
| Published under 72h ago | warn (block with `--strict`) |
| New install/postinstall script | block |
| Publisher differs from previous version | warn |
| New file with high entropy / eval | warn |
| `child_process`, `curl`, `wget` in install script | block |
| Package is less than 30 days old with under 100 weekly downloads | warn |

Allowlist file `.depgate.json` for known packages and scopes.

## Stack
TypeScript (Node 22, ESM), @pnpm/lockfile-file, @yarnpkg/lockfile, tar, commander, vitest. No AI needed in the MVP. Optional later: Claude summarises a suspicious diff in plain English.

## Build order (2 weeks)
1. Lockfile parsers + diff + tests
2. Registry metadata checks with a local cache
3. Tarball download + script and entropy checks
4. Scoring + Markdown report + exit codes
5. GitHub Action (runs on `pull_request` with `contents: read` only, no secrets)
6. Replay the May 2026 incident on a test repo for the README demo

## Safety
- Never run install scripts. Only download and read tarballs.
- The Action must run with minimal permissions and no secrets.

## Later
- Local `depgate doctor` that looks for known worm traces in `~/.npmrc`, VS Code and agent config files
- PyPI support

## Progress
- [x] v0.1: `package-lock.json` diff, registry metadata checks (fresh version, new package, install scripts incl. `curl`/`wget`/`child_process`, publisher change, typosquat, non-registry source, deprecated), allowlist, PR comment, GitHub Action, CLI `check --base <ref>`
- [x] v0.2: tarball download + code scan (token access + network, `eval` of decoded data, install script behaviour, obfuscation), only for code new in the version
- [x] v0.3: pnpm (v5/v6/v9) and yarn (v1 and Berry) lockfiles, lockfile found automatically
- [ ] Weekly downloads for the "new package" check
- [ ] Replay the May 2026 incident for the README demo
