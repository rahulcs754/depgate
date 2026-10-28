# DepGate

A PR gate for **risky npm dependencies**. It checks every new or updated package in your lockfile for signs of a hijack before it reaches `main` or your CI secrets.

> Status: planning. See [docs/MVP-PLAN.md](docs/MVP-PLAN.md).

## Why
- On 19 May 2026 a Shai-Hulud worm wave published 639 malicious versions across 323 npm packages in one hour.
- It stole GitHub, npm, cloud and CI tokens, re-published the victims' own packages, and planted backdoors in editor and AI agent config files.
- `npm audit` and Dependabot only know about published CVEs, so they miss fresh malware.

## What it will check
- Version published less than 72 hours ago
- New or changed `preinstall` / `install` / `postinstall` scripts
- New maintainer or publisher compared with the previous version
- Obfuscated or minified code that wasn't there before
- New network or `child_process` calls in install scripts

## Planned usage
```bash
npx depgate check --base main      # compare lockfile with main
npx depgate check --strict         # fail CI on any warning
```
