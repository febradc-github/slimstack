var __esm = (fn, res, err) => () => {
  if (fn)
    try {
      res = fn(fn = 0);
    } catch (e) {
      err = [e];
    }
  if (err)
    throw err[0];
  return res;
};

// src/board/paths.ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function findProjectRoot(start) {
  const first = resolve(start);
  let dir = first;
  for (;; ) {
    if (existsSync(join(dir, ".git")))
      return dir;
    const parent = dirname(dir);
    if (parent === dir)
      return first;
    dir = parent;
  }
}
function boardDir(root) {
  return join(root, ".slimstack", "board");
}
function projectRootOf(dir) {
  return resolve(dir, "..", "..");
}
function pluginRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "slimstack")
        return dir;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("slimstack plugin root not found");
    dir = parent;
  }
}
var init_paths = () => {};

// src/board/version.ts
var VERSION = "0.1.0";

// src/board/client.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
function readDaemonInfo(dir) {
  try {
    const j = JSON.parse(readFileSync2(join2(dir, "daemon.json"), "utf8"));
    if (typeof j.pid !== "number" || typeof j.port !== "number" || typeof j.mcpToken !== "string" || j.harness !== "claude" && j.harness !== "omp" || typeof j.startedAt !== "number" || typeof j.version !== "string") {
      return null;
    }
    return j;
  } catch {
    return null;
  }
}
async function request(info, method, path, body, runToken) {
  const headers = { "x-slimstack-token": info.mcpToken };
  if (runToken)
    headers["x-slimstack-run"] = runToken;
  const init = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, init);
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, body: parsed };
}
async function health(info) {
  try {
    const r = await request(info, "GET", "/api/health");
    const b = r.body;
    if (r.status === 200 && b && b.ok === true && b.pid === info.pid)
      return b;
  } catch {}
  return null;
}
async function waitForDaemonGone(dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (existsSync2(join2(dir, "daemon.json"))) {
    if (Date.now() >= deadline)
      return false;
    await sleep(POLL_MS);
  }
  return true;
}
function launch(o) {
  const env = { ...o.runtime.env };
  for (const k of RUN_ENV_KEYS)
    delete env[k];
  const child = spawn(o.runtime.execPath, [join2(pluginRoot(), "dist", "board.mjs"), "--launch", "--project", o.projectRoot, "--harness", o.harness], { detached: true, stdio: "ignore", windowsHide: true, env });
  child.on("error", () => {});
  child.unref();
}
async function ensureDaemon(o) {
  const dir = boardDir(o.projectRoot);
  const current = readDaemonInfo(dir);
  if (current) {
    const h = await health(current);
    if (h && (h.version === VERSION || h.activeRuns > 0))
      return current;
    if (h) {
      try {
        await request(current, "POST", "/api/shutdown");
      } catch {}
      await waitForDaemonGone(dir, START_TIMEOUT_MS);
    }
  }
  launch(o);
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;; ) {
    const info = readDaemonInfo(dir);
    if (info && await health(info))
      return info;
    if (Date.now() >= deadline)
      throw new Error(`board daemon did not start within 10s; see ${join2(dir, "daemon.log")}`);
    await sleep(POLL_MS);
  }
}
var START_TIMEOUT_MS = 1e4, POLL_MS = 100, REQUEST_TIMEOUT_MS = 5000, RUN_ENV_KEYS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var init_client = __esm(() => {
  init_paths();
  RUN_ENV_KEYS = ["SLIMSTACK_RUN_TOKEN", "SLIMSTACK_RUN_ID", "SLIMSTACK_TICKET"];
});

// src/board/types.ts
var STATUS_LABEL;
var init_types = __esm(() => {
  STATUS_LABEL = { todo: "To Do", in_progress: "In Progress", testing: "Testing", done: "Done" };
});

// src/bin/mcp.ts
init_client();
import { createInterface } from "node:readline";

// src/board/ops.ts
init_types();
import { existsSync as existsSync3, mkdirSync, readdirSync, readFileSync as readFileSync3, renameSync, rmSync, writeFileSync } from "node:fs";
import { join as join3 } from "node:path";

class BoardError extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "BoardError";
  }
}
var ARCHIVE_ID_RE = /^\d{8}-\d{6}(-\d+)?$/;
var ASSIGN_ERROR = "only the user can assign tickets (board UI)";
function getTicket(state, n) {
  const t = state.tickets.find((x) => x.n === n);
  if (!t)
    throw new BoardError(`T-${n} not found`, 404);
  return t;
}
function openBugs(state, n) {
  const ids = [];
  for (const c of state.comments)
    if (c.ticket === n && c.kind === "bug" && c.bugStatus === "open")
      ids.push(c.id);
  return ids;
}
function lastTestRun(state, n) {
  for (let i = state.comments.length - 1;i >= 0; i--) {
    const c = state.comments[i];
    if (c.ticket === n && c.kind === "test_run")
      return c;
  }
  return null;
}
function blockersNotDone(state, n) {
  const out = [];
  for (const b of getTicket(state, n).blockedBy) {
    const t = state.tickets.find((x) => x.n === b);
    if (t && t.status !== "done")
      out.push(t);
  }
  return out;
}
var ASSIGNEE_LABEL = { null: "Unassigned", user: "You", agent: "Agent" };
function assigneeLabel(a) {
  return ASSIGNEE_LABEL[a === null ? "null" : a];
}
function historyActor(actor) {
  switch (actor.kind) {
    case "user":
      return { actor: "user", runId: null };
    case "session":
      return { actor: "agent", runId: null };
    case "run":
      return { actor: "agent", runId: actor.run.id };
    case "system":
      return { actor: "system", runId: null };
  }
}
function assertScope(actor, n) {
  if (actor.kind === "run" && actor.run.ticket !== n) {
    throw new BoardError(`run ${actor.run.id} may only act on T-${actor.run.ticket}`, 403);
  }
}
function cleanTitle(v) {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length < 1 || t.length > 200)
    throw new BoardError("title must be 1-200 characters", 400);
  return t;
}
function cleanInstructions(v) {
  if (typeof v !== "string" || v.trim() === "")
    throw new BoardError("instructions are required", 400);
  return v;
}
function cleanCriteria(v) {
  const items = [];
  if (Array.isArray(v)) {
    for (const s of v)
      if (typeof s === "string" && s.trim() !== "")
        items.push(s.trim());
  }
  if (items.length === 0)
    throw new BoardError("acceptanceCriteria needs at least one item", 400);
  return items;
}
function cleanPseudocode(v) {
  if (v === undefined)
    return "";
  if (typeof v !== "string")
    throw new BoardError("pseudocode must be a string", 400);
  return v;
}
function cleanBlockedBy(draft, n, v) {
  if (!Array.isArray(v))
    throw new BoardError("blockedBy must be an array of ticket numbers", 400);
  const list = [];
  for (const b of v) {
    if (typeof b !== "number" || !Number.isInteger(b))
      throw new BoardError("blockedBy must be an array of ticket numbers", 400);
    if (b === n)
      throw new BoardError(`T-${n} cannot block itself`, 400);
    if (!draft.tickets.some((t) => t.n === b))
      throw new BoardError(`blockedBy references unknown ticket T-${b}`, 400);
    if (!list.includes(b))
      list.push(b);
  }
  const path = [n];
  const seen = new Set;
  const visit = (k) => {
    const deps = k === n ? list : getTicket(draft, k).blockedBy;
    for (const b of deps) {
      if (b === n) {
        path.push(n);
        return true;
      }
      if (seen.has(b))
        continue;
      seen.add(b);
      path.push(b);
      if (visit(b))
        return true;
      path.pop();
    }
    return false;
  };
  if (visit(n))
    throw new BoardError(`blockedBy cycle: ${path.map((x) => `T-${x}`).join(" -> ")}`, 400);
  return list;
}
function pad(v, width = 2) {
  return String(v).padStart(width, "0");
}
function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
function createOps(store, o) {
  const now = o.now ?? Date.now;
  const runsDir = join3(o.boardDir, "runs");
  const archiveDir = join3(o.boardDir, "archive");
  function log(draft, actor, ticket, action, detail) {
    const h = historyActor(actor);
    draft.history.push({ at: now(), ticket, actor: h.actor, runId: h.runId, action, detail });
  }
  function pushComment(draft, actor, c) {
    const comment = {
      id: draft.nextComment++,
      ticket: c.ticket,
      author: actor.kind === "user" ? "user" : actor.kind === "system" ? "system" : "agent",
      role: actor.kind === "session" ? "session" : actor.kind === "run" ? actor.run.role : null,
      runId: actor.kind === "run" ? actor.run.id : null,
      kind: c.kind,
      body: c.body,
      replyTo: c.replyTo,
      bugStatus: c.kind === "bug" ? "open" : null,
      passed: c.passed,
      createdAt: now()
    };
    draft.comments.push(comment);
    log(draft, actor, c.ticket, "commented", `#${comment.id} ${comment.kind}`);
    return comment;
  }
  function assertFinished(draft, actor) {
    if (actor.kind === "run") {
      throw new BoardError("only the user or the interactive session can archive or clear the board", 403);
    }
    if (draft.tickets.length === 0)
      throw new BoardError("board is empty", 409);
    const open = draft.tickets.filter((t) => t.status !== "done");
    if (open.length > 0) {
      throw new BoardError(`board is not finished: ${open.map((t) => `T-${t.n}`).join(", ")} are not Done`, 409);
    }
    const active = draft.runs.filter((r) => r.status === "pending" || r.status === "running");
    if (active.length > 0)
      throw new BoardError(`agent runs are still active: ${active.map((r) => r.id).join(", ")}`, 409);
  }
  function emptyBoard(draft) {
    draft.tickets = [];
    draft.comments = [];
    draft.runs = [];
    draft.history = [];
  }
  function createTicket(actor, input) {
    if (actor.kind === "run")
      throw new BoardError("only the user or the interactive session can create tickets", 403);
    return store.mutate((draft) => {
      const n = draft.nextTicket;
      const title = cleanTitle(input.title);
      const instructions = cleanInstructions(input.instructions);
      const acceptanceCriteria = cleanCriteria(input.acceptanceCriteria);
      const pseudocode = cleanPseudocode(input.pseudocode);
      const blockedBy = input.blockedBy === undefined ? [] : cleanBlockedBy(draft, n, input.blockedBy);
      draft.nextTicket++;
      const at = now();
      const ticket = {
        n,
        title,
        instructions,
        pseudocode,
        acceptanceCriteria,
        assignee: null,
        blockedBy,
        status: "todo",
        createdAt: at,
        updatedAt: at,
        enteredTestingAt: null
      };
      draft.tickets.push(ticket);
      log(draft, actor, n, "created", title);
      return { result: ticket, events: [] };
    });
  }
  function updateTicket(actor, n, patch) {
    return store.mutate((draft) => {
      const ticket = getTicket(draft, n);
      assertScope(actor, n);
      if (patch.assignee !== undefined && actor.kind !== "user" && actor.kind !== "system")
        throw new BoardError(ASSIGN_ERROR, 403);
      const events = [];
      const edited = [];
      const next = {
        title: patch.title === undefined ? ticket.title : cleanTitle(patch.title),
        instructions: patch.instructions === undefined ? ticket.instructions : cleanInstructions(patch.instructions),
        pseudocode: patch.pseudocode === undefined ? ticket.pseudocode : cleanPseudocode(patch.pseudocode),
        acceptanceCriteria: patch.acceptanceCriteria === undefined ? ticket.acceptanceCriteria : cleanCriteria(patch.acceptanceCriteria),
        blockedBy: patch.blockedBy === undefined ? ticket.blockedBy : cleanBlockedBy(draft, n, patch.blockedBy)
      };
      let assignee = ticket.assignee;
      if (patch.assignee !== undefined) {
        if (patch.assignee !== null && patch.assignee !== "user" && patch.assignee !== "agent") {
          throw new BoardError("assignee must be user, agent, or null", 400);
        }
        assignee = patch.assignee;
      }
      for (const k of ["title", "instructions", "pseudocode", "acceptanceCriteria", "blockedBy"]) {
        if (patch[k] !== undefined && JSON.stringify(next[k]) !== JSON.stringify(ticket[k]))
          edited.push(k);
      }
      const blockersChanged = edited.includes("blockedBy");
      Object.assign(ticket, next);
      if (edited.length > 0)
        log(draft, actor, n, "edited", edited.join(", "));
      if (blockersChanged)
        events.push({ type: "blockers_changed", ticket: n });
      if (assignee !== ticket.assignee) {
        const from = ticket.assignee;
        ticket.assignee = assignee;
        log(draft, actor, n, "assigned", `${assigneeLabel(from)} -> ${assigneeLabel(assignee)}`);
        events.push({ type: "assigned", ticket: n, actor, from, to: assignee });
      }
      if (edited.length > 0 || events.length > 0)
        ticket.updatedAt = now();
      return { result: ticket, events };
    });
  }
  function moveTicket(actor, n, to) {
    if (!(to in STATUS_LABEL))
      throw new BoardError("status must be todo, in_progress, testing, or done", 400);
    const current = getTicket(store.state, n);
    assertScope(actor, n);
    if (current.status === to)
      return current;
    return store.mutate((draft) => {
      const ticket = getTicket(draft, n);
      if (actor.kind === "session" || actor.kind === "run") {
        if (to === "todo")
          throw new BoardError("agents cannot move tickets back to To Do", 403);
        if (ticket.status === "done")
          throw new BoardError("only the user can reopen a Done ticket", 403);
        const blockers = blockersNotDone(draft, n);
        if (blockers.length > 0) {
          throw new BoardError(`T-${n} is blocked by ${blockers.map((b) => `T-${b.n} (${STATUS_LABEL[b.status]})`).join(", ")}`, 409);
        }
        if (to === "done") {
          if (ticket.assignee !== "agent") {
            throw new BoardError(`only the user can move T-${n} to Done (${ticket.assignee === "user" ? "assigned to user" : "unassigned"})`, 403);
          }
          if (ticket.status !== "testing")
            throw new BoardError("agents move tickets to Done only from Testing", 409);
          const bugs = openBugs(draft, n);
          if (bugs.length > 0)
            throw new BoardError(`T-${n} has open bugs: ${bugs.map((id) => `#${id}`).join(", ")}`, 409);
          const run = lastTestRun(draft, n);
          if (!run || run.passed !== true || ticket.enteredTestingAt === null || run.createdAt < ticket.enteredTestingAt) {
            throw new BoardError(`T-${n} needs a passing test_run comment posted after it entered Testing`, 409);
          }
        }
      }
      const from = ticket.status;
      const at = now();
      ticket.status = to;
      ticket.updatedAt = at;
      if (to === "testing")
        ticket.enteredTestingAt = at;
      log(draft, actor, n, "moved", `${STATUS_LABEL[from]} -> ${STATUS_LABEL[to]}`);
      return { result: ticket, events: [{ type: "moved", ticket: n, actor, from, to }] };
    });
  }
  function addComment(actor, input) {
    return store.mutate((draft) => {
      const n = input.ticket;
      getTicket(draft, n);
      assertScope(actor, n);
      const kind = input.kind ?? "message";
      const testerRun = actor.kind === "run" && actor.run.role === "tester";
      if ((kind !== "message" || input.resolve !== undefined) && (actor.kind === "session" || actor.kind === "run" && !testerRun)) {
        throw new BoardError("only tester runs can file bugs, resolve bugs, or post test_run results", 403);
      }
      if (typeof input.body !== "string" || input.body.trim() === "")
        throw new BoardError("comment body is required", 400);
      if (input.passed !== undefined !== (kind === "test_run")) {
        throw new BoardError("passed is required for test_run and only allowed there", 400);
      }
      let root = null;
      if (input.replyTo !== undefined) {
        let cur = draft.comments.find((c) => c.id === input.replyTo && c.ticket === n);
        if (!cur)
          throw new BoardError(`comment #${input.replyTo} not found on T-${n}`, 404);
        while (cur.replyTo !== null) {
          const parentId = cur.replyTo;
          const parent = draft.comments.find((c) => c.id === parentId);
          if (!parent)
            break;
          cur = parent;
        }
        root = cur;
      }
      let bugStatus = null;
      if (input.resolve !== undefined) {
        if (!root || root.kind !== "bug")
          throw new BoardError("resolve requires replyTo on a bug comment", 400);
        bugStatus = input.resolve === "reopen" ? "open" : input.resolve;
      }
      const comment = pushComment(draft, actor, {
        ticket: n,
        body: input.body,
        kind,
        replyTo: root ? root.id : null,
        passed: input.passed ?? null
      });
      if (root && bugStatus) {
        root.bugStatus = bugStatus;
        log(draft, actor, n, "bug", `#${root.id} ${bugStatus}`);
      }
      return { result: comment, events: [{ type: "commented", ticket: n, actor, commentId: comment.id }] };
    });
  }
  function addSystemComment(n, body) {
    return store.mutate((draft) => {
      getTicket(draft, n);
      const actor = { kind: "system" };
      const comment = pushComment(draft, actor, { ticket: n, body, kind: "system", replyTo: null, passed: null });
      return { result: comment, events: [{ type: "commented", ticket: n, actor, commentId: comment.id }] };
    });
  }
  function archiveBoard(actor, title) {
    return store.mutate((draft) => {
      assertFinished(draft, actor);
      const at = new Date(now());
      const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
      let id = stamp;
      for (let k = 2;existsSync3(join3(archiveDir, id)); k++)
        id = `${stamp}-${k}`;
      const dir = join3(archiveDir, id);
      mkdirSync(join3(dir, "runs"), { recursive: true });
      const defaultTitle = `Board archived ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
      const snapshot = {
        id,
        title: title?.trim() || defaultTitle,
        archivedAt: at.getTime(),
        project: o.projectName,
        ticketCount: draft.tickets.length,
        state: { ...draft, runs: draft.runs.map((r) => ({ ...r, token: "" })) }
      };
      writeFileSync(join3(dir, "board.json"), JSON.stringify(snapshot));
      for (const f of listDir(runsDir)) {
        if (f.endsWith(".log"))
          renameSync(join3(runsDir, f), join3(dir, "runs", f));
        else if (f.endsWith(".mcp.json"))
          rmSync(join3(runsDir, f), { force: true });
      }
      const tickets = draft.tickets.length;
      emptyBoard(draft);
      log(draft, actor, null, "archived", id);
      return { result: { id, tickets }, events: [] };
    });
  }
  function clearBoard(actor) {
    return store.mutate((draft) => {
      assertFinished(draft, actor);
      for (const f of listDir(runsDir))
        rmSync(join3(runsDir, f), { recursive: true, force: true });
      const removed = draft.tickets.length;
      emptyBoard(draft);
      log(draft, actor, null, "cleared", `${removed} tickets`);
      return { result: { removed }, events: [] };
    });
  }
  function listArchives() {
    const out = [];
    for (const id of listDir(archiveDir)) {
      if (!ARCHIVE_ID_RE.test(id))
        continue;
      try {
        const s = JSON.parse(readFileSync3(join3(archiveDir, id, "board.json"), "utf8"));
        out.push({ id, title: s.title, archivedAt: s.archivedAt, ticketCount: s.ticketCount });
      } catch {}
    }
    return out.sort((a, b) => b.archivedAt - a.archivedAt || (a.id < b.id ? 1 : -1));
  }
  function readArchive(id) {
    if (!ARCHIVE_ID_RE.test(id))
      throw new BoardError("archive not found", 404);
    try {
      return JSON.parse(readFileSync3(join3(archiveDir, id, "board.json"), "utf8"));
    } catch {
      throw new BoardError("archive not found", 404);
    }
  }
  return {
    store,
    boardUrl: o.boardUrl,
    createTicket,
    updateTicket,
    moveTicket,
    addComment,
    addSystemComment,
    archiveBoard,
    clearBoard,
    listArchives,
    readArchive
  };
}

// src/board/tools.ts
function tool(name, description, properties, required) {
  return { name, description, inputSchema: { type: "object", properties, required } };
}
var STATUSES = ["todo", "in_progress", "testing", "done"];
var STR = { type: "string" };
var INT = { type: "integer" };
var INTS = { type: "array", items: { type: "integer" } };
var TOOLS = [
  tool("create_ticket", "Create a board ticket. Used by the task-planner.", {
    title: STR,
    instructions: STR,
    pseudocode: STR,
    acceptanceCriteria: { type: "array", items: { type: "string" }, minItems: 1 },
    blockedBy: INTS
  }, ["title", "instructions", "pseudocode", "acceptanceCriteria"]),
  tool("get_ticket", "Read one ticket with its blockers, open bugs, last test run, and agent runs.", { ticket: INT }, ["ticket"]),
  tool("list_tickets", "List ticket summaries, optionally filtered.", { status: { type: "string", enum: STATUSES }, assignee: { type: "string", enum: ["user", "agent", "unassigned"] } }, []),
  tool("update_ticket", "Edit title, instructions, pseudocode, acceptanceCriteria, or blockedBy. Only the user assigns tickets.", {
    ticket: INT,
    title: STR,
    instructions: STR,
    pseudocode: STR,
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    blockedBy: INTS
  }, ["ticket"]),
  tool("move_ticket", "Move a ticket to todo, in_progress, testing, or done. The server enforces blockers and Done rules.", { ticket: INT, to: { type: "string", enum: STATUSES } }, ["ticket", "to"]),
  tool("add_comment", "Comment on a ticket. replyTo threads under a comment. kind bug or test_run (with passed) and resolve (fixed, dismissed, reopen on a bug thread) are for tester agents.", {
    ticket: INT,
    body: STR,
    kind: { type: "string", enum: ["message", "bug", "test_run"] },
    replyTo: INT,
    resolve: { type: "string", enum: ["fixed", "dismissed", "reopen"] },
    passed: { type: "boolean" }
  }, ["ticket", "body"]),
  tool("get_comments", "Read a ticket's comments oldest first; sinceId returns only newer ones.", { ticket: INT, sinceId: INT }, ["ticket"]),
  tool("archive_board", "Archive the finished board (every ticket Done) and empty it. Call only when the user asked for it.", { title: STR }, []),
  tool("clear_board", "Delete every ticket of the finished board (every ticket Done). Call only when the user asked for it.", {}, [])
];
function typeProblem(key, spec, v) {
  switch (spec.type) {
    case "string":
      if (typeof v !== "string")
        return `${key} must be string`;
      if (spec.enum && !spec.enum.includes(v))
        return `${key} must be one of ${spec.enum.join(", ")}`;
      return null;
    case "integer":
      return typeof v === "number" && Number.isInteger(v) ? null : `${key} must be integer`;
    case "boolean":
      return typeof v === "boolean" ? null : `${key} must be boolean`;
    case "array":
      return Array.isArray(v) && v.every((x) => spec.items.type === "string" ? typeof x === "string" : typeof x === "number" && Number.isInteger(x)) ? null : `${key} must be ${spec.items.type}[]`;
  }
}
function validate(t, args) {
  const a = args === undefined || args === null ? {} : args;
  if (typeof a !== "object" || Array.isArray(a))
    throw new BoardError("arguments must be an object", 400);
  const props = t.inputSchema.properties;
  const keys = Object.keys(a);
  if (t.name !== "list_tickets" && keys.includes("assignee"))
    throw new BoardError("only the user can assign tickets (board UI)", 403);
  for (const k of keys)
    if (!Object.hasOwn(props, k))
      throw new BoardError(`unknown field: ${k}`, 400);
  const rec = a;
  for (const k of t.inputSchema.required)
    if (rec[k] === undefined)
      throw new BoardError(`${k} is required`, 400);
  for (const k of keys) {
    if (rec[k] === undefined)
      continue;
    const problem = typeProblem(k, props[k], rec[k]);
    if (problem)
      throw new BoardError(problem, 400);
  }
  return rec;
}
function ticketUrl(ops, n) {
  return `${ops.boardUrl()}#T-${n}`;
}
var HANDLERS = {
  create_ticket(ops, actor, a) {
    const t = ops.createTicket(actor, {
      title: a.title,
      instructions: a.instructions,
      pseudocode: a.pseudocode,
      acceptanceCriteria: a.acceptanceCriteria,
      blockedBy: a.blockedBy
    });
    return { ticket: t.n, url: ticketUrl(ops, t.n) };
  },
  get_ticket(ops, _actor, a) {
    const state = ops.store.state;
    const t = getTicket(state, a.ticket);
    const last = lastTestRun(state, t.n);
    return {
      ticket: t.n,
      title: t.title,
      status: t.status,
      assignee: t.assignee,
      instructions: t.instructions,
      pseudocode: t.pseudocode,
      acceptanceCriteria: t.acceptanceCriteria,
      blockedBy: t.blockedBy,
      blockers: t.blockedBy.map((b) => {
        const x = getTicket(state, b);
        return { ticket: x.n, title: x.title, status: x.status };
      }),
      openBugs: openBugs(state, t.n),
      lastTestRun: last ? { comment: last.id, passed: last.passed, at: last.createdAt } : null,
      runs: state.runs.filter((r) => r.ticket === t.n).map((r) => ({ id: r.id, role: r.role, mode: r.mode, status: r.status })),
      url: ticketUrl(ops, t.n)
    };
  },
  list_tickets(ops, _actor, a) {
    const state = ops.store.state;
    const want = a.assignee;
    const tickets = [];
    for (const t of state.tickets) {
      if (a.status !== undefined && t.status !== a.status)
        continue;
      if (want !== undefined && (want === "unassigned" ? t.assignee !== null : t.assignee !== want))
        continue;
      tickets.push({
        ticket: t.n,
        title: t.title,
        status: t.status,
        assignee: t.assignee,
        blockedBy: t.blockedBy,
        openBugs: openBugs(state, t.n).length
      });
    }
    return { url: ops.boardUrl(), tickets };
  },
  update_ticket(ops, actor, a) {
    const { ticket, ...patch } = a;
    ops.updateTicket(actor, ticket, patch);
    return { ticket, updated: Object.keys(patch).filter((k) => patch[k] !== undefined) };
  },
  move_ticket(ops, actor, a) {
    const t = ops.moveTicket(actor, a.ticket, a.to);
    return { ticket: t.n, status: t.status };
  },
  add_comment(ops, actor, a) {
    const c = ops.addComment(actor, {
      ticket: a.ticket,
      body: a.body,
      kind: a.kind,
      replyTo: a.replyTo,
      resolve: a.resolve,
      passed: a.passed
    });
    return { comment: c.id };
  },
  get_comments(ops, _actor, a) {
    const state = ops.store.state;
    const n = getTicket(state, a.ticket).n;
    const since = a.sinceId ?? 0;
    const out = [];
    for (const c of state.comments) {
      if (c.ticket !== n || c.id <= since)
        continue;
      out.push({
        id: c.id,
        author: c.author,
        role: c.role,
        kind: c.kind,
        body: c.body,
        replyTo: c.replyTo,
        bugStatus: c.bugStatus,
        passed: c.passed,
        at: c.createdAt
      });
    }
    return out;
  },
  archive_board(ops, actor, a) {
    const r = ops.archiveBoard(actor, a.title);
    return { archive: r.id, tickets: r.tickets };
  },
  clear_board(ops, actor) {
    return ops.clearBoard(actor);
  }
};
function callTool(ops, actor, name, args) {
  const t = TOOLS.find((x) => x.name === name);
  if (!t)
    return { text: `unknown tool: ${name}`, isError: true };
  try {
    const result = HANDLERS[name](ops, actor, validate(t, args));
    return { text: JSON.stringify(result), isError: false };
  } catch (err) {
    if (err instanceof BoardError)
      return { text: err.message, isError: true };
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`board tool ${name} failed: ${err instanceof Error ? err.stack ?? message : message}
`);
    return { text: `internal error: ${message}`, isError: true };
  }
}

// src/board/mcp-stdio.ts
var SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
function reply(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function fail(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function createMcpHandler(o) {
  return async (msg) => {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg))
      return fail(null, -32600, "Invalid Request");
    const m = msg;
    if (m.id === undefined)
      return null;
    const id = m.id;
    if (typeof m.method !== "string")
      return fail(id, -32600, "Invalid Request");
    if (m.method.startsWith("notifications/"))
      return null;
    const params = typeof m.params === "object" && m.params !== null ? m.params : {};
    switch (m.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return reply(id, {
          protocolVersion: typeof asked === "string" && SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "slimstack-board", version: o.version }
        });
      }
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, { tools: TOOLS });
      case "tools/call": {
        if (typeof params.name !== "string")
          return fail(id, -32602, "Invalid params");
        try {
          const r = await o.callTool(params.name, params.arguments);
          return reply(id, { content: [{ type: "text", text: r.text }], isError: r.isError });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return reply(id, { content: [{ type: "text", text: `internal error: ${message}` }], isError: true });
        }
      }
      default:
        return fail(id, -32601, "Method not found");
    }
  };
}

// src/bin/mcp.ts
init_paths();
function envValue(name) {
  const v = process.env[name];
  if (v === undefined || v === "" || v === name || v.startsWith("${"))
    return;
  return v;
}
var boardDirEnv = envValue("SLIMSTACK_BOARD_DIR");
var projectRoot = boardDirEnv ? projectRootOf(boardDirEnv) : findProjectRoot(envValue("CLAUDE_PROJECT_DIR") ?? process.cwd());
var harness = envValue("SLIMSTACK_HARNESS") === "omp" ? "omp" : "claude";
var runToken = envValue("SLIMSTACK_RUN_TOKEN");
var info;
async function post(current, tool, args) {
  return request(current, "POST", "/api/mcp", { tool, args: args ?? {} }, runToken);
}
async function callTool2(tool, args) {
  const fresh = () => ensureDaemon({ projectRoot, harness, runtime: { execPath: process.execPath, env: process.env } });
  try {
    info ??= await fresh();
    let r;
    try {
      r = await post(info, tool, args);
    } catch {}
    if (r === undefined || r.status === 401) {
      info = await fresh();
      r = await post(info, tool, args);
    }
    const b = r.body;
    if (r.status === 200 && b && typeof b.text === "string")
      return { text: b.text, isError: b.isError === true };
    return { text: typeof b?.error === "string" ? b.error : `board request failed (HTTP ${r.status})`, isError: true };
  } catch (err) {
    info = undefined;
    return { text: `slimstack board unavailable: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
var handle = createMcpHandler({ callTool: callTool2, version: VERSION });
var pending = new Set;
function write(message) {
  process.stdout.write(JSON.stringify(message) + `
`);
}
var rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (raw) => {
  const line = raw.replace(/\r$/, "");
  if (line.trim() === "")
    return;
  const task = (async () => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    const response = await handle(msg);
    if (response !== null)
      write(response);
  })().catch((err) => {
    process.stderr.write(`slimstack mcp: ${err instanceof Error ? err.stack ?? err.message : String(err)}
`);
  }).finally(() => {
    pending.delete(task);
  });
  pending.add(task);
});
rl.on("close", () => {
  (async () => {
    while (pending.size > 0)
      await Promise.all([...pending]);
    process.stdout.write("", () => process.exit(0));
  })();
});
