import {spawn, spawnSync} from "node:child_process";
import {accessSync, closeSync, constants, mkdirSync, openSync, statSync, writeFileSync, writeSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import type {BoardConfig} from "../core/config.ts";
import type {Run} from "./types.ts";

export type Harness = "claude" | "omp";

/** Agent argv presets. `omp[0]` is the bare name; `resolveAgentArgv` swaps in the daemon's own execPath when that is omp. */
export const PRESETS: {claude: readonly string[]; omp: readonly string[]} = {
  claude: ["claude", "-p", "--mcp-config", "{mcpConfig}", "--strict-mcp-config", "--permission-mode", "bypassPermissions"],
  omp: ["omp", "-p", "--no-title", "--approval-mode", "yolo"],
};

export function resolveAgentArgv(config: BoardConfig, harness: Harness, execPath: string = process.execPath): string[] {
  if (config.agent === "custom") {
    if (config.command.length === 0) throw new Error('board.agent is "custom" but board.command is empty');
    return [...config.command];
  }
  const which: Harness = config.agent === "auto" ? harness : config.agent;
  if (which === "claude") return [...PRESETS.claude];
  const argv = [...PRESETS.omp];
  if (/^omp(\.exe)?$/i.test(execPath.slice(Math.max(execPath.lastIndexOf("/"), execPath.lastIndexOf("\\")) + 1))) argv[0] = execPath;
  return argv;
}

const PLACEHOLDER_RE = /\{(mcpConfig|ticket|run|role|cwd|prompt)\}/g;

export function expandArgv(
  argv: string[],
  vars: {mcpConfig: string; ticket: string; run: string; role: string; cwd: string; prompt: string},
): {argv: string[]; stdin: string} {
  let promptInArgv = false;
  const out = argv.map(arg =>
    arg.replace(PLACEHOLDER_RE, (_m, name: keyof typeof vars) => {
      if (name === "prompt") promptInArgv = true;
      return vars[name];
    }),
  );
  return {argv: out, stdin: promptInArgv ? "" : vars.prompt};
}

export function buildPrompt(run: Run, roleFile: string): string {
  return (
    `slimstack board run ${run.id}: role ${run.role}, mode ${run.mode}, ticket T-${run.ticket}` +
    (run.commentId !== null ? `, comment #${run.commentId}` : "") +
    ".\n" +
    `Read ${roleFile} and follow it exactly.\n` +
    "Use only the slimstack board tools for board reads and writes; never open files under .slimstack/board."
  );
}

export function runEnv(
  base: NodeJS.ProcessEnv,
  o: {run: Run; boardDir: string; argv0: string; execPath: string; custom: boolean},
): Record<string, string> {
  const win = process.platform === "win32";
  const a0 = resolve(o.argv0);
  const e0 = resolve(o.execPath);
  const keepBun = o.custom && (win ? a0.toLowerCase() === e0.toLowerCase() : a0 === e0);
  const out: Record<string, string> = {};
  for (const key of Object.keys(base)) {
    const value = base[key];
    if (value === undefined) continue;
    const k = win ? key.toUpperCase() : key;
    if (k === "CLAUDECODE" || k === "CLAUDE_CODE_ENTRYPOINT") continue;
    if (k === "BUN_BE_BUN" && !keepBun) continue;
    out[key] = value;
  }
  out.SLIMSTACK_BOARD_DIR = o.boardDir;
  out.SLIMSTACK_RUN_TOKEN = o.run.token;
  out.SLIMSTACK_RUN_ID = o.run.id;
  out.SLIMSTACK_TICKET = String(o.run.ticket);
  return out;
}

export function writeRunMcpConfig(
  file: string,
  o: {boardDir: string; token: string; harness: Harness; pluginRoot: string; execPath: string; daemonEnv: NodeJS.ProcessEnv},
): void {
  const env: Record<string, string> = {
    SLIMSTACK_BOARD_DIR: o.boardDir,
    SLIMSTACK_RUN_TOKEN: o.token,
    SLIMSTACK_HARNESS: o.harness,
  };
  if (o.daemonEnv.BUN_BE_BUN === "1") env.BUN_BE_BUN = "1";
  const config = {
    mcpServers: {
      "slimstack-board": {
        type: "stdio",
        command: o.execPath,
        args: [join(o.pluginRoot, "dist", "mcp.mjs")],
        env,
      },
    },
  };
  writeFileSync(file, JSON.stringify(config), {mode: 0o600});
}

function isFile(p: string, posixExec: boolean): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    if (posixExec) accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const UNSAFE_CMD_ARG = /["&|<>^%!]/;

export function resolveCommand(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): {file: string; args: string[]; verbatim: boolean} {
  const win = platform === "win32";
  let file: string;
  if (cmd.includes("/") || cmd.includes("\\")) {
    file = cmd;
  } else {
    const dirs = (win ? (env.Path ?? env.PATH ?? "") : (env.PATH ?? ""))
      .split(win ? ";" : ":")
      .map(d => (win ? d.replace(/^"|"$/g, "") : d))
      .filter(d => d !== "");
    const exts = win ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(e => e !== "") : [];
    const lowerExts = exts.map(e => e.toLowerCase());
    const dot = cmd.lastIndexOf(".");
    const names: string[] = [];
    if (!win || (dot > 0 && lowerExts.includes(cmd.slice(dot).toLowerCase()))) names.push(cmd);
    for (const e of exts) names.push(cmd + e);
    let found: string | null = null;
    search: for (const dir of dirs) {
      for (const name of names) {
        const candidate = join(dir, name);
        if (isFile(candidate, !win)) {
          found = candidate;
          break search;
        }
      }
    }
    if (found === null) throw new Error(`agent command not found on PATH: ${cmd}`);
    file = found;
  }
  if (win && /\.(cmd|bat)$/i.test(file)) {
    for (const a of args) {
      if (UNSAFE_CMD_ARG.test(a)) throw new Error(`argument not safe for cmd.exe: ${a}`);
    }
    const line = [file, ...args].map(a => '"' + a + '"').join(" ");
    return {file: env.ComSpec ?? env.COMSPEC ?? "cmd.exe", args: ["/d", "/s", "/c", '"' + line + '"'], verbatim: true};
  }
  return {file, args, verbatim: false};
}

export interface SpawnSpec {
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  logFile: string;
  /** First log line, e.g. `# R-1 coder implement T-1 <ISO time>`; `# argv: ...` is appended by the spawner. */
  header: string;
}

export interface Spawner {
  start(spec: SpawnSpec, onExit: (code: number | null) => void): {pid: number | null; kill(): void};
}

export const realSpawner: Spawner = {
  start(spec, onExit) {
    // Throws synchronously on command-not-found / unsafe argument: the watcher records a failed run.
    const {file, args, verbatim} = resolveCommand(spec.argv[0]!, spec.argv.slice(1), spec.env);
    mkdirSync(dirname(spec.logFile), {recursive: true});
    const fd = openSync(spec.logFile, "a");
    let fdOpen = true;
    const log = (text: string | Uint8Array): void => {
      if (!fdOpen) return;
      try {
        if (typeof text === "string") writeSync(fd, text);
        else writeSync(fd, text);
      } catch {
        // log is best effort
      }
    };
    log(spec.header.replace(/\n$/, "") + "\n# argv: " + spec.argv.join(" ") + "\n");

    let exited = false;
    let finished = false;
    const finish = (code: number | null): void => {
      if (finished) return;
      finished = true;
      exited = true;
      if (fdOpen) {
        fdOpen = false;
        try {
          closeSync(fd);
        } catch {
          // ignore
        }
      }
      onExit(code);
    };

    const child = spawn(file, args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      windowsVerbatimArguments: verbatim,
    });
    child.stdout.on("data", (c: Uint8Array) => log(c));
    child.stderr.on("data", (c: Uint8Array) => log(c));
    child.stdin.on("error", () => {});
    if (spec.stdin !== "") child.stdin.write(spec.stdin);
    child.stdin.end();
    child.on("error", err => {
      log(`# spawn error: ${err.message}\n`);
      finish(null);
    });
    // 'close' waits for the stdio pipes; a grandchild that outlives the agent could hold them open.
    child.on("close", code => finish(code));
    child.on("exit", code => {
      setTimeout(() => finish(code), 2000).unref();
    });

    return {
      pid: child.pid ?? null,
      kill() {
        const pid = child.pid;
        if (pid === undefined || exited) return;
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {windowsHide: true});
          return;
        }
        try {
          process.kill(-pid, "SIGTERM");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGTERM");
          return;
        }
        setTimeout(() => {
          if (exited) return;
          try {
            process.kill(-pid, "SIGKILL");
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ESRCH") child.kill("SIGKILL");
          }
        }, 5000).unref();
      },
    };
  },
};
