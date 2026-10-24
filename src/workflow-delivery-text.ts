import { join } from "node:path";
import { fmtCost, fmtTokenSegment, tokenFigures } from "./display.js";
import type { PersistedRunState, RunPersistence } from "./run-persistence.js";
import type { ManagedRun } from "./workflow-manager.js";

/** Default cap on the JSON-dump fallback in a delivered result summary. Overridable
 *  via the `deliveredResultMaxChars` setting in ~/.pi/workflows/settings.json. */
export const DEFAULT_DELIVERED_MAX_CHARS = 400;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeResult(result: unknown, maxChars: number = DEFAULT_DELIVERED_MAX_CHARS): string {
  if (typeof result === "string") return result;
  if (result == null) return "null";
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    for (const key of ["verdict", "report", "summary", "synthesis"] as const) {
      const val = obj[key];
      if (typeof val === "string" && val.trim()) return val;
    }
  }
  const json = JSON.stringify(result, null, 2);
  if (json.length <= maxChars) return json;
  const kept = json.slice(0, maxChars);
  const droppedBytes = Buffer.byteLength(json, "utf8") - Buffer.byteLength(kept, "utf8");
  return `${kept}\n…(truncated ${formatBytes(droppedBytes)})`;
}

export function deliverText(
  run: {
    snapshot: Pick<ManagedRun["snapshot"], "name" | "agentCount">;
    result?: {
      result?: unknown;
      tokenUsage?: PersistedRunState["tokenUsage"];
      agentCount?: number;
      durationMs?: number;
    };
  },
  opts: { resultPath?: string; maxChars?: number } = {},
): string {
  const summary = summarizeResult(run.result?.result, opts.maxChars);
  const tu = run.result?.tokenUsage;
  const cost = tu?.cost ? ` · ${fmtCost(tu.cost)}` : "";
  const segment = fmtTokenSegment(tokenFigures(tu), fmtTokensShort);
  const tokens = `${segment ? ` · ${segment}` : ""}${cost}`;
  const agents = run.result?.agentCount ?? run.snapshot.agentCount;
  const duration = run.result?.durationMs ? ` · ${(run.result.durationMs / 1000).toFixed(1)}s` : "";
  const lines = [
    `✓ Background workflow "${run.snapshot.name}" finished (${agents} agents${tokens}${duration}).`,
    "",
    summary,
  ];
  if (opts.resultPath) lines.push("", `↳ Full result: ${opts.resultPath}`);
  return lines.join("\n");
}

function fmtTokensShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1000) return `${Math.round(n)}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function persistedDeliveryText(state: PersistedRunState, persistence: RunPersistence): string {
  const resultPath = persistence.exportResult
    ? persistence.exportResult(state.runId, state.result)
    : join(persistence.getRunsDir(), `${state.runId}.json`);
  return deliverText(
    {
      snapshot: { name: state.workflowName, agentCount: state.agents?.length ?? 0 },
      result: {
        result: state.result,
        tokenUsage: state.tokenUsage,
        agentCount: state.agents?.length ?? 0,
        durationMs: state.durationMs,
      },
    },
    { resultPath },
  );
}
