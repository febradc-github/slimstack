import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactOutput } from "../src/core/compact.ts";
import { pruneSpill, writeSpill } from "../src/core/spill.ts";
import { ensureSlimstackDir } from "../src/core/paths.ts";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "slimstack-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function opts(projectDir: string, callId = "call1") {
  return { projectDir, sessionId: "sess1", callId, stream: "stdout" as const };
}

function buildLog(): string {
  const lines: string[] = [];
  for (let i = 0; i < 5000; i++) {
    if (i === 2000 || i === 2500 || i === 3000) {
      lines.push(`error: unresolved symbol sym_${i} in module m${i}`);
    } else if (i % 100 === 7) {
      lines.push("  downloading  10%\r  downloading  50%\r  downloading 100%");
    } else if (i % 10 === 3) {
      lines.push("\x1b[32m  ok\x1b[0m cached layer");
    } else {
      lines.push(`\x1b[1m[${i}/5000]\x1b[0m compiling src/module${i}/file${i}.c`);
    }
  }
  return lines.join("\n") + "\n";
}

describe("compactOutput", () => {
  test("7,999 chars -> null, 8,000 chars is processed", () => {
    const d = tmp();
    expect(compactOutput("a".repeat(7_999), opts(d))).toBeNull();
    // all-identical lines collapse hard, so 8,000 chars passes the threshold gate and saves space
    expect(compactOutput("same line\n".repeat(800), opts(d))).not.toBeNull();
  });

  test("CRLF input leaves no carriage returns", () => {
    const d = tmp();
    const input = Array.from({ length: 900 }, (_, i) => `row ${i} some padding text here`).join("\r\n") + "\r\n";
    const r = compactOutput(input, opts(d));
    expect(r).not.toBeNull();
    expect(r!.text).not.toContain("\r");
  });

  test("5,000-line build log shrinks to <=30%, keeps errors, spills the original", () => {
    const d = tmp();
    const input = buildLog();
    const r = compactOutput(input, opts(d));
    expect(r).not.toBeNull();
    expect(r!.text.length).toBeLessThanOrEqual(input.length * 0.3);
    expect(r!.after).toBe(r!.text.length);
    expect(r!.before).toBe(input.length);
    for (const i of [2000, 2500, 3000]) expect(r!.text).toContain(`error: unresolved symbol sym_${i} in module m${i}`);
    expect(r!.text).not.toContain("\x1b");
    expect(r!.text).not.toContain("\r");
    expect(r!.text).toMatch(/\[\.\.\. \d+ lines omitted \.\.\.\]/);
    const last = r!.text.split("\n").pop()!;
    const m = /^\[slimstack: compacted (\d+)->(\d+) chars; full output: (.+)\]$/.exec(last);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(input.length);
    expect(Number(m![2])).toBe(r!.after);
    expect(m![3]).toBe(r!.spillPath);
    expect(existsSync(m![3]!)).toBe(true);
    expect(readFileSync(r!.spillPath, "utf8")).toBe(input);
  });

  test("runs of identical lines collapse to a count", () => {
    const d = tmp();
    const input = "waiting\n".repeat(2000) + "done\n";
    const r = compactOutput(input, opts(d));
    expect(r).not.toBeNull();
    expect(r!.text).toContain("waiting (x2000)");
    expect(r!.text).toContain("done");
  });

  test("JSON array keeps head, tail, and signal items", () => {
    const d = tmp();
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item number ${i}`, status: "fine" }));
    (items[200] as Record<string, unknown>).status = "error";
    (items[300] as Record<string, unknown>).note = "fatal problem";
    const input = JSON.stringify(items);
    const r = compactOutput(input, opts(d));
    expect(r).not.toBeNull();
    for (const i of [0, 1, 2, 3, 4, 498, 499, 200, 300]) expect(r!.text).toContain(`"id":${i},`);
    expect(r!.text).not.toContain('"id":100,');
    expect(r!.text).toMatch(/\/\* \d+ items omitted \*\//);
    expect(r!.text.length).toBeLessThan(input.length * 0.5);
    expect(readFileSync(r!.spillPath, "utf8")).toBe(input);
  });

  test("unwritable spill dir -> null", () => {
    const d = tmp();
    const file = join(d, "plain-file");
    writeFileSync(file, "x");
    const input = "same line\n".repeat(2000);
    expect(compactOutput(input, opts(join(file, "sub")))).toBeNull();
  });

  test("less than 10% saving -> null", () => {
    const d = tmp();
    const input = Array.from({ length: 100 }, (_, i) => `unique line ${i} ${"x".repeat(90)}`).join("\n");
    expect(input.length).toBeGreaterThan(8_000);
    expect(compactOutput(input, opts(d))).toBeNull();
  });
});

describe("spill", () => {
  test("sanitizes ids and ensures .slimstack/.gitignore", () => {
    const d = tmp();
    const p = writeSpill(d, "a/b:c", "x y", "stderr", "hello");
    expect(p).not.toBeNull();
    expect(p!).toContain("a_b_c");
    expect(p!.endsWith("x_y.stderr.txt")).toBe(true);
    expect(readFileSync(join(d, ".slimstack", ".gitignore"), "utf8").split(/\r?\n/)).toContain("*");
    ensureSlimstackDir(d);
    expect(readFileSync(join(d, ".slimstack", ".gitignore"), "utf8").split(/\r?\n/).filter((l) => l === "*").length).toBe(1);
  });

  test("pruneSpill removes only sessions older than 3 days", () => {
    const d = tmp();
    const p = writeSpill(d, "s1", "c1", "stdout", "x")!;
    expect(existsSync(p)).toBe(true);
    pruneSpill(d, Date.now() + 1000);
    expect(existsSync(p)).toBe(true);
    pruneSpill(d, Date.now() + 4 * 24 * 3600 * 1000);
    expect(existsSync(p)).toBe(false);
  });
});
