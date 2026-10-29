# CLAUDE.md

## Project
DepGate: a TypeScript CLI + GitHub Action that diffs lockfiles in a PR and flags risky npm packages (fresh versions, new install scripts, publisher changes, typosquats; obfuscated code next). Plan: docs/MVP-PLAN.md. Research: docs/RESEARCH.md. Working rules: docs/PROJECT-INSTRUCTIONS.md.

## Stack
Node 20+ (CI on 22), ESM, TypeScript strict. @actions/core + @actions/github, bundled with tsup into `dist/`. Vitest. No AI in the MVP.

## Layout
- `src/lockfile.ts`: parse + diff npm lockfiles (v2/v3)
- `src/registry.ts`: npm registry client with cache, `mapLimit`
- `src/signals/index.ts`: registry risk signals, pure functions `(ctx) => Finding | null`
- `src/signals/code.ts`: code-scan signals over package files (new/changed code only)
- `src/tarball.ts`: download a registry tarball and read its text files in memory (no disk, no execution)
- `src/check.ts`: runs diff + signals, decides pass/fail
- `src/report.ts`: Markdown PR comment
- `src/main.ts`: GitHub Action entry; `src/cli.ts`: CLI entry
- `test/fixtures/`: recorded lockfiles and registry responses

## Rules
- NEVER run `npm install` or any install script of a package under review. Only read metadata and tarball contents in memory.
- Tests use recorded registry responses. No network in tests.
- The GitHub Action needs only `contents: read` and `pull-requests: write`. No secrets.
- Every finding names the package, version, check and a plain-English reason.
- After changing `src/`, run `npm run build` and commit `dist/` (CI fails if it is stale).

## Commands
- `npm test`, `npm run lint`, `npm run build`
- `node dist/cli.js check --base main`

## Owner
Senior React/Next.js dev, India. Wants short, simple English and a clean portfolio-grade repo.
