import { analyzeShellCommand, type ExecCommandSegment } from "./exec-approvals-analysis.js";

function normalizeCommandName(value: string | undefined): string {
  return (value ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function textMentionsSecurityAuditSuppressions(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("security.audit.suppressions") ||
    /["']?security["']?[\s\S]{0,200}["']?audit["']?[\s\S]{0,200}["']?suppressions["']?/.test(
      normalized,
    )
  );
}

function isReadOnlySecurityAuditSuppressionInspection(argv: string[]): boolean {
  const command = normalizeCommandName(argv[0]);
  let offset = command === "pnpm" && argv[1] === "openclaw" ? 1 : 0;
  if (normalizeCommandName(argv[offset]) !== "openclaw") {
    return false;
  }
  offset += 1;
  while (offset < argv.length) {
    const arg = argv[offset];
    if (["--dev", "--no-color"].includes(arg ?? "")) {
      offset += 1;
      continue;
    }
    if (["--profile", "--container", "--log-level"].includes(arg ?? "")) {
      offset += 2;
      continue;
    }
    if (
      arg?.startsWith("--profile=") ||
      arg?.startsWith("--container=") ||
      arg?.startsWith("--log-level=")
    ) {
      offset += 1;
      continue;
    }
    break;
  }
  return (
    argv[offset] === "config" && ["get", "schema", "validate"].includes(argv[offset + 1] ?? "")
  );
}

function removeParsedSegmentText(command: string, segments: Array<{ raw?: string }>): string {
  let remaining = command;
  for (const segment of segments) {
    const raw = segment.raw?.trim();
    if (!raw) {
      continue;
    }
    remaining = remaining.replace(raw, " ");
  }
  return remaining;
}

export function commandRequiresSecurityAuditSuppressionApproval(params: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  segments: ExecCommandSegment[];
}): boolean {
  let sawSegmentMention = false;
  let sawNonReadOnlySegmentMention = false;
  for (const segment of params.segments) {
    const segmentText = `${segment.raw ?? ""} ${segment.argv.join(" ")}`;
    if (!textMentionsSecurityAuditSuppressions(segmentText)) {
      continue;
    }
    sawSegmentMention = true;
    if (!isReadOnlySecurityAuditSuppressionInspection(segment.argv)) {
      sawNonReadOnlySegmentMention = true;
    }
  }
  if (sawSegmentMention) {
    const rawAnalysis = analyzeShellCommand({
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      platform: process.platform,
    });
    if (!rawAnalysis.ok) {
      return sawNonReadOnlySegmentMention || textMentionsSecurityAuditSuppressions(params.command);
    }
    let sawRawMention = false;
    for (const segment of rawAnalysis.segments) {
      if (!textMentionsSecurityAuditSuppressions(`${segment.raw} ${segment.argv.join(" ")}`)) {
        continue;
      }
      sawRawMention = true;
      if (!isReadOnlySecurityAuditSuppressionInspection(segment.argv)) {
        return true;
      }
    }
    if (
      textMentionsSecurityAuditSuppressions(
        removeParsedSegmentText(params.command, rawAnalysis.segments),
      )
    ) {
      return true;
    }
    return sawRawMention ? false : sawNonReadOnlySegmentMention;
  }
  return textMentionsSecurityAuditSuppressions(params.command);
}
