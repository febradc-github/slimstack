import { buildBootstrap } from "../core/bootstrap.ts";
import { compactOutput } from "../core/compact.ts";
import { readConfig } from "../core/config.ts";
import { pruneSpill } from "../core/spill.ts";
import { recordCompaction } from "../core/stats.ts";

export interface ClaudeHookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_response?: unknown;
}

function projectDirOf(input: ClaudeHookInput, env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
}

export function sessionStart(input: ClaudeHookInput, env: NodeJS.ProcessEnv = process.env): string | null {
  pruneSpill(projectDirOf(input, env));
  // Board agent runs get the lean block only: they follow their role file, not the router.
  const role = env.SLIMSTACK_RUN_ID ? "sub" : "main";
  const text = buildBootstrap({ harness: "claude", role, lean: readConfig(env).lean });
  if (text === null) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } });
}

export function subagentStart(_input: ClaudeHookInput, env: NodeJS.ProcessEnv = process.env): string | null {
  const text = buildBootstrap({ harness: "claude", role: "sub", lean: readConfig(env).lean });
  if (text === null) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text } });
}

export function postToolUse(input: ClaudeHookInput, env: NodeJS.ProcessEnv = process.env): string | null {
  if (input.tool_name !== "Bash") return null;
  const resp = input.tool_response;
  if (typeof resp !== "object" || resp === null || Array.isArray(resp)) return null;
  const r = resp as Record<string, unknown>;
  if (r.interrupted === true || r.isImage === true) return null;
  if (!readConfig(env).compact) return null;

  const projectDir = projectDirOf(input, env);
  const sessionId = input.session_id ?? "session";
  const callId = input.tool_use_id ?? String(Date.now());
  const updated: Record<string, unknown> = { ...r };
  let changed = false;
  for (const stream of ["stdout", "stderr"] as const) {
    const value = r[stream];
    if (typeof value !== "string") continue;
    const res = compactOutput(value, { projectDir, sessionId, callId, stream });
    if (res === null) continue;
    updated[stream] = res.text;
    changed = true;
    recordCompaction({ ts: Date.now(), tool: "Bash", before: res.before, after: res.after }, env);
  }
  if (!changed) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } });
}
