import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { postToolUse, sessionStart, subagentStart } from "../src/adapters/claude.ts";

const dirs: string[] = [];
let home = "";
let project = "";
let env: NodeJS.ProcessEnv = {};

function mk(): string {
  const d = mkdtempSync(join(tmpdir(), "slimstack-"));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  home = mk();
  project = mk();
  env = { ...process.env, SLIMSTACK_HOME: home, CLAUDE_PROJECT_DIR: project };
  delete env.SLIMSTACK_RUN_ID;
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function bigOutput(): string {
  return Array.from({ length: 1000 }, (_, i) => `line ${i} of output`).join("\n");
}

function hookInput(over: Record<string, unknown> = {}) {
  return {
    session_id: "s1",
    cwd: project,
    tool_name: "Bash",
    tool_use_id: "toolu_1",
    tool_response: { stdout: bigOutput(), stderr: "warn: x", interrupted: false, isImage: false, foo: 1 },
    ...over,
  };
}

describe("sessionStart", () => {
  test("injects router and Claude tool map", () => {
    const out = JSON.parse(sessionStart({ session_id: "s1" }, env)!);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("# slimstack");
    expect(out.hookSpecificOutput.additionalContext).toContain("Agent tool");
    expect(out.hookSpecificOutput.additionalContext).toContain("## lean: lite");
  });

  test("lean off drops the lean block", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ lean: "off" }));
    const text = JSON.parse(sessionStart({}, env)!).hookSpecificOutput.additionalContext as string;
    expect(text).toContain("# slimstack");
    expect(text).not.toContain("## lean");
  });

  test("board agent run (SLIMSTACK_RUN_ID) gets the lean block only", () => {
    const text = JSON.parse(sessionStart({}, { ...env, SLIMSTACK_RUN_ID: "R-1" })!).hookSpecificOutput
      .additionalContext as string;
    expect(text.startsWith("## lean: lite")).toBe(true);
    expect(text).not.toContain("# slimstack");
  });
});

describe("subagentStart", () => {
  test("lean block only", () => {
    const out = JSON.parse(subagentStart({}, env)!);
    expect(out.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(out.hookSpecificOutput.additionalContext.startsWith("## lean: lite")).toBe(true);
    expect(out.hookSpecificOutput.additionalContext).not.toContain("# slimstack");
  });

  test("null when lean is off", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ lean: "off" }));
    expect(subagentStart({}, env)).toBeNull();
  });
});

describe("postToolUse", () => {
  test("compacts big stdout, preserves other fields, records stats", () => {
    const raw = postToolUse(hookInput(), env);
    expect(raw).not.toBeNull();
    const out = JSON.parse(raw!);
    expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    const u = out.hookSpecificOutput.updatedToolOutput;
    expect(u.stdout.length).toBeLessThan(bigOutput().length);
    expect(u.stdout).toMatch(/\n\[slimstack: compacted \d+->\d+ chars; full output: .+\]$/);
    expect(u.stderr).toBe("warn: x");
    expect(u.interrupted).toBe(false);
    expect(u.isImage).toBe(false);
    expect(u.foo).toBe(1);
    const lines = readFileSync(join(home, "stats.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.tool).toBe("Bash");
    expect(rec.before).toBe(bigOutput().length);
  });

  test("spill path from the marker exists on disk (Windows backslashes included)", () => {
    const u = JSON.parse(postToolUse(hookInput(), env)!).hookSpecificOutput.updatedToolOutput;
    const p = /full output: (.+)\]$/.exec(u.stdout)![1]!;
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe(bigOutput());
    expect(resolve(p)).toBe(p);
  });

  test("returns null when there is nothing to do", () => {
    expect(postToolUse(hookInput({ tool_response: { stdout: "small", stderr: "", interrupted: false, isImage: false } }), env)).toBeNull();
    expect(postToolUse(hookInput({ tool_name: "Read" }), env)).toBeNull();
    const r = hookInput().tool_response;
    expect(postToolUse(hookInput({ tool_response: { ...r, interrupted: true } }), env)).toBeNull();
    expect(postToolUse(hookInput({ tool_response: { ...r, isImage: true } }), env)).toBeNull();
    expect(postToolUse(hookInput({ tool_response: bigOutput() }), env)).toBeNull();
    expect(postToolUse(hookInput({ tool_response: null }), env)).toBeNull();
    writeFileSync(join(home, "config.json"), JSON.stringify({ compact: false }));
    expect(postToolUse(hookInput(), env)).toBeNull();
  });
});

describe("dist/claude-hook.mjs subprocess", () => {
  const bundle = resolve(import.meta.dir, "..", "dist", "claude-hook.mjs");

  async function run(arg: string, stdin: string, e: Record<string, string | undefined>) {
    if (!existsSync(bundle)) throw new Error("run: bun scripts/build.ts");
    const proc = Bun.spawn([process.execPath, bundle, arg], {
      stdin: new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
      env: e as Record<string, string>,
    });
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { stdout, code };
  }

  test("post-tool-use compacts and ends with the marker line", async () => {
    const r = await run("post-tool-use", JSON.stringify(hookInput()), env);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    const last = out.hookSpecificOutput.updatedToolOutput.stdout.split("\n").pop() as string;
    expect(last).toMatch(/^\[slimstack: compacted \d+->\d+ chars; full output: .+\]$/);
  });

  test("garbage stdin -> empty stdout, exit 0", async () => {
    const r = await run("post-tool-use", "}{ not json", env);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  test("unknown event -> empty stdout, exit 0", async () => {
    const r = await run("nope", "{}", env);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});
