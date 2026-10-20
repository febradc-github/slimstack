import { buildBootstrap } from "../core/bootstrap.ts";
import { runCommand } from "../core/commands.ts";
import { readConfig } from "../core/config.ts";
import type { OmpApi, OmpMessage } from "./omp-types.ts";

export const SCEPTIC_MODEL = "anthropic/claude-opus-5-5:high";

export default function slimstack(pi: OmpApi): void {
  pi.setLabel("slimstack");

  pi.on("context", (e, ctx) => {
    const role = ctx.agent?.kind === "sub" || process.env.SLIMSTACK_RUN_ID ? "sub" : "main";
    const text = buildBootstrap({ harness: "omp", role, lean: readConfig().lean });
    if (text === null) return undefined;
    const msg: OmpMessage = { role: "user", content: [{ type: "text", text }], timestamp: 0 };
    const messages = e.messages.slice();
    let at = messages.findIndex((m) => m.role !== "compactionSummary");
    if (at === -1) at = messages.length;
    messages.splice(at, 0, msg);
    return { messages };
  });

  pi.registerCommand("slimstack", {
    description: "slimstack: lean [off|lite|full] | compact [on|off] | stats | board [status|open|stop|agent]",
    handler: async (args, ctx) => {
      const r = await runCommand(args.trim().split(/\s+/).filter(Boolean), process.env, {
        cwd: ctx.cwd,
        harness: "omp",
        // process.execPath is omp itself; BUN_BE_BUN makes the daemon it launches run on omp's embedded Bun.
        runtime: { execPath: process.execPath, env: { ...process.env, BUN_BE_BUN: "1" } },
      });
      ctx.ui.notify(r.ok ? r.text : "error: " + r.text, "info");
    },
  });

  // omp discards this package's agent-frontmatter model, so the reviewer model is pinned here.
  pi.on("before_subagent_spawn", (e) =>
    e.agent === "sceptical-plan-reviewer"
      ? { model: SCEPTIC_MODEL, note: "slimstack: sceptical-plan-reviewers on opus-5.5 high" }
      : undefined,
  );
}
