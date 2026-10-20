import { postToolUse, sessionStart, subagentStart } from "../adapters/claude.ts";
import type { ClaudeHookInput } from "../adapters/claude.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}

// A hook must never break the session: swallow everything, always exit 0.
try {
  const raw = (await readStdin()).trim();
  const input = (raw === "" ? {} : JSON.parse(raw)) as ClaudeHookInput;
  let out: string | null = null;
  switch (process.argv[2]) {
    case "session-start":
      out = sessionStart(input);
      break;
    case "subagent-start":
      out = subagentStart(input);
      break;
    case "post-tool-use":
      out = postToolUse(input);
      break;
  }
  if (out !== null) process.stdout.write(out + "\n");
} catch {
  // fail open
}
