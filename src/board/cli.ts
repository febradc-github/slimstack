import type {CommandContext} from "../core/commands.ts";
import {ensureDaemon, health, readDaemonInfo, request, waitForDaemonGone} from "./client.ts";
import {openUrl} from "./open-url.ts";
import {boardDir, findProjectRoot} from "./paths.ts";
import {STATUS_LABEL, type Run, type Status, type Ticket} from "./types.ts";

const STOP_WAIT_MS = 5_000;

/** `slimstack board [status|open|stop]`. */
export async function boardCommand(sub: string[], ctx: CommandContext): Promise<{ok: boolean; text: string}> {
  const root = findProjectRoot(ctx.cwd);
  const dir = boardDir(root);
  const action = sub[0] ?? "status";

  if (action === "open") {
    try {
      const info = await ensureDaemon({projectRoot: root, harness: ctx.harness, runtime: ctx.runtime});
      const url = `http://127.0.0.1:${info.port}/`;
      openUrl(url);
      return {ok: true, text: `board: ${url}`};
    } catch (err) {
      return {ok: false, text: err instanceof Error ? err.message : String(err)};
    }
  }

  const info = readDaemonInfo(dir);
  const alive = info ? await health(info) : null;
  if (!info || !alive) return {ok: true, text: "board: not running"};

  if (action === "stop") {
    try {
      await request(info, "POST", "/api/shutdown");
    } catch {
      // the daemon closes connections while stopping
    }
    await waitForDaemonGone(dir, STOP_WAIT_MS);
    return {ok: true, text: "board: stopped"};
  }

  let body: {tickets: Ticket[]; runs: Run[]};
  try {
    body = (await request(info, "GET", "/api/state")).body as {tickets: Ticket[]; runs: Run[]};
  } catch {
    return {ok: true, text: "board: not running"};
  }
  const {tickets, runs} = body;
  const count = (s: Status) => tickets.filter((t) => t.status === s).length;
  const order: Status[] = ["todo", "in_progress", "testing", "done"];
  return {
    ok: true,
    text: [
      `board: http://127.0.0.1:${info.port}/ (pid ${info.pid})`,
      `tickets: ${order.map((s) => `${STATUS_LABEL[s]} ${count(s)}`).join(", ")}`,
      `agent runs: ${runs.filter((r) => r.status === "running").length} running, ${runs.filter((r) => r.status === "pending").length} queued`,
    ].join("\n"),
  };
}
