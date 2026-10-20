import {afterAll, describe, expect, test} from "bun:test";
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import type {BoardConfig} from "../src/core/config.ts";
import {PRESETS, buildPrompt, expandArgv, resolveAgentArgv, resolveCommand, runEnv, writeRunMcpConfig} from "../src/board/spawn.ts";
import type {Run} from "../src/board/types.ts";

const tmp = mkdtempSync(join(tmpdir(), "slimstack-spawn-"));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: "R-3",
    ticket: 7,
    role: "coder",
    mode: "implement",
    commentId: null,
    status: "pending",
    waitingFor: [],
    token: "tok123",
    pid: null,
    exitCode: null,
    mcpCalls: 0,
    createdAt: 0,
    startedAt: null,
    endedAt: null,
    note: null,
    ...over,
  };
}

function cfg(over: Partial<BoardConfig> = {}): BoardConfig {
  return {agent: "auto", command: [], timeoutMinutes: 60, openBrowser: true, ...over};
}

describe("resolveCommand", () => {
  test("win32: .cmd shim on PATH is wrapped in cmd.exe with verbatim arguments", () => {
    const dir = join(tmp, "winbin");
    rmSync(dir, {recursive: true, force: true});
    mkdirSync(dir);
    writeFileSync(join(dir, "fake.cmd"), "@echo off\r\n");
    const r = resolveCommand("fake", ["-p", "--flag"], {Path: dir, PATHEXT: ".cmd", ComSpec: "C:\\Windows\\System32\\cmd.exe"}, "win32");
    const file = join(dir, "fake.cmd");
    expect(r.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(r.verbatim).toBe(true);
    expect(r.args).toEqual(["/d", "/s", "/c", `""${file}" "-p" "--flag""`]);
  });

  test("win32: ComSpec defaults to cmd.exe; .exe is run directly", () => {
    const dir = join(tmp, "winbin2");
    mkdirSync(dir);
    writeFileSync(join(dir, "tool.cmd"), "");
    writeFileSync(join(dir, "real.exe"), "");
    expect(resolveCommand("tool", [], {PATH: dir, PATHEXT: ".exe;.cmd"}, "win32").file).toBe("cmd.exe");
    const exe = resolveCommand("real", ["a"], {PATH: dir, PATHEXT: ".exe;.cmd"}, "win32");
    expect(exe).toEqual({file: join(dir, "real.exe"), args: ["a"], verbatim: false});
  });

  test("win32: an argument with cmd.exe metacharacters is rejected for a .cmd shim", () => {
    const dir = join(tmp, "winbin");
    for (const bad of ["a&b", 'a"b', "a|b", "a<b", "a>b", "a^b", "50%", "hi!"]) {
      expect(() => resolveCommand("fake", [bad], {Path: dir, PATHEXT: ".cmd"}, "win32")).toThrow(`argument not safe for cmd.exe: ${bad}`);
    }
  });

  test("win32: command with a path separator is used as is; .bat is wrapped too", () => {
    expect(resolveCommand("C:\\bin\\claude.exe", ["-p"], {}, "win32")).toEqual({file: "C:\\bin\\claude.exe", args: ["-p"], verbatim: false});
    expect(resolveCommand("C:\\bin\\x.bat", ["-p"], {}, "win32").verbatim).toBe(true);
  });

  test("not found on PATH throws", () => {
    expect(() => resolveCommand("nope-slimstack", [], {Path: tmp, PATHEXT: ".cmd"}, "win32")).toThrow("agent command not found on PATH: nope-slimstack");
    expect(() => resolveCommand("nope-slimstack", [], {PATH: tmp}, "linux")).toThrow("agent command not found on PATH: nope-slimstack");
  });

  test("POSIX: finds an executable file on PATH, skipping non-executable and earlier misses", () => {
    if (process.platform === "win32") return; // executable bit is not meaningful on Windows
    const a = join(tmp, "pa");
    const b = join(tmp, "pb");
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "agent"), "#!/bin/sh\n");
    chmodSync(join(a, "agent"), 0o644);
    writeFileSync(join(b, "agent"), "#!/bin/sh\n");
    chmodSync(join(b, "agent"), 0o755);
    const r = resolveCommand("agent", ["-p"], {PATH: `${a}:${join(tmp, "missing")}:${b}`}, "linux");
    expect(r).toEqual({file: join(b, "agent"), args: ["-p"], verbatim: false});
    expect(resolveCommand("/abs/agent", ["x"], {}, "linux")).toEqual({file: "/abs/agent", args: ["x"], verbatim: false});
  });
});

describe("runEnv", () => {
  const base = {PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", BUN_BE_BUN: "1", KEEP: "yes"};
  const run = makeRun();

  test("strips nested-session variables and BUN_BE_BUN, adds run identity", () => {
    const env = runEnv(base, {run, boardDir: "/p/.slimstack/board", argv0: "claude", execPath: "/x/omp.exe", custom: false});
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.BUN_BE_BUN).toBeUndefined();
    expect(env.KEEP).toBe("yes");
    expect(env.PATH).toBe("/bin");
    expect(env.SLIMSTACK_BOARD_DIR).toBe("/p/.slimstack/board");
    expect(env.SLIMSTACK_RUN_TOKEN).toBe("tok123");
    expect(env.SLIMSTACK_RUN_ID).toBe("R-3");
    expect(env.SLIMSTACK_TICKET).toBe("7");
    expect(base.CLAUDECODE).toBe("1"); // base is not mutated
  });

  test("keeps BUN_BE_BUN only for a custom argv0 equal to execPath", () => {
    const exec = resolve("some", "dir", "omp.exe");
    expect(runEnv(base, {run, boardDir: "d", argv0: exec, execPath: exec, custom: true}).BUN_BE_BUN).toBe("1");
    expect(runEnv(base, {run, boardDir: "d", argv0: exec, execPath: exec, custom: false}).BUN_BE_BUN).toBeUndefined();
    expect(runEnv(base, {run, boardDir: "d", argv0: "claude", execPath: exec, custom: true}).BUN_BE_BUN).toBeUndefined();
  });

  test("drops undefined values", () => {
    const env = runEnv({A: undefined, B: "b"}, {run, boardDir: "d", argv0: "x", execPath: "y", custom: false});
    expect("A" in env).toBe(false);
    expect(env.B).toBe("b");
  });
});

describe("resolveAgentArgv", () => {
  test("auto follows the harness that started the daemon", () => {
    expect(resolveAgentArgv(cfg(), "claude", "/usr/bin/bun")).toEqual([...PRESETS.claude]);
    expect(resolveAgentArgv(cfg(), "omp", "/usr/bin/bun")).toEqual(["omp", "-p", "--no-title", "--approval-mode", "yolo"]);
  });

  test("explicit claude/omp ignore the harness", () => {
    expect(resolveAgentArgv(cfg({agent: "claude"}), "omp")[0]).toBe("claude");
    expect(resolveAgentArgv(cfg({agent: "omp"}), "claude", "/usr/bin/bun")[0]).toBe("omp");
  });

  test("omp preset uses the daemon execPath only when it is omp", () => {
    expect(resolveAgentArgv(cfg({agent: "omp"}), "omp", "C:\\Users\\x\\omp.exe")[0]).toBe("C:\\Users\\x\\omp.exe");
    expect(resolveAgentArgv(cfg({agent: "omp"}), "omp", "/opt/bin/omp")[0]).toBe("/opt/bin/omp");
    expect(resolveAgentArgv(cfg({agent: "omp"}), "omp", "C:\\bun\\bun.exe")[0]).toBe("omp");
    expect(resolveAgentArgv(cfg({agent: "omp"}), "omp", "/opt/bin/ompx")[0]).toBe("omp");
  });

  test("presets are not mutated by resolution", () => {
    resolveAgentArgv(cfg({agent: "omp"}), "omp", "/opt/bin/omp")[0] = "mutated";
    expect(PRESETS.omp[0]).toBe("omp");
  });

  test("custom returns a copy of the command; empty command throws", () => {
    const command = ["my-agent", "--x", "{prompt}"];
    const argv = resolveAgentArgv(cfg({agent: "custom", command}), "claude");
    expect(argv).toEqual(command);
    expect(argv).not.toBe(command);
    expect(() => resolveAgentArgv(cfg({agent: "custom"}), "claude")).toThrow('board.agent is "custom" but board.command is empty');
  });
});

describe("expandArgv", () => {
  const vars = {mcpConfig: "/p/R-3.mcp.json", ticket: "7", run: "R-3", role: "coder", cwd: "/p", prompt: "THE PROMPT $& {run}"};

  test("claude preset: placeholders replaced, prompt on stdin", () => {
    const r = expandArgv([...PRESETS.claude], vars);
    expect(r.argv).toEqual(["claude", "-p", "--mcp-config", "/p/R-3.mcp.json", "--strict-mcp-config", "--permission-mode", "bypassPermissions"]);
    expect(r.stdin).toBe(vars.prompt);
  });

  test("every argument is expanded, all six placeholders", () => {
    const r = expandArgv(["x-{ticket}-{run}", "{role}@{cwd}", "{mcpConfig}", "{ticket}{ticket}", "{unknown}"], vars);
    expect(r.argv).toEqual(["x-7-R-3", "coder@/p", "/p/R-3.mcp.json", "77", "{unknown}"]);
    expect(r.stdin).toBe(vars.prompt);
  });

  test("{prompt} in an argument moves the prompt to argv and closes stdin; substituted text is not re-expanded", () => {
    const r = expandArgv(["agent", "--prompt={prompt}"], vars);
    expect(r.argv).toEqual(["agent", "--prompt=THE PROMPT $& {run}"]);
    expect(r.stdin).toBe("");
  });
});

describe("buildPrompt", () => {
  test("three lines without a comment", () => {
    const text = buildPrompt(makeRun(), "/plugin/skills/board/references/role-coder.md");
    expect(text).toBe(
      "slimstack board run R-3: role coder, mode implement, ticket T-7.\n" +
        "Read /plugin/skills/board/references/role-coder.md and follow it exactly.\n" +
        "Use only the slimstack board tools for board reads and writes; never open files under .slimstack/board.",
    );
  });

  test("comment id is included when set", () => {
    const text = buildPrompt(makeRun({role: "tester", mode: "review_reply", commentId: 12}), "r.md");
    expect(text.split("\n")[0]).toBe("slimstack board run R-3: role tester, mode review_reply, ticket T-7, comment #12.");
  });
});

describe("writeRunMcpConfig", () => {
  const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
  const o = {boardDir: "/p/.slimstack/board", token: "tok", harness: "claude" as const, pluginRoot: join(tmp, "plugin"), execPath: "/usr/bin/node"};

  test("stdio server entry with run identity", () => {
    const file = join(tmp, "R-1.mcp.json");
    writeRunMcpConfig(file, {...o, daemonEnv: {}});
    expect(read(file)).toEqual({
      mcpServers: {
        "slimstack-board": {
          type: "stdio",
          command: "/usr/bin/node",
          args: [join(tmp, "plugin", "dist", "mcp.mjs")],
          env: {SLIMSTACK_BOARD_DIR: "/p/.slimstack/board", SLIMSTACK_RUN_TOKEN: "tok", SLIMSTACK_HARNESS: "claude"},
        },
      },
    });
  });

  test("BUN_BE_BUN is carried only when the daemon runs with it", () => {
    const file = join(tmp, "R-2.mcp.json");
    writeRunMcpConfig(file, {...o, harness: "omp", daemonEnv: {BUN_BE_BUN: "1"}});
    const env = read(file).mcpServers["slimstack-board"].env;
    expect(env.BUN_BE_BUN).toBe("1");
    expect(env.SLIMSTACK_HARNESS).toBe("omp");
  });
});
