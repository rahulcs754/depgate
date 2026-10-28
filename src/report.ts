import type { CheckResult } from "./check.js";
import type { Severity } from "./types.js";

export const COMMENT_MARKER = "<!-- depgate-report -->";

const ICON: Record<Severity, string> = { high: "🔴 High", medium: "🟠 Medium", low: "⚪ Low" };

export function renderReport(result: CheckResult): string {
  const lines = [COMMENT_MARKER, "### DepGate: npm package risk check", ""];
  const { changes, findings, failed } = result;

  if (changes.length === 0) {
    lines.push("No new or updated npm packages in this PR.");
    return lines.join("\n");
  }

  const flagged = new Set(findings.map((f) => `${f.name}@${f.version}`)).size;
  lines.push(
    `Checked **${changes.length}** new or updated package${changes.length === 1 ? "" : "s"}. ` +
      (findings.length === 0 ? "Nothing risky found. ✅" : `**${flagged}** flagged.${failed ? " ❌ This check fails." : ""}`),
  );

  if (findings.length > 0) {
    lines.push("", "| Risk | Package | Reason |", "| --- | --- | --- |");
    for (const f of findings) {
      lines.push(`| ${ICON[f.severity]} | \`${f.name}@${f.version}\` | ${escapeCell(f.reason)} |`);
    }
    lines.push(
      "",
      "<sub>False positive? Add the package to `allow` in `.depgate.json`, e.g. `\"allow\": [\"name@1.2.3\"]`.</sub>",
    );
  }
  return lines.join("\n");
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
