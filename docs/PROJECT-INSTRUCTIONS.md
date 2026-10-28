# DepGate: project instructions

- Product: GitHub Action PR gate that flags risky new npm packages (supply-chain worm defense).
- Owner: senior React/Next.js/TS dev. Portfolio + possible open-source product.
- Language: TypeScript strict. No `any`. Small pure functions; signals are pure (input metadata, output finding).
- Network: only `registry.npmjs.org` in v0.1. Never run install scripts. Never execute package code.
- Tests: Vitest, recorded JSON fixtures, no live network.
- Output must be short: one PR comment, one table, plain reasons a reviewer can act on.
- False positives matter more than coverage: every High signal needs a clear reason text and an allow-list path.
- Workflow: docs first, then the MVP in a PR. Keep PRs small, one milestone each where possible.
- Replies to the owner: short, simple English.
