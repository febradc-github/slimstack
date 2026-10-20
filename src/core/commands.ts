import { readConfig, writeConfig } from "./config.ts";
import type { BoardAgent, LeanLevel } from "./config.ts";
import { summarizeStats } from "./stats.ts";

export interface CommandContext {
  cwd: string;
  harness: "claude" | "omp";
  runtime: { execPath: string; env: NodeJS.ProcessEnv };
}

const USAGE =
  "usage: slimstack lean [off|lite|full] | compact [on|off] | stats | board [status|open|stop|agent [auto|claude|omp]]";

export async function runCommand(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  ctx?: CommandContext,
): Promise<{ ok: boolean; text: string }> {
  const [cmd, a, b] = argv;
  const bad = { ok: false, text: USAGE };

  if (cmd === "lean" && argv.length <= 2) {
    if (a === undefined) return { ok: true, text: "lean: " + readConfig(env).lean };
    if (a === "off" || a === "lite" || a === "full") {
      writeConfig({ lean: a as LeanLevel }, env);
      return { ok: true, text: "lean set to " + a };
    }
    return bad;
  }
  if (cmd === "compact" && argv.length <= 2) {
    if (a === undefined) return { ok: true, text: "compact: " + (readConfig(env).compact ? "on" : "off") };
    if (a === "on" || a === "off") {
      writeConfig({ compact: a === "on" }, env);
      return { ok: true, text: "compact set to " + a };
    }
    return bad;
  }
  if (cmd === "stats" && argv.length === 1) return { ok: true, text: summarizeStats(env) };
  if (cmd === "board") {
    if (a === "agent" && argv.length <= 3) {
      if (b === undefined) return { ok: true, text: "board agent: " + readConfig(env).board.agent };
      if (b === "auto" || b === "claude" || b === "omp") {
        writeConfig({ board: { agent: b as BoardAgent } }, env);
        return { ok: true, text: "board agent set to " + b };
      }
      return bad;
    }
    if (argv.length === 1 || (argv.length === 2 && (a === "status" || a === "open" || a === "stop"))) {
      const c: CommandContext = ctx ?? {
        cwd: process.cwd(),
        harness: env.SLIMSTACK_HARNESS === "omp" ? "omp" : "claude",
        runtime: { execPath: process.execPath, env },
      };
      // Lazy: the board module pulls in the daemon client; hook/stats paths must not load it.
      const { boardCommand } = await import("../board/cli.ts");
      return boardCommand(argv.slice(1), c);
    }
  }
  return bad;
}
