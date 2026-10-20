import {createInterface} from "node:readline";
import {ensureDaemon, request, type DaemonInfo, type DaemonResponse} from "../board/client.ts";
import {createMcpHandler} from "../board/mcp-stdio.ts";
import {findProjectRoot, projectRootOf} from "../board/paths.ts";
import {VERSION} from "../board/version.ts";

/** An env value, or undefined when it is empty, the variable's own name (omp's unset marker), or an unexpanded `${...}`. */
function envValue(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "" || v === name || v.startsWith("${")) return undefined;
  return v;
}

const boardDirEnv = envValue("SLIMSTACK_BOARD_DIR");
const projectRoot = boardDirEnv ? projectRootOf(boardDirEnv) : findProjectRoot(envValue("CLAUDE_PROJECT_DIR") ?? process.cwd());
const harness = envValue("SLIMSTACK_HARNESS") === "omp" ? "omp" : "claude";
const runToken = envValue("SLIMSTACK_RUN_TOKEN");

let info: DaemonInfo | undefined;

async function post(current: DaemonInfo, tool: string, args: unknown): Promise<DaemonResponse> {
  return request(current, "POST", "/api/mcp", {tool, args: args ?? {}}, runToken);
}

async function callTool(tool: string, args: unknown): Promise<{text: string; isError: boolean}> {
  const fresh = () => ensureDaemon({projectRoot, harness, runtime: {execPath: process.execPath, env: process.env}});
  try {
    info ??= await fresh();
    let r: DaemonResponse | undefined;
    try {
      r = await post(info, tool, args);
    } catch {
      // daemon gone or restarted: start/find it again and retry once
    }
    if (r === undefined || r.status === 401) {
      info = await fresh();
      r = await post(info, tool, args);
    }
    const b = r.body as {text?: unknown; isError?: unknown; error?: unknown} | null;
    if (r.status === 200 && b && typeof b.text === "string") return {text: b.text, isError: b.isError === true};
    return {text: typeof b?.error === "string" ? b.error : `board request failed (HTTP ${r.status})`, isError: true};
  } catch (err) {
    info = undefined;
    return {text: `slimstack board unavailable: ${err instanceof Error ? err.message : String(err)}`, isError: true};
  }
}

const handle = createMcpHandler({callTool, version: VERSION});
const pending = new Set<Promise<void>>();

function write(message: object): void {
  process.stdout.write(JSON.stringify(message) + "\n");
}

const rl = createInterface({input: process.stdin, crlfDelay: Infinity});
rl.on("line", (raw) => {
  const line = raw.replace(/\r$/, "");
  if (line.trim() === "") return;
  const task = (async () => {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      write({jsonrpc: "2.0", id: null, error: {code: -32700, message: "Parse error"}});
      return;
    }
    const response = await handle(msg);
    if (response !== null) write(response);
  })()
    .catch((err: unknown) => {
      process.stderr.write(`slimstack mcp: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    })
    .finally(() => {
      pending.delete(task);
    });
  pending.add(task);
});
rl.on("close", () => {
  void (async () => {
    while (pending.size > 0) await Promise.all([...pending]);
    process.stdout.write("", () => process.exit(0));
  })();
});
