import {afterAll, beforeAll, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {readDaemonInfo, request} from "../src/board/client.ts";
import {startDaemon, type Daemon} from "../src/board/daemon.ts";
import type {Comment, Run, Ticket} from "../src/board/types.ts";

const tmp = mkdtempSync(join(tmpdir(), "slimstack-e2e-"));
const project = join(tmp, "project");
const home = join(tmp, "home");
const fakeAgent = resolve(import.meta.dir, "fixtures", "fake-agent.ts");
let daemon: Daemon;

beforeAll(async () => {
  mkdirSync(project, {recursive: true});
  mkdirSync(home, {recursive: true});
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({board: {openBrowser: false, agent: "custom", command: [process.execPath, fakeAgent]}}),
  );
  // process.env keeps BUN_BE_BUN when the suite runs under the omp shim; runEnv keeps it because argv0 is execPath.
  daemon = await startDaemon({projectRoot: project, harness: "claude", env: {...process.env, SLIMSTACK_HOME: home}});
});

afterAll(async () => {
  await daemon.stop();
  rmSync(tmp, {recursive: true, force: true});
});

interface McpReply {
  text: string;
  isError: boolean;
}

interface View {
  tickets: Ticket[];
  comments: Comment[];
  runs: Run[];
}

async function view(): Promise<View> {
  const info = readDaemonInfo(join(project, ".slimstack", "board"))!;
  return (await request(info, "GET", "/api/state")).body as View;
}

test("one assignment runs a coder and a tester and ends in Done", async () => {
  const info = readDaemonInfo(join(project, ".slimstack", "board"))!;
  const created = await request(info, "POST", "/api/mcp", {
    tool: "create_ticket",
    args: {title: "Add greeting", instructions: "Print hi", pseudocode: "print hi", acceptanceCriteria: ["run -> hi"]},
  });
  const reply = created.body as McpReply; // /api/mcp contract
  expect(JSON.parse(reply.text).ticket).toBe(1);

  const res = await fetch(`${daemon.url}api/tickets/1`, {
    method: "PATCH",
    headers: {"x-slimstack-token": daemon.uiToken, "content-type": "application/json"},
    body: JSON.stringify({assignee: "agent"}),
  });
  expect(res.status).toBe(200);

  let v = await view();
  const deadline = Date.now() + 20_000;
  const finished = () =>
    v.tickets[0]!.status === "done" && v.runs.length === 2 && v.runs.every((r) => r.status === "succeeded");
  // Real agent subprocesses are the thing under test, so this polls the wall clock (no deterministic clock exists for them).
  while (!finished() && Date.now() < deadline) {
    await Bun.sleep(200);
    v = await view();
  }

  const log = (n: string) => {
    try {
      return readFileSync(join(project, ".slimstack", "board", "runs", `${n}.log`), "utf8");
    } catch {
      return "(no log)";
    }
  };
  expect(finished(), JSON.stringify(v.runs) + "\nR-1: " + log("R-1") + "\nR-2: " + log("R-2")).toBe(true);
  expect(v.runs.map((r) => [r.id, r.role, r.mode, r.status])).toEqual([
    ["R-1", "coder", "implement", "succeeded"],
    ["R-2", "tester", "test", "succeeded"],
  ]);
  expect(v.comments.some((c) => c.role === "coder" && c.body.startsWith("Summary:"))).toBe(true);
  expect(v.comments.some((c) => c.role === "tester" && c.kind === "test_run" && c.passed === true)).toBe(true);
  expect(log("R-1").startsWith("# R-1 coder implement T-1")).toBe(true);
});
