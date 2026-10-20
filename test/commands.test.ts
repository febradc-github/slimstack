import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, DEFAULT_CONFIG } from "../src/core/config.ts";
import { runCommand } from "../src/core/commands.ts";

const dirs: string[] = [];
let home = "";
let env: NodeJS.ProcessEnv = {};

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slimstack-"));
  dirs.push(home);
  env = { ...process.env, SLIMSTACK_HOME: home };
});
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("runCommand", () => {
  test("lean persists and reads back", async () => {
    expect(await runCommand(["lean"], env)).toEqual({ ok: true, text: "lean: lite" });
    expect(await runCommand(["lean", "full"], env)).toEqual({ ok: true, text: "lean set to full" });
    expect(await runCommand(["lean"], env)).toEqual({ ok: true, text: "lean: full" });
    expect(readConfig(env).lean).toBe("full");
  });

  test("lean bogus fails", async () => {
    const r = await runCommand(["lean", "bogus"], env);
    expect(r.ok).toBe(false);
    expect(r.text).toContain("usage:");
  });

  test("compact persists", async () => {
    expect((await runCommand(["compact"], env)).text).toBe("compact: on");
    expect((await runCommand(["compact", "off"], env)).ok).toBe(true);
    expect((await runCommand(["compact"], env)).text).toBe("compact: off");
    expect(readConfig(env).compact).toBe(false);
    expect((await runCommand(["compact", "maybe"], env)).ok).toBe(false);
  });

  test("stats sums seeded records and skips bad lines", async () => {
    const empty = await runCommand(["stats"], env);
    expect(empty.ok).toBe(true);
    expect(empty.text).toContain("no compactions recorded");
    const t0 = Date.UTC(2026, 0, 5, 12);
    writeFileSync(
      join(home, "stats.jsonl"),
      [
        JSON.stringify({ ts: t0, tool: "Bash", before: 1000, after: 250 }),
        "not json",
        JSON.stringify({ ts: t0 + 1000, tool: "Bash", before: 3000, after: 750 }),
        "",
      ].join("\n"),
    );
    const r = await runCommand(["stats"], env);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("since 2026-01-05");
    expect(r.text).toContain("compactions: 2");
    expect(r.text).toContain("chars: 4000 -> 1000 (-75.0%)");
    expect(r.text).toContain("~tokens saved: 750");
  });

  test("corrupt config.json -> defaults", async () => {
    writeFileSync(join(home, "config.json"), "{ not json");
    expect(readConfig(env)).toEqual(DEFAULT_CONFIG);
    expect((await runCommand(["lean"], env)).text).toBe("lean: lite");
  });

  test("board agent persists; bogus fails", async () => {
    expect((await runCommand(["board", "agent"], env)).text).toBe("board agent: auto");
    expect(await runCommand(["board", "agent", "omp"], env)).toEqual({ ok: true, text: "board agent set to omp" });
    expect((await runCommand(["board", "agent"], env)).text).toBe("board agent: omp");
    expect((await runCommand(["board", "agent", "bogus"], env)).ok).toBe(false);
    expect(readConfig(env).board.agent).toBe("omp");
  });

  test("invalid board fields fall back individually", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ board: { timeoutMinutes: -1, command: "x", openBrowser: false } }),
    );
    const c = readConfig(env);
    expect(c.board.timeoutMinutes).toBe(DEFAULT_CONFIG.board.timeoutMinutes);
    expect(c.board.command).toEqual([]);
    expect(c.board.openBrowser).toBe(false);
  });

  test("writeConfig merges board fields and writes valid JSON", async () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ board: { openBrowser: false, command: ["a", "b"] } }));
    await runCommand(["board", "agent", "claude"], env);
    const onDisk = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
    expect(onDisk.board).toEqual({ agent: "claude", command: ["a", "b"], timeoutMinutes: 60, openBrowser: false });
  });

  test("unknown command prints usage", async () => {
    const r = await runCommand(["nope"], env);
    expect(r.ok).toBe(false);
    expect(r.text).toStartWith("usage: slimstack");
    expect((await runCommand([], env)).ok).toBe(false);
  });
});
