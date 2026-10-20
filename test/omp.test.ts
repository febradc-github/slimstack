import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import slimstack, { SCEPTIC_MODEL } from "../src/adapters/omp.ts";
import type { OmpApi, OmpContext, OmpMessage, OmpSpawnEvent } from "../src/adapters/omp-types.ts";

type ContextHandler = (e: { messages: OmpMessage[] }, ctx: OmpContext) => { messages: OmpMessage[] } | undefined;
type SpawnHandler = (e: OmpSpawnEvent) => { model: string; note: string } | undefined;
type CommandHandler = (args: string, ctx: OmpContext) => void | Promise<void>;

function load() {
  const h: { context?: ContextHandler; spawn?: SpawnHandler; command?: CommandHandler; label?: string; name?: string } = {};
  const pi: OmpApi = {
    setLabel: (l) => {
      h.label = l;
    },
    on: ((event: string, handler: unknown) => {
      if (event === "context") h.context = handler as ContextHandler;
      else if (event === "before_subagent_spawn") h.spawn = handler as SpawnHandler;
    }) as OmpApi["on"],
    registerCommand: (name, def) => {
      h.name = name;
      h.command = def.handler;
    },
  };
  slimstack(pi);
  return h;
}

const notes: string[] = [];
function ctx(kind?: "main" | "sub"): OmpContext {
  return {
    cwd: process.cwd(),
    agent: kind ? { kind } : undefined,
    ui: { notify: (m) => void notes.push(m) },
  };
}

function textOf(m: OmpMessage): string {
  return (m.content as { text: string }[])[0]!.text;
}

const saved = { home: process.env.SLIMSTACK_HOME, run: process.env.SLIMSTACK_RUN_ID };
let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slimstack-"));
  process.env.SLIMSTACK_HOME = home;
  delete process.env.SLIMSTACK_RUN_ID;
  notes.length = 0;
});
afterEach(() => {
  if (saved.home === undefined) delete process.env.SLIMSTACK_HOME;
  else process.env.SLIMSTACK_HOME = saved.home;
  if (saved.run === undefined) delete process.env.SLIMSTACK_RUN_ID;
  else process.env.SLIMSTACK_RUN_ID = saved.run;
  rmSync(home, { recursive: true, force: true });
});

describe("omp adapter", () => {
  test("registers label and /slimstack command at load", () => {
    const h = load();
    expect(h.label).toBe("slimstack");
    expect(h.name).toBe("slimstack");
  });

  test("context inserts bootstrap after compactionSummary and before the first user message", () => {
    const h = load();
    const messages: OmpMessage[] = [
      { role: "compactionSummary" },
      { role: "compactionSummary" },
      { role: "user", content: "hi" },
      { role: "assistant" },
    ];
    const r = h.context!({ messages }, ctx("main"))!;
    expect(r.messages.length).toBe(5);
    expect(r.messages[0]!.role).toBe("compactionSummary");
    expect(r.messages[1]!.role).toBe("compactionSummary");
    expect(r.messages[2]!.role).toBe("user");
    expect(textOf(r.messages[2]!)).toContain("# slimstack");
    expect(textOf(r.messages[2]!)).toContain("skill://");
    expect(r.messages[3]!.content).toBe("hi");
    expect(messages.length).toBe(4); // input not mutated
  });

  test("context appends when every message is a compactionSummary or none exist", () => {
    const h = load();
    expect(h.context!({ messages: [] }, ctx("main"))!.messages.length).toBe(1);
    const r = h.context!({ messages: [{ role: "compactionSummary" }] }, ctx("main"))!;
    expect(r.messages[1]!.role).toBe("user");
  });

  test("sub agent gets lean-only text", () => {
    const h = load();
    const r = h.context!({ messages: [{ role: "user" }] }, ctx("sub"))!;
    const t = textOf(r.messages[0]!);
    expect(t.startsWith("## lean: lite")).toBe(true);
    expect(t).not.toContain("# slimstack");
  });

  test("SLIMSTACK_RUN_ID makes a main session lean-only", () => {
    process.env.SLIMSTACK_RUN_ID = "R-1";
    const h = load();
    const t = textOf(h.context!({ messages: [{ role: "user" }] }, ctx("main"))!.messages[0]!);
    expect(t.startsWith("## lean: lite")).toBe(true);
    expect(t).not.toContain("# slimstack");
  });

  test("/slimstack lean off takes effect on the next context call", async () => {
    const h = load();
    await h.command!("lean off", ctx("main"));
    expect(notes).toEqual(["lean set to off"]);
    expect(h.context!({ messages: [{ role: "user" }] }, ctx("sub"))).toBeUndefined();
    const t = textOf(h.context!({ messages: [{ role: "user" }] }, ctx("main"))!.messages[0]!);
    expect(t).toContain("# slimstack");
    expect(t).not.toContain("## lean");
  });

  test("command errors are prefixed", async () => {
    const h = load();
    await h.command!("lean bogus", ctx("main"));
    expect(notes[0]).toStartWith("error: usage:");
  });

  test("before_subagent_spawn pins only the sceptical reviewer", () => {
    const h = load();
    const r = h.spawn!({ agent: "sceptical-plan-reviewer" })!;
    expect(r.model).toBe("anthropic/claude-opus-5-5:high");
    expect(r.model).toBe(SCEPTIC_MODEL);
    expect(r.note).toContain("sceptical-plan-reviewers");
    expect(h.spawn!({ agent: "task" })).toBeUndefined();
    expect(h.spawn!({})).toBeUndefined();
  });
});
