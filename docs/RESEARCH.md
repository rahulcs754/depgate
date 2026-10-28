# Research notes (Oct 2026)

- 19 May 2026 Shai-Hulud wave: 639 malicious versions across 323 packages in one hour; started from one compromised npm account. Stole GitHub, npm, cloud, Kubernetes, Vault, Docker and SSH credentials from dev machines and CI (GitHub Actions, GitLab CI, Jenkins, Vercel, Netlify). Spread by re-publishing the victim's packages; persisted via VS Code and Claude Code configs. Source: https://bleepingcomputer.com/news/security/new-shai-hulud-malware-wave-compromises-600-npm-packages
- Veracode 2026: 82% of orgs carry security debt, up 11% in a year; high-risk flaws up 36%. Source: https://veracode.com/state-of-software-security-2026

## Competitors
- Socket.dev: strongest; behaviour-based checks, paid team tiers.
- Snyk, npm audit, Dependabot: known CVEs only.
- pnpm `minimumReleaseAge`: one useful rule, no report.

**Gap:** a free, open-source, Action-first gate with a clear report that small teams can adopt in 5 minutes.
