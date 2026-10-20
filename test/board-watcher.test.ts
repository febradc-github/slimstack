import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {BoardConfig} from "../src/core/config.ts";
import {BoardError, createOps, type Ops} from "../src/board/ops.ts";
import type {SpawnSpec, Spawner} from "../src/board/spawn.ts";
import {BoardStore} from "../src/board/store.ts";
import type {Actor, Run} from "../src/board/types.ts";
import {Watcher} from "../src/board/watcher.ts";

const USER: Actor = {kind: "user"};
const PLUGIN_ROOT = join(import.meta.dir, "..");
const DEAD_PID = 2_147_483_000;

interface Started {
  spec: SpawnSpec;
  onExit: (code: number | null) => void;
  killed: boolean;
}

class FakeSpawner implements Spawner {
  started: Started[] = [];
  failWith: string | null = null;

  start(spec: SpawnSpec, onExit: (code: number | null) => void): {pid: number; kill(): void} {
    if (this.failWith !== null) throw new Error(this.failWith);
    const s: Started = {spec, onExit, killed: false};
    this.started.push(s);
    return {pid: 1000 + this.started.length - 1, kill: () => void (s.killed = true)};
  }

  /** The process of the n-th start (0-based) ends. */
  exit(i: number, code: number | null = 0): void {
    this.started[i]!.onExit(code);
  }
}

interface Timer {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

let root: string;
let boardDir: string;
let store: BoardStore;
let ops: Ops;
let spawner: FakeSpawner;
let timers: Timer[];
let config: BoardConfig;
let watcher: Watcher;

function makeWatcher(): Watcher {
  return new Watcher({
    store,
    ops,
    spawner,
    projectRoot: root,
    boardDir,
    harness: "claude",
    pluginRoot: PLUGIN_ROOT,
    execPath: process.execPath,
    env: {PATH: process.env.PATH ?? "", CLAUDECODE: "1", BUN_BE_BUN: "1"},
    readConfig: () => config,
    setTimer: (fn, ms) => {
      const t: Timer = {fn, ms, cancelled: false};
      timers.push(t);
      return () => void (t.cancelled = true);
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slimstack-watcher-"));
  boardDir = join(root, ".slimstack", "board");
  mkdirSync(join(boardDir, "runs"), {recursive: true});
  store = BoardStore.load(join(boardDir, "board.json"));
  ops = createOps(store, {boardDir, projectName: "p", boardUrl: () => "http://127.0.0.1:1/"});
  spawner = new FakeSpawner();
  timers = [];
  config = {agent: "claude", command: [], timeoutMinutes: 60, openBrowser: false};
  watcher = makeWatcher();
});

afterEach(() => {
  rmSync(root, {recursive: true, force: true});
});

function mk(blockedBy: number[] = []): number {
  return ops.createTicket(USER, {title: "t", instructions: "i", pseudocode: "p", acceptanceCriteria: ["a"], blockedBy}).n;
}

function assign(n: number, to: "agent" | "user" | null): void {
  ops.updateTicket(USER, n, {assignee: to});
}

function run(id: string): Run {
  const r = store.state.runs.find((x) => x.id === id);
  if (!r) throw new Error(`no run ${id}`);
  return r;
}

function status(id: string): string {
  return run(id).status;
}

/** Actor for a running run, obtained the way the server does it. */
function actorOf(id: string): Actor {
  return watcher.actorForRunToken(run(id).token);
}

function commentsOn(n: number): string[] {
  return store.state.comments.filter((c) => c.ticket === n && c.author === "system").map((c) => c.body);
}

function historyActions(): string[] {
  return store.state.history.map((h) => h.action);
}

/** Ticket 1 in Testing with a tester run R-1 that filed bug comment #1; returns after the tester exited. */
function ticketWithTesterBug(): void {
  const n = mk();
  ops.moveTicket(USER, n, "testing");
  ops.addComment(actorOf("R-1"), {ticket: n, body: "Bug: x", kind: "bug"});
  spawner.exit(0, 0);
}

describe("triggers", () => {
  test("assigned by the user to Agent starts a coder with the full run spec", () => {
    const n = mk();
    assign(n, "agent");
    expect(spawner.started).toHaveLength(1);
    const spec = spawner.started[0]!.spec;
    expect(run("R-1")).toMatchObject({role: "coder", mode: "implement", status: "running", pid: 1000, waitingFor: []});
    expect(spec.cwd).toBe(root);
    expect(spec.argv.slice(0, 2)).toEqual(["claude", "-p"]);
    expect(spec.argv).toContain(join(boardDir, "runs", "R-1.mcp.json"));
    expect(spec.stdin).toContain("slimstack board run R-1: role coder, mode implement, ticket T-1.");
    expect(spec.stdin).toContain(join(PLUGIN_ROOT, "skills", "board", "references", "role-coder.md"));
    expect(spec.logFile).toBe(join(boardDir, "runs", "R-1.log"));
    expect(spec.header).toMatch(/^# R-1 coder implement T-1 \d{4}-/);
    expect(spec.env.SLIMSTACK_RUN_TOKEN).toBe(run("R-1").token);
    expect(spec.env.SLIMSTACK_RUN_ID).toBe("R-1");
    expect(spec.env.SLIMSTACK_TICKET).toBe("1");
    expect(spec.env.SLIMSTACK_BOARD_DIR).toBe(boardDir);
    expect(spec.env.CLAUDECODE).toBeUndefined();
    expect(spec.env.BUN_BE_BUN).toBeUndefined();
    expect(existsSync(join(boardDir, "runs", "R-1.mcp.json"))).toBe(true);
  });

  test("assigned to Agent while a bug is open queues a rework coder", () => {
    ticketWithTesterBug();
    ops.moveTicket(USER, 1, "in_progress");
    assign(1, "agent");
    expect(run("R-2")).toMatchObject({role: "coder", mode: "rework", status: "running"});
  });

  test("assigned to Agent in Testing or Done does not start a coder", () => {
    const n = mk();
    ops.moveTicket(USER, n, "testing");
    spawner.exit(0, 0);
    assign(n, "agent");
    expect(store.state.runs.filter((r) => r.role === "coder")).toHaveLength(0);
  });

  test("assigned away from Agent kills the coder and posts a system comment", () => {
    const n = mk();
    assign(n, "agent");
    assign(n, "user");
    expect(spawner.started[0]!.killed).toBe(true);
    expect(status("R-1")).toBe("cancelled");
    expect(commentsOn(n)).toContain("Agent stopped: T-1 was reassigned.");
  });

  test("moved to Testing by anyone queues a tester in mode test", () => {
    const n = mk();
    ops.moveTicket(USER, n, "testing");
    expect(run("R-1")).toMatchObject({role: "tester", mode: "test", status: "running", commentId: null});
  });

  test("moved to Testing by the coder run queues the tester, which waits for that coder to exit", () => {
    const n = mk();
    assign(n, "agent");
    ops.moveTicket(actorOf("R-1"), n, "testing");
    expect(status("R-2")).toBe("pending");
    expect(spawner.started).toHaveLength(1);
    spawner.exit(0, 0);
    expect(status("R-1")).toBe("succeeded");
    expect(status("R-2")).toBe("running");
    expect(spawner.started).toHaveLength(2);
  });

  test("moved by the user to In Progress with Agent assigned queues a coder", () => {
    const n = mk();
    assign(n, "agent");
    spawner.exit(0, 0);
    ops.moveTicket(USER, n, "in_progress");
    expect(run("R-2")).toMatchObject({role: "coder", status: "running"});
  });

  test("moved by the user to To Do stops the coder and tester with a system comment", () => {
    const n = mk();
    assign(n, "agent");
    expect(status("R-1")).toBe("running");
    ops.moveTicket(USER, n, "in_progress");
    ops.moveTicket(USER, n, "todo");
    expect(status("R-1")).toBe("cancelled");
    expect(spawner.started[0]!.killed).toBe(true);
    expect(commentsOn(n)).toContain("Agent stopped: T-1 moved to To Do.");
  });

  test("moved by the user to Done stops a running tester and says so", () => {
    const n = mk();
    ops.moveTicket(USER, n, "testing");
    ops.moveTicket(USER, n, "done");
    expect(status("R-1")).toBe("cancelled");
    expect(commentsOn(n)).toContain("Agent stopped: T-1 moved to Done.");
  });

  test("moving with no active agent run posts no 'Agent stopped' comment", () => {
    const n = mk();
    ops.moveTicket(USER, n, "in_progress");
    ops.moveTicket(USER, n, "todo");
    expect(commentsOn(n)).toEqual([]);
  });

  test("a user reply in a tester's bug thread queues a tester in mode review_reply", () => {
    ticketWithTesterBug();
    const reply = ops.addComment(USER, {ticket: 1, body: "it's fine", replyTo: 1});
    expect(run("R-2")).toMatchObject({role: "tester", mode: "review_reply", commentId: reply.id, status: "running"});
  });

  test("a user reply in a coder's thread on an Agent ticket queues a coder resume", () => {
    const n = mk();
    assign(n, "agent");
    const question = ops.addComment(actorOf("R-1"), {ticket: n, body: "Which option?"});
    spawner.exit(0, 0);
    const reply = ops.addComment(USER, {ticket: n, body: "option A", replyTo: question.id});
    expect(run("R-2")).toMatchObject({role: "coder", mode: "resume", commentId: reply.id, status: "running"});
  });

  test("a user comment on a coder thread of a ticket no longer assigned to Agent goes to the responder", () => {
    const n = mk();
    assign(n, "agent");
    const question = ops.addComment(actorOf("R-1"), {ticket: n, body: "Which option?"});
    assign(n, "user");
    ops.addComment(USER, {ticket: n, body: "option A", replyTo: question.id});
    expect(run("R-2")).toMatchObject({role: "responder", mode: "reply"});
  });

  test("a new top-level user comment queues a responder", () => {
    const n = mk();
    const c = ops.addComment(USER, {ticket: n, body: "how is this done?"});
    expect(run("R-1")).toMatchObject({role: "responder", mode: "reply", commentId: c.id, status: "running"});
  });

  test("comments by agents or the system never trigger runs", () => {
    const n = mk();
    ops.addComment({kind: "session"}, {ticket: n, body: "planner note"});
    ops.addSystemComment(n, "system note");
    expect(store.state.runs).toHaveLength(0);
  });

  test("restart queues a coder for an Agent ticket in To Do or In Progress", () => {
    const n = mk();
    assign(n, "agent");
    spawner.exit(0, 1);
    watcher.restart(n);
    expect(run("R-2")).toMatchObject({role: "coder", status: "running"});
  });

  test("restart queues a tester for a ticket in Testing", () => {
    const n = mk();
    ops.moveTicket(USER, n, "testing");
    spawner.exit(0, 1);
    watcher.restart(n);
    expect(run("R-2")).toMatchObject({role: "tester", mode: "test", status: "running"});
  });

  test("restart on a user-assigned To Do ticket is refused with 409", () => {
    const n = mk();
    assign(n, "user");
    try {
      watcher.restart(n);
      throw new Error("expected BoardError");
    } catch (e) {
      expect(e).toBeInstanceOf(BoardError);
      expect((e as BoardError).message).toBe("nothing to restart for T-1 (To Do, user)");
      expect((e as BoardError).status).toBe(409);
    }
    expect(store.state.runs).toHaveLength(0);
  });
});

describe("queue rules", () => {
  test("toggling the assignment never runs two coders on one ticket", () => {
    const n = mk();
    assign(n, "agent");
    assign(n, "user");
    assign(n, "agent");
    // R-1 was killed but its process has not exited yet, so R-2 waits.
    expect(spawner.started).toHaveLength(1);
    expect(status("R-2")).toBe("pending");
    spawner.exit(0, null);
    expect(status("R-1")).toBe("cancelled");
    expect(status("R-2")).toBe("running");
    expect(store.state.runs.filter((r) => r.status === "running")).toHaveLength(1);
  });

  test("a coder trigger is dropped while a coder run is active", () => {
    const n = mk();
    assign(n, "agent");
    watcher.restart(n);
    expect(store.state.runs).toHaveLength(1);
    expect(historyActions()).toContain("coder already active: R-1");
  });

  test("a tester test trigger is dropped while a tester test run is active", () => {
    const n = mk();
    ops.moveTicket(USER, n, "testing");
    watcher.restart(n);
    expect(store.state.runs).toHaveLength(1);
    expect(historyActions()).toContain("tester already active: R-1");
  });

  test("a reply under a running coder's comment starts its resume only after that coder exits", () => {
    const n = mk();
    assign(n, "agent");
    const question = ops.addComment(actorOf("R-1"), {ticket: n, body: "Which option?"});
    const reply = ops.addComment(USER, {ticket: n, body: "option A", replyTo: question.id});
    expect(run("R-2")).toMatchObject({mode: "resume", status: "pending", commentId: reply.id});
    expect(spawner.started).toHaveLength(1);
    spawner.exit(0, 0);
    expect(status("R-2")).toBe("running");
  });

  test("a resume is cancelled when the running coder already answered in that thread", () => {
    const n = mk();
    assign(n, "agent");
    const coder = actorOf("R-1");
    const question = ops.addComment(coder, {ticket: n, body: "Which option?"});
    ops.addComment(USER, {ticket: n, body: "option A", replyTo: question.id});
    ops.addComment(coder, {ticket: n, body: "Thanks, using A", replyTo: question.id});
    spawner.exit(0, 0);
    expect(run("R-2")).toMatchObject({status: "cancelled", note: "answered by R-1"});
    expect(spawner.started).toHaveLength(1);
  });

  test("responders on two tickets run concurrently; on one ticket they run one at a time", () => {
    const a = mk();
    const b = mk();
    ops.addComment(USER, {ticket: a, body: "q1"});
    ops.addComment(USER, {ticket: b, body: "q2"});
    ops.addComment(USER, {ticket: a, body: "q3"});
    expect(status("R-1")).toBe("running");
    expect(status("R-2")).toBe("running");
    expect(status("R-3")).toBe("pending");
    spawner.exit(0, 0);
    expect(status("R-3")).toBe("running");
  });

  test("a responder may run next to the coder of the same ticket", () => {
    const n = mk();
    assign(n, "agent");
    ops.addComment(USER, {ticket: n, body: "a question"});
    expect(status("R-1")).toBe("running");
    expect(run("R-2")).toMatchObject({role: "responder", status: "running"});
  });

  test("a blocked ticket assigned to Agent waits with waitingFor and starts when its blocker is Done", () => {
    const a = mk();
    const b = mk([a]);
    assign(b, "agent");
    expect(run("R-1")).toMatchObject({status: "pending", waitingFor: [a]});
    expect(spawner.started).toHaveLength(0);
    ops.moveTicket(USER, a, "done");
    expect(run("R-1")).toMatchObject({status: "running", waitingFor: []});
  });

  test("removing the blocker lets the waiting coder start", () => {
    const a = mk();
    const b = mk([a]);
    assign(b, "agent");
    ops.updateTicket(USER, b, {blockedBy: []});
    expect(status("R-1")).toBe("running");
  });

  test("a pending coder is cancelled when its ticket is no longer Agent's or is Done", () => {
    const system: Actor = {kind: "system"};
    const a = mk();
    const b = mk([a]);
    const c = mk([a]);
    assign(b, "agent");
    assign(c, "agent");
    ops.moveTicket(system, b, "done");
    expect(run("R-1")).toMatchObject({status: "cancelled", note: "ticket is Done"});
    ops.updateTicket(system, c, {assignee: null});
    expect(run("R-2")).toMatchObject({status: "cancelled", note: "ticket no longer assigned to Agent"});
  });

  test("moving a blocked Agent ticket to Done as the user stops its queued coder", () => {
    const a = mk();
    const b = mk([a]);
    assign(b, "agent");
    ops.moveTicket(USER, b, "done");
    expect(run("R-1")).toMatchObject({status: "cancelled", note: "Agent stopped: T-2 moved to Done."});
  });

  test("a pending tester is cancelled when the ticket leaves Testing", () => {
    const n = mk();
    assign(n, "agent");
    ops.moveTicket(actorOf("R-1"), n, "testing");
    expect(status("R-2")).toBe("pending");
    ops.moveTicket(USER, n, "in_progress");
    spawner.exit(0, 0);
    expect(run("R-2")).toMatchObject({status: "cancelled", note: "ticket left Testing"});
  });

  test("cancel stops a pending run, kills a running one, and rejects unknown ids", () => {
    const a = mk();
    const b = mk([a]);
    assign(b, "agent");
    watcher.cancel("R-1", "stopped by the user");
    expect(run("R-1")).toMatchObject({status: "cancelled", note: "stopped by the user"});
    assign(a, "agent");
    watcher.cancel("R-2", "stopped by the user");
    expect(spawner.started[0]!.killed).toBe(true);
    expect(status("R-2")).toBe("cancelled");
    expect(() => watcher.cancel("R-99", "x")).toThrow("run R-99 not found");
  });
});

describe("run lifecycle", () => {
  test("a non-zero exit marks the run failed and tells the user how to retry", () => {
    const n = mk();
    assign(n, "agent");
    spawner.exit(0, 3);
    expect(run("R-1")).toMatchObject({status: "failed", exitCode: 3});
    expect(run("R-1").endedAt).not.toBeNull();
    const [message] = commentsOn(n);
    expect(message).toMatch(/^Run R-1 \(coder, implement\) failed, exit 3, after \d+m\d+s\. Log: \.slimstack\/board\/runs\/R-1\.log\./);
    expect(message).toContain("Restart agent");
    expect(existsSync(join(boardDir, "runs", "R-1.mcp.json"))).toBe(false);
  });

  test("a clean exit without any board call is reported; one with board calls is not", () => {
    const a = mk();
    const b = mk();
    assign(a, "agent");
    assign(b, "agent");
    ops.addComment(actorOf("R-2"), {ticket: b, body: "done"});
    spawner.exit(0, 0);
    spawner.exit(1, 0);
    expect(run("R-1")).toMatchObject({status: "succeeded", mcpCalls: 0});
    expect(commentsOn(a)).toHaveLength(1);
    expect(run("R-2")).toMatchObject({status: "succeeded", mcpCalls: 1});
    expect(commentsOn(b)).toEqual([]);
  });

  test("the timeout kills the run, marks it timeout, and keeps that status after exit", () => {
    config.timeoutMinutes = 5;
    const n = mk();
    assign(n, "agent");
    const timer = timers.find((t) => t.ms === 5 * 60_000);
    expect(timer).toBeDefined();
    timer!.fn();
    expect(spawner.started[0]!.killed).toBe(true);
    expect(run("R-1")).toMatchObject({status: "timeout", note: "timed out after 5 minutes"});
    spawner.exit(0, null);
    expect(run("R-1")).toMatchObject({status: "timeout", exitCode: null});
    expect(commentsOn(n)[0]).toContain("timeout");
  });

  test("timeoutMinutes 0 arms no timer", () => {
    config.timeoutMinutes = 0;
    assign(mk(), "agent");
    expect(timers).toHaveLength(0);
  });

  test("run tokens authenticate only while the run is running", () => {
    const n = mk();
    assign(n, "agent");
    const {token} = run("R-1");
    expect(watcher.actorForRunToken(token)).toMatchObject({kind: "run", run: {id: "R-1", role: "coder", ticket: n}});
    expect(run("R-1").mcpCalls).toBe(1);
    spawner.exit(0, 0);
    expect(() => watcher.actorForRunToken(token)).toThrow("run R-1 has ended");
    expect(() => watcher.actorForRunToken("nope")).toThrow("unknown run token");
    expect(() => watcher.actorForRunToken("")).toThrow("unknown run token");
  });

  test("a cancelled run's token stops working at once", () => {
    const n = mk();
    assign(n, "agent");
    const {token} = run("R-1");
    watcher.cancel("R-1", "stopped by the user");
    expect(() => watcher.actorForRunToken(token)).toThrow("run R-1 has ended");
  });

  test("a spawn failure fails the run with the error and a system comment, then the queue continues", () => {
    spawner.failWith = "agent command not found on PATH: claude";
    const n = mk();
    assign(n, "agent");
    expect(run("R-1")).toMatchObject({status: "failed", note: "agent command not found on PATH: claude"});
    expect(commentsOn(n)[0]).toContain("could not start: agent command not found on PATH: claude");
    expect(existsSync(join(boardDir, "runs", "R-1.mcp.json"))).toBe(false);
    spawner.failWith = null;
    watcher.restart(n);
    expect(status("R-2")).toBe("running");
  });

  test("custom agent with an empty command fails the run instead of throwing", () => {
    config = {agent: "custom", command: [], timeoutMinutes: 60, openBrowser: false};
    assign(mk(), "agent");
    expect(run("R-1")).toMatchObject({status: "failed", note: 'board.agent is "custom" but board.command is empty'});
  });

  test("the config is re-read for every run", () => {
    const a = mk();
    const b = mk();
    assign(a, "agent");
    config = {agent: "custom", command: ["my-agent", "--ticket", "{ticket}", "--run={run}"], timeoutMinutes: 60, openBrowser: false};
    assign(b, "agent");
    expect(spawner.started[0]!.spec.argv[0]).toBe("claude");
    expect(spawner.started[1]!.spec.argv).toEqual(["my-agent", "--ticket", String(b), "--run=R-2"]);
  });

  test("activeRunCount counts pending and running runs", () => {
    const a = mk();
    const b = mk([a]);
    assign(a, "agent");
    assign(b, "agent");
    expect(watcher.activeRunCount()).toBe(2);
    spawner.exit(0, 0);
    expect(watcher.activeRunCount()).toBe(1);
  });

  test("stopAll cancels running runs but leaves queued ones for the next daemon", () => {
    const a = mk();
    const b = mk([a]);
    assign(a, "agent");
    assign(b, "agent");
    watcher.stopAll("board stopped");
    expect(run("R-1")).toMatchObject({status: "cancelled", note: "board stopped"});
    expect(spawner.started[0]!.killed).toBe(true);
    expect(status("R-2")).toBe("pending");
  });
});

describe("recover", () => {
  test("a run whose process is gone becomes lost with a system comment, and the queue pumps", () => {
    const n = mk();
    assign(n, "agent");
    store.mutate((d) => {
      d.runs[0]!.pid = DEAD_PID;
      return {result: undefined, events: []};
    });
    const restarted = makeWatcher();
    restarted.recover();
    expect(run("R-1")).toMatchObject({status: "lost", note: "ended while the board daemon was down; exit status unknown"});
    expect(commentsOn(n)[0]).toContain("lost");
    expect(existsSync(join(boardDir, "runs", "R-1.mcp.json"))).toBe(false);
  });

  test("a run whose process is still alive stays running and is polled", () => {
    const n = mk();
    assign(n, "agent");
    store.mutate((d) => {
      d.runs[0]!.pid = process.pid;
      return {result: undefined, events: []};
    });
    const before = timers.length;
    const restarted = makeWatcher();
    restarted.recover();
    expect(status("R-1")).toBe("running");
    expect(timers.slice(before).some((t) => t.ms === 10_000)).toBe(true);
  });

  test("an alive run that disappears is marked lost on the next poll", () => {
    assign(mk(), "agent");
    store.mutate((d) => {
      d.runs[0]!.pid = process.pid;
      return {result: undefined, events: []};
    });
    const before = timers.length;
    const restarted = makeWatcher();
    restarted.recover();
    store.mutate((d) => {
      d.runs[0]!.pid = DEAD_PID;
      return {result: undefined, events: []};
    });
    timers.slice(before).find((t) => t.ms === 10_000)!.fn();
    expect(status("R-1")).toBe("lost");
  });

  test("queued runs start when a new daemon recovers", () => {
    const a = mk();
    const b = mk([a]);
    assign(b, "agent");
    expect(status("R-1")).toBe("pending");
    // The blocker finishes while no watcher is listening (daemon was down).
    store.mutate((d) => {
      d.tickets[0]!.status = "done";
      return {result: undefined, events: []};
    });
    expect(status("R-1")).toBe("pending");
    makeWatcher().recover();
    expect(status("R-1")).toBe("running");
    expect(spawner.started).toHaveLength(1);
  });
});
