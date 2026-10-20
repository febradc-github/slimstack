import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BoardError, blockersNotDone, createOps, lastTestRun, openBugs, type Ops} from "../src/board/ops.ts";
import {BoardStore} from "../src/board/store.ts";
import {callTool, TOOLS} from "../src/board/tools.ts";
import type {Actor, BoardEvent, Run, AgentRole} from "../src/board/types.ts";

const USER: Actor = {kind: "user"};
const SESSION: Actor = {kind: "session"};

function makeRun(id: string, ticket: number, role: AgentRole): Run {
  return {
    id,
    ticket,
    role,
    mode: role === "tester" ? "test" : "implement",
    commentId: null,
    status: "running",
    waitingFor: [],
    token: `token-${id}`,
    pid: null,
    exitCode: null,
    mcpCalls: 0,
    createdAt: 0,
    startedAt: 0,
    endedAt: null,
    note: null,
  };
}

function runActor(id: string, ticket: number, role: AgentRole): Actor {
  return {kind: "run", run: makeRun(id, ticket, role)};
}

let root: string;
let boardDir: string;
let clock: number;
let store: BoardStore;
let ops: Ops;

function newOps(now: () => number): void {
  store = BoardStore.load(join(boardDir, "board.json"));
  ops = createOps(store, {boardDir, projectName: "proj", boardUrl: () => "http://127.0.0.1:1/", now});
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slimstack-board-"));
  boardDir = join(root, ".slimstack", "board");
  mkdirSync(join(boardDir, "runs"), {recursive: true});
  clock = 1_000_000;
  newOps(() => clock++);
});

afterEach(() => {
  rmSync(root, {recursive: true, force: true});
});

function fails(fn: () => unknown, message: string, status: BoardError["status"]): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BoardError);
    expect((e as BoardError).message).toBe(message);
    expect((e as BoardError).status).toBe(status);
    return;
  }
  throw new Error(`expected BoardError: ${message}`);
}

function mk(extra: {blockedBy?: number[]; title?: string} = {}): number {
  return ops.createTicket(USER, {
    title: extra.title ?? "A ticket",
    instructions: "do it",
    pseudocode: "p",
    acceptanceCriteria: ["x -> y"],
    blockedBy: extra.blockedBy,
  }).n;
}

/** Ticket assigned to `assignee`, moved to testing by the user. */
function inTesting(assignee: "agent" | "user" | null): number {
  const n = mk();
  ops.updateTicket(USER, n, {assignee});
  ops.moveTicket(USER, n, "testing");
  return n;
}

function passingRun(n: number): void {
  ops.addComment(runActor("R-t", n, "tester"), {ticket: n, body: "all green", kind: "test_run", passed: true});
}

function addRun(status: Run["status"], id: string, ticket: number): void {
  store.mutate((d) => {
    const r = (runActor(id, ticket, "coder") as {kind: "run"; run: Run}).run;
    r.status = status;
    d.runs.push(r);
    return {result: null, events: []};
  });
}

describe("ticket field rules", () => {
  test("title", () => {
    for (const title of ["", "   ", "x".repeat(201)]) {
      fails(() => ops.createTicket(USER, {title, instructions: "i", acceptanceCriteria: ["a"]}), "title must be 1-200 characters", 400);
    }
    const n = mk();
    fails(() => ops.updateTicket(USER, n, {title: " "}), "title must be 1-200 characters", 400);
  });

  test("instructions and acceptance criteria", () => {
    fails(() => ops.createTicket(USER, {title: "t", instructions: " ", acceptanceCriteria: ["a"]}), "instructions are required", 400);
    fails(() => ops.createTicket(USER, {title: "t", instructions: "i", acceptanceCriteria: []}), "acceptanceCriteria needs at least one item", 400);
    fails(() => ops.createTicket(USER, {title: "t", instructions: "i", acceptanceCriteria: ["  "]}), "acceptanceCriteria needs at least one item", 400);
    const n = mk();
    fails(() => ops.updateTicket(USER, n, {instructions: ""}), "instructions are required", 400);
    fails(() => ops.updateTicket(USER, n, {acceptanceCriteria: []}), "acceptanceCriteria needs at least one item", 400);
  });

  test("blockedBy: self, unknown, cycle", () => {
    fails(() => mk({blockedBy: [1]}), "T-1 cannot block itself", 400);
    const a = mk();
    fails(() => mk({blockedBy: [99]}), "blockedBy references unknown ticket T-99", 400);
    const b = mk({blockedBy: [a]});
    fails(() => ops.updateTicket(USER, a, {blockedBy: [a]}), `T-${a} cannot block itself`, 400);
    fails(() => ops.updateTicket(USER, a, {blockedBy: [b]}), "blockedBy cycle: T-1 -> T-2 -> T-1", 400);
    const c = mk({blockedBy: [b]});
    fails(() => ops.updateTicket(USER, a, {blockedBy: [c]}), "blockedBy cycle: T-1 -> T-3 -> T-2 -> T-1", 400);
    expect(ops.store.state.tickets[0]!.blockedBy).toEqual([]);
  });

  test("ticket must exist", () => {
    fails(() => ops.updateTicket(USER, 7, {title: "x"}), "T-7 not found", 404);
    fails(() => ops.moveTicket(USER, 7, "done"), "T-7 not found", 404);
    fails(() => ops.addComment(USER, {ticket: 7, body: "hi"}), "T-7 not found", 404);
    fails(() => ops.addSystemComment(7, "hi"), "T-7 not found", 404);
  });

  test("update edits fields, emits blockers_changed, and keeps assignment to the user", () => {
    const a = mk();
    const b = mk();
    const events: BoardEvent[] = [];
    store.subscribe((e) => events.push(e));
    const t = ops.updateTicket(USER, b, {title: "New", blockedBy: [a], assignee: "agent"});
    expect(t.title).toBe("New");
    expect(t.blockedBy).toEqual([a]);
    expect(t.assignee).toBe("agent");
    expect(events.map((e) => e.type)).toEqual(["blockers_changed", "assigned", "changed"]);
    const hist = store.state.history.map((h) => `${h.action}:${h.detail}`);
    expect(hist).toContain("edited:title, blockedBy");
    expect(hist).toContain("assigned:Unassigned -> Agent");
    fails(() => ops.updateTicket(USER, b, {assignee: "robot" as never}), "assignee must be user, agent, or null", 400);
  });
});

describe("comment rules", () => {
  test("body, replyTo, resolve, passed", () => {
    const n = mk();
    const other = mk();
    fails(() => ops.addComment(USER, {ticket: n, body: "  "}), "comment body is required", 400);
    fails(() => ops.addComment(USER, {ticket: n, body: "x", replyTo: 99}), "comment #99 not found on T-1", 404);
    const c = ops.addComment(USER, {ticket: other, body: "elsewhere"});
    fails(() => ops.addComment(USER, {ticket: n, body: "x", replyTo: c.id}), `comment #${c.id} not found on T-1`, 404);
    const plain = ops.addComment(USER, {ticket: n, body: "plain"});
    fails(() => ops.addComment(USER, {ticket: n, body: "x", resolve: "fixed"}), "resolve requires replyTo on a bug comment", 400);
    fails(() => ops.addComment(USER, {ticket: n, body: "x", replyTo: plain.id, resolve: "fixed"}), "resolve requires replyTo on a bug comment", 400);
    const tester = runActor("R-1", n, "tester");
    fails(() => ops.addComment(tester, {ticket: n, body: "x", kind: "test_run"}), "passed is required for test_run and only allowed there", 400);
    fails(() => ops.addComment(tester, {ticket: n, body: "x", kind: "bug", passed: true}), "passed is required for test_run and only allowed there", 400);
    fails(() => ops.addComment(USER, {ticket: n, body: "x", passed: true}), "passed is required for test_run and only allowed there", 400);
  });

  test("authorship", () => {
    const n = mk();
    const u = ops.addComment(USER, {ticket: n, body: "u"});
    const s = ops.addComment(SESSION, {ticket: n, body: "s"});
    const r = ops.addComment(runActor("R-4", n, "coder"), {ticket: n, body: "r"});
    const sys = ops.addSystemComment(n, "sys");
    expect([u.author, u.role, u.runId]).toEqual(["user", null, null]);
    expect([s.author, s.role, s.runId]).toEqual(["agent", "session", null]);
    expect([r.author, r.role, r.runId]).toEqual(["agent", "coder", "R-4"]);
    expect([sys.author, sys.kind, sys.role]).toEqual(["system", "system", null]);
  });

  test("a reply to a reply attaches to the thread root", () => {
    const n = mk();
    const root1 = ops.addComment(USER, {ticket: n, body: "root"});
    const r1 = ops.addComment(USER, {ticket: n, body: "r1", replyTo: root1.id});
    const r2 = ops.addComment(USER, {ticket: n, body: "r2", replyTo: r1.id});
    expect(r1.replyTo).toBe(root1.id);
    expect(r2.replyTo).toBe(root1.id);
  });

  test("bug starts open; tester resolve fixed / dismissed / reopen sets the root bug", () => {
    const n = mk();
    const tester = runActor("R-1", n, "tester");
    const bug = ops.addComment(tester, {ticket: n, body: "Bug: x", kind: "bug"});
    expect(bug.bugStatus).toBe("open");
    expect(openBugs(store.state, n)).toEqual([bug.id]);
    const reply = ops.addComment(tester, {ticket: n, body: "fixed", replyTo: bug.id, resolve: "fixed"});
    expect(reply.bugStatus).toBeNull();
    const bugNow = () => store.state.comments.find((c) => c.id === bug.id)!;
    expect(bugNow().bugStatus).toBe("fixed");
    ops.addComment(tester, {ticket: n, body: "no", replyTo: reply.id, resolve: "reopen"});
    expect(bugNow().bugStatus).toBe("open");
    ops.addComment(tester, {ticket: n, body: "ok", replyTo: bug.id, resolve: "dismissed"});
    expect(bugNow().bugStatus).toBe("dismissed");
    expect(openBugs(store.state, n)).toEqual([]);
  });

  test("only testers file bugs, post test_run, or resolve", () => {
    const n = mk();
    const msg = "only tester runs can file bugs, resolve bugs, or post test_run results";
    const tester = runActor("R-1", n, "tester");
    const bug = ops.addComment(tester, {ticket: n, body: "Bug", kind: "bug"});
    for (const actor of [SESSION, runActor("R-2", n, "coder"), runActor("R-3", n, "responder")]) {
      fails(() => ops.addComment(actor, {ticket: n, body: "b", kind: "bug"}), msg, 403);
      fails(() => ops.addComment(actor, {ticket: n, body: "t", kind: "test_run", passed: true}), msg, 403);
      fails(() => ops.addComment(actor, {ticket: n, body: "r", replyTo: bug.id, resolve: "fixed"}), msg, 403);
    }
    ops.addComment(USER, {ticket: n, body: "user may", replyTo: bug.id, resolve: "dismissed"});
  });
});

describe("run scope and creation", () => {
  test("runs cannot create tickets", () => {
    fails(
      () => ops.createTicket(runActor("R-1", 1, "coder"), {title: "t", instructions: "i", acceptanceCriteria: ["a"]}),
      "only the user or the interactive session can create tickets",
      403,
    );
    expect(ops.createTicket(SESSION, {title: "t", instructions: "i", acceptanceCriteria: ["a"]}).n).toBe(1);
  });

  test("a run touches only its own ticket", () => {
    const a = mk();
    const b = mk();
    const run = runActor("R-1", a, "coder");
    const msg = "run R-1 may only act on T-1";
    fails(() => ops.updateTicket(run, b, {title: "x"}), msg, 403);
    fails(() => ops.moveTicket(run, b, "in_progress"), msg, 403);
    fails(() => ops.addComment(run, {ticket: b, body: "x"}), msg, 403);
    ops.updateTicket(run, a, {title: "mine"});
    ops.moveTicket(run, a, "in_progress");
    ops.addComment(run, {ticket: a, body: "mine"});
  });

  test("agents cannot assign", () => {
    const n = mk();
    fails(() => ops.updateTicket(SESSION, n, {assignee: "agent"}), "only the user can assign tickets (board UI)", 403);
    fails(() => ops.updateTicket(runActor("R-1", n, "coder"), n, {assignee: "user"}), "only the user can assign tickets (board UI)", 403);
  });
});

describe("move rules", () => {
  test("same status is a no-op without events", () => {
    const n = mk();
    const events: BoardEvent[] = [];
    store.subscribe((e) => events.push(e));
    const rev = store.state.rev;
    ops.moveTicket(SESSION, n, "todo");
    expect(events).toEqual([]);
    expect(store.state.rev).toBe(rev);
  });

  test("agents cannot move to To Do, nor reopen Done", () => {
    const n = mk();
    ops.moveTicket(SESSION, n, "in_progress");
    fails(() => ops.moveTicket(SESSION, n, "todo"), "agents cannot move tickets back to To Do", 403);
    fails(() => ops.moveTicket(runActor("R-1", n, "coder"), n, "todo"), "agents cannot move tickets back to To Do", 403);
    ops.moveTicket(USER, n, "done");
    fails(() => ops.moveTicket(SESSION, n, "in_progress"), "only the user can reopen a Done ticket", 403);
    ops.moveTicket(USER, n, "in_progress");
    ops.moveTicket(USER, n, "todo");
  });

  test("blocked tickets cannot start, test, or finish for agents; the user may", () => {
    const a = mk();
    const b = mk();
    const c = mk({blockedBy: [a, b]});
    ops.moveTicket(USER, b, "in_progress");
    const msg = `T-${c} is blocked by T-${a} (To Do), T-${b} (In Progress)`;
    for (const to of ["in_progress", "testing", "done"] as const) {
      fails(() => ops.moveTicket(SESSION, c, to), msg, 409);
      fails(() => ops.moveTicket(runActor("R-1", c, "coder"), c, to), msg, 409);
    }
    expect(blockersNotDone(store.state, c).map((t) => t.n)).toEqual([a, b]);
    ops.moveTicket(USER, c, "in_progress");
    ops.moveTicket(USER, a, "done");
    ops.moveTicket(USER, b, "done");
    expect(blockersNotDone(store.state, c)).toEqual([]);
    ops.moveTicket(SESSION, c, "testing");
  });

  test("Done needs assignee agent", () => {
    const mine = inTesting("user");
    fails(() => ops.moveTicket(SESSION, mine, "done"), `only the user can move T-${mine} to Done (assigned to user)`, 403);
    const nobody = inTesting(null);
    fails(() => ops.moveTicket(runActor("R-1", nobody, "tester"), nobody, "done"), `only the user can move T-${nobody} to Done (unassigned)`, 403);
  });

  test("Done only from Testing", () => {
    const n = mk();
    ops.updateTicket(USER, n, {assignee: "agent"});
    ops.moveTicket(USER, n, "in_progress");
    fails(() => ops.moveTicket(SESSION, n, "done"), "agents move tickets to Done only from Testing", 409);
  });

  test("Done needs no open bug", () => {
    const n = inTesting("agent");
    const tester = runActor("R-1", n, "tester");
    const b1 = ops.addComment(tester, {ticket: n, body: "b1", kind: "bug"});
    const b2 = ops.addComment(tester, {ticket: n, body: "b2", kind: "bug"});
    passingRun(n);
    fails(() => ops.moveTicket(tester, n, "done"), `T-${n} has open bugs: #${b1.id}, #${b2.id}`, 409);
  });

  test("Done needs a passing test_run posted after entering Testing", () => {
    const n = inTesting("agent");
    const msg = `T-${n} needs a passing test_run comment posted after it entered Testing`;
    fails(() => ops.moveTicket(SESSION, n, "done"), msg, 409);
    const tester = runActor("R-1", n, "tester");
    ops.addComment(tester, {ticket: n, body: "red", kind: "test_run", passed: false});
    fails(() => ops.moveTicket(tester, n, "done"), msg, 409);
  });

  test("Done happy path and a stale passing test_run does not count", () => {
    const n = inTesting("agent");
    const tester = runActor("R-1", n, "tester");
    passingRun(n);
    expect(lastTestRun(store.state, n)?.passed).toBe(true);
    // the ticket leaves Testing and re-enters it: the earlier pass is stale
    ops.moveTicket(USER, n, "in_progress");
    ops.moveTicket(SESSION, n, "testing");
    fails(() => ops.moveTicket(tester, n, "done"), `T-${n} needs a passing test_run comment posted after it entered Testing`, 409);
    passingRun(n);
    expect(ops.moveTicket(tester, n, "done").status).toBe("done");
  });

  test("a tester resolve fixed closes the bug and unblocks Done", () => {
    const n = inTesting("agent");
    const tester = runActor("R-1", n, "tester");
    const bug = ops.addComment(tester, {ticket: n, body: "Bug", kind: "bug"});
    passingRun(n);
    fails(() => ops.moveTicket(tester, n, "done"), `T-${n} has open bugs: #${bug.id}`, 409);
    ops.addComment(tester, {ticket: n, body: "fixed", replyTo: bug.id, resolve: "fixed"});
    passingRun(n);
    expect(ops.moveTicket(tester, n, "done").status).toBe("done");
  });

  test("entering Testing stamps enteredTestingAt and emits moved", () => {
    const n = mk();
    const events: BoardEvent[] = [];
    store.subscribe((e) => events.push(e));
    const t = ops.moveTicket(SESSION, n, "testing");
    expect(t.enteredTestingAt).not.toBeNull();
    expect(events[0]).toMatchObject({type: "moved", ticket: n, from: "todo", to: "testing"});
    expect(store.state.history.at(-1)).toMatchObject({action: "moved", detail: "To Do -> Testing", actor: "agent"});
  });
});

describe("archive and clear", () => {
  test("rejected until the board is finished and quiet", () => {
    fails(() => ops.archiveBoard(USER), "board is empty", 409);
    fails(() => ops.clearBoard(USER), "board is empty", 409);
    const a = mk();
    const b = mk();
    ops.moveTicket(USER, a, "done");
    fails(() => ops.archiveBoard(USER), `board is not finished: T-${b} are not Done`, 409);
    fails(() => ops.clearBoard(USER), `board is not finished: T-${b} are not Done`, 409);
    ops.moveTicket(USER, b, "done");
    addRun("pending", "R-1", a);
    addRun("running", "R-2", b);
    fails(() => ops.archiveBoard(USER), "agent runs are still active: R-1, R-2", 409);
    fails(() => ops.clearBoard(USER), "agent runs are still active: R-1, R-2", 409);
    const msg = "only the user or the interactive session can archive or clear the board";
    fails(() => ops.archiveBoard(runActor("R-9", a, "coder")), msg, 403);
    fails(() => ops.clearBoard(runActor("R-9", a, "coder")), msg, 403);
  });

  test("archiveBoard snapshots with blank tokens, moves logs, and keeps ticket numbering", () => {
    newOps(() => new Date(2026, 9, 20, 15, 30, 0).getTime());
    const a = mk({title: "First"});
    ops.addComment(USER, {ticket: a, body: "note"});
    ops.moveTicket(USER, a, "done");
    addRun("succeeded", "R-1", a);
    writeFileSync(join(boardDir, "runs", "R-1.log"), "log text");
    writeFileSync(join(boardDir, "runs", "R-1.mcp.json"), "{}");
    const r = ops.archiveBoard(USER, "  Sprint one ");
    expect(r).toEqual({id: "20261020-153000", tickets: 1});
    const snap = JSON.parse(readFileSync(join(boardDir, "archive", r.id, "board.json"), "utf8"));
    expect(snap).toMatchObject({id: r.id, title: "Sprint one", project: "proj", ticketCount: 1});
    expect(snap.state.runs).toHaveLength(1);
    expect(snap.state.runs[0].token).toBe("");
    expect(snap.state.tickets[0].title).toBe("First");
    expect(snap.state.comments).toHaveLength(1);
    expect(readFileSync(join(boardDir, "archive", r.id, "runs", "R-1.log"), "utf8")).toBe("log text");
    expect(readdirSync(join(boardDir, "runs"))).toEqual([]);
    const s = store.state;
    expect([s.tickets.length, s.comments.length, s.runs.length]).toEqual([0, 0, 0]);
    expect(s.history).toEqual([expect.objectContaining({action: "archived", detail: r.id})]);
    expect(mk()).toBe(2);
    // same second again: suffix
    ops.moveTicket(USER, 2, "done");
    expect(ops.archiveBoard(USER).id).toBe("20261020-153000-2");
    const list = ops.listArchives();
    expect(list.map((x) => x.id).sort()).toEqual(["20261020-153000", "20261020-153000-2"]);
    expect(list.find((x) => x.id === r.id)).toMatchObject({title: "Sprint one", ticketCount: 1});
    expect(ops.listArchives().find((x) => x.id.endsWith("-2"))!.title).toBe("Board archived 2026-10-20 15:30");
    expect(ops.readArchive(r.id).state.tickets[0]!.title).toBe("First");
    fails(() => ops.readArchive("../board"), "archive not found", 404);
    fails(() => ops.readArchive("20200101-000000"), "archive not found", 404);
  });

  test("clearBoard deletes runs files and empties the board", () => {
    const a = mk();
    ops.moveTicket(USER, a, "done");
    writeFileSync(join(boardDir, "runs", "R-1.log"), "x");
    expect(ops.clearBoard(USER)).toEqual({removed: 1});
    expect(readdirSync(join(boardDir, "runs"))).toEqual([]);
    expect(store.state.tickets).toEqual([]);
    expect(store.state.history).toEqual([expect.objectContaining({action: "cleared", detail: "1 tickets"})]);
    expect(mk()).toBe(2);
  });
});

describe("BoardStore", () => {
  test("round trip", () => {
    mk();
    ops.addComment(USER, {ticket: 1, body: "hello"});
    const reloaded = BoardStore.load(join(boardDir, "board.json"));
    expect(reloaded.state).toEqual(store.state);
    expect(reloaded.warning).toBeNull();
  });

  test("corrupt board.json is renamed and an empty board loads", () => {
    const file = join(boardDir, "board.json");
    writeFileSync(file, "{not json");
    const s = BoardStore.load(file, () => 42);
    expect(s.state.tickets).toEqual([]);
    expect(s.state.nextTicket).toBe(1);
    expect(s.warning).toContain("board.json.corrupt-42");
    expect(existsSync(join(boardDir, "board.json.corrupt-42"))).toBe(true);
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, JSON.stringify({version: 2}));
    expect(BoardStore.load(file, () => 43).warning).not.toBeNull();
    expect(existsSync(join(boardDir, "board.json.corrupt-43"))).toBe(true);
  });

  test("a throwing mutation leaves state, file, and rev unchanged", () => {
    mk();
    const file = join(boardDir, "board.json");
    const before = readFileSync(file, "utf8");
    const rev = store.state.rev;
    expect(() =>
      store.mutate((d) => {
        d.tickets.length = 0;
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(store.state.rev).toBe(rev);
    expect(store.state.tickets).toHaveLength(1);
  });

  test("events are delivered in order, listener errors are logged, nested mutations queue", () => {
    const seen: string[] = [];
    const logged: string[] = [];
    store.log = (m) => logged.push(m);
    store.subscribe((e) => {
      seen.push(e.type);
      if (e.type === "commented" && seen.filter((x) => x === "commented").length === 1) ops.addSystemComment(1, "nested");
    });
    store.subscribe(() => {
      throw new Error("listener broke");
    });
    mk();
    ops.addComment(USER, {ticket: 1, body: "x"});
    expect(seen).toEqual(["changed", "commented", "changed", "commented", "changed"]);
    expect(logged.length).toBeGreaterThan(0);
    expect(store.state.comments.map((c) => c.body)).toEqual(["x", "nested"]);
  });

  test("history keeps only the newest 5000 entries", () => {
    store.mutate((d) => {
      for (let i = 0; i < 5100; i++) d.history.push({at: i, ticket: null, actor: "system", runId: null, action: "x", detail: String(i)});
      return {result: null, events: []};
    });
    expect(store.state.history).toHaveLength(5000);
    expect(store.state.history[0]!.detail).toBe("100");
  });
});

describe("callTool", () => {
  const args = (o: object) => o;

  test("create, get, list, update, move, comment, get_comments", () => {
    const created = callTool(ops, SESSION, "create_ticket", args({title: "T", instructions: "i", pseudocode: "p", acceptanceCriteria: ["a"]}));
    expect(created).toEqual({text: '{"ticket":1,"url":"http://127.0.0.1:1/#T-1"}', isError: false});
    callTool(ops, SESSION, "create_ticket", args({title: "U", instructions: "i", pseudocode: "p", acceptanceCriteria: ["a"], blockedBy: [1]}));
    const got = JSON.parse(callTool(ops, SESSION, "get_ticket", args({ticket: 2})).text);
    expect(got).toMatchObject({ticket: 2, blockedBy: [1], blockers: [{ticket: 1, title: "T", status: "todo"}], openBugs: [], lastTestRun: null, runs: []});
    const listed = JSON.parse(callTool(ops, SESSION, "list_tickets", {}).text);
    expect(listed.tickets.map((t: {ticket: number}) => t.ticket)).toEqual([1, 2]);
    ops.updateTicket(USER, 2, {assignee: "agent"});
    const filtered = JSON.parse(callTool(ops, SESSION, "list_tickets", args({assignee: "unassigned"})).text);
    expect(filtered.tickets.map((t: {ticket: number}) => t.ticket)).toEqual([1]);
    expect(JSON.parse(callTool(ops, SESSION, "list_tickets", args({status: "done"})).text).tickets).toEqual([]);
    expect(callTool(ops, SESSION, "update_ticket", args({ticket: 1, title: "T2"})).text).toBe('{"ticket":1,"updated":["title"]}');
    expect(callTool(ops, SESSION, "move_ticket", args({ticket: 1, to: "testing"})).text).toBe('{"ticket":1,"status":"testing"}');
    expect(callTool(ops, SESSION, "add_comment", args({ticket: 1, body: "hi"})).text).toBe('{"comment":1}');
    callTool(ops, SESSION, "add_comment", args({ticket: 1, body: "again"}));
    const comments = JSON.parse(callTool(ops, SESSION, "get_comments", args({ticket: 1, sinceId: 1})).text);
    expect(comments).toEqual([expect.objectContaining({id: 2, author: "agent", role: "session", kind: "message", body: "again", replyTo: null})]);
  });

  test("validation messages", () => {
    expect(callTool(ops, SESSION, "nope", {})).toEqual({text: "unknown tool: nope", isError: true});
    const msg = (name: string, a: unknown) => {
      const r = callTool(ops, SESSION, name, a);
      expect(r.isError).toBe(true);
      return r.text;
    };
    expect(msg("move_ticket", {ticket: 1, assignee: "agent", bogus: 1})).toBe("only the user can assign tickets (board UI)");
    expect(msg("update_ticket", {ticket: 1, assignee: "agent"})).toBe("only the user can assign tickets (board UI)");
    expect(msg("create_ticket", {title: "t", bogus: 1})).toBe("unknown field: bogus");
    expect(msg("create_ticket", {title: "t"})).toBe("instructions is required");
    expect(msg("get_ticket", {})).toBe("ticket is required");
    expect(msg("get_ticket", {ticket: "1"})).toBe("ticket must be integer");
    expect(msg("get_ticket", {ticket: 1.5})).toBe("ticket must be integer");
    expect(msg("create_ticket", {title: 1, instructions: "i", pseudocode: "p", acceptanceCriteria: ["a"]})).toBe("title must be string");
    expect(msg("create_ticket", {title: "t", instructions: "i", pseudocode: "p", acceptanceCriteria: "a"})).toBe("acceptanceCriteria must be string[]");
    expect(msg("create_ticket", {title: "t", instructions: "i", pseudocode: "p", acceptanceCriteria: ["a"], blockedBy: ["1"]})).toBe("blockedBy must be integer[]");
    expect(msg("move_ticket", {ticket: 1, to: "nowhere"})).toBe("to must be one of todo, in_progress, testing, done");
    expect(msg("add_comment", {ticket: 1, body: "x", passed: "yes"})).toBe("passed must be boolean");
    expect(msg("get_ticket", [])).toBe("arguments must be an object");
    expect(msg("get_ticket", {ticket: 99})).toBe("T-99 not found");
  });

  test("board errors surface as tool errors; archive and clear tools", () => {
    expect(callTool(ops, runActor("R-1", 1, "coder"), "create_ticket", {title: "t", instructions: "i", pseudocode: "p", acceptanceCriteria: ["a"]})).toEqual({
      text: "only the user or the interactive session can create tickets",
      isError: true,
    });
    expect(callTool(ops, SESSION, "archive_board", {})).toEqual({text: "board is empty", isError: true});
    mk();
    ops.moveTicket(USER, 1, "done");
    expect(JSON.parse(callTool(ops, SESSION, "archive_board", {title: "x"}).text)).toMatchObject({tickets: 1});
    mk();
    ops.moveTicket(USER, 2, "done");
    expect(callTool(ops, SESSION, "clear_board", {}).text).toBe('{"removed":1}');
  });

  test("tool list is the nine documented tools and stays small", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "create_ticket",
      "get_ticket",
      "list_tickets",
      "update_ticket",
      "move_ticket",
      "add_comment",
      "get_comments",
      "archive_board",
      "clear_board",
    ]);
    // ~2.5 chars per Claude token: 3,000 chars keeps the per-session tool cost at or under ~1,200 tokens.
    expect(JSON.stringify(TOOLS).length).toBeLessThanOrEqual(3000);
    for (const t of TOOLS) {
      for (const p of Object.values(t.inputSchema.properties)) expect(Object.keys(p)).not.toContain("description");
    }
  });
});
