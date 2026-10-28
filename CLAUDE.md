# CLAUDE.md

## Project
DepGate: a TypeScript CLI + GitHub Action that diffs lockfiles in a PR and flags risky npm packages (fresh versions, new install scripts, publisher changes, obfuscated code). Plan: docs/MVP-PLAN.md. Research: docs/RESEARCH.md.

## Stack
Node 22, ESM, TypeScript strict. commander, tar, lockfile parsers, vitest. No AI in the MVP.

## Rules
- NEVER run `npm install` or any install script of a package under review. Only download and read tarballs.
- Tests use recorded registry responses and small tarball fixtures. No network in tests.
- The GitHub Action needs only `contents: read` and `pull-requests: write`. No secrets.
- Every finding names the package, version, check and the evidence (file + snippet).

## Commands
- `npm test`, `npm run build`, `npm run dev -- check --base main`

## Owner
Senior React/Next.js dev, India. Wants short, simple English and a clean portfolio-grade repo.
