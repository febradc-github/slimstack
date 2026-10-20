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

// src/board/open-url.ts
import { spawn } from "node:child_process";
function openUrl(url) {
  try {
    const child = process.platform === "win32" ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }) : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
var init_open_url = () => {};

// src/board/types.ts
var STATUS_LABEL;
var init_types = __esm(() => {
  STATUS_LABEL = { todo: "To Do", in_progress: "In Progress", testing: "Testing", done: "Done" };
});

// src/board/paths.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "node:fs";
import { dirname, join as join3, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function findProjectRoot(start) {
  const first = resolve(start);
  let dir = first;
  for (;; ) {
    if (existsSync3(join3(dir, ".git")))
      return dir;
    const parent = dirname(dir);
    if (parent === dir)
      return first;
    dir = parent;
  }
}
function boardDir(root) {
  return join3(root, ".slimstack", "board");
}
function projectRootOf(dir) {
  return resolve(dir, "..", "..");
}
function pluginRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    try {
      const pkg = JSON.parse(readFileSync4(join3(dir, "package.json"), "utf8"));
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

// src/bin/board.ts
import { spawn as spawn3 } from "node:child_process";
import { appendFileSync as appendFileSync3, mkdirSync as mkdirSync7 } from "node:fs";
import { join as join8 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/board/daemon.ts
import {
  appendFileSync as appendFileSync2,
  closeSync as closeSync3,
  mkdirSync as mkdirSync6,
  openSync as openSync3,
  readFileSync as readFileSync7,
  renameSync as renameSync4,
  rmSync as rmSync3,
  statSync as statSync2,
  unlinkSync,
  writeFileSync as writeFileSync6,
  writeSync as writeSync2
} from "node:fs";
import { randomBytes as randomBytes2 } from "node:crypto";
import { basename, join as join7 } from "node:path";

// src/core/config.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync, writeFileSync as writeFileSync2 } from "node:fs";

// src/core/guards.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// src/core/paths.ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function homeDir(env = process.env) {
  return env.SLIMSTACK_HOME ?? join(homedir(), ".slimstack");
}
function configPath(env = process.env) {
  return join(homeDir(env), "config.json");
}
function statsPath(env = process.env) {
  return join(homeDir(env), "stats.jsonl");
}
function spillRoot(projectDir) {
  return join(projectDir, ".slimstack", "spill");
}
function ensureSlimstackDir(projectDir) {
  const dir = join(projectDir, ".slimstack");
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, `*
`);
    return;
  }
  const text = readFileSync(ignore, "utf8");
  if (!text.split(/\r?\n/).some((l) => l.trim() === "*")) {
    appendFileSync(ignore, (text.endsWith(`
`) || text === "" ? "" : `
`) + `*
`);
  }
}

// src/core/config.ts
var DEFAULT_CONFIG = {
  lean: "lite",
  compact: true,
  board: { agent: "auto", command: [], timeoutMinutes: 60, openBrowser: true }
};
var LEAN = ["off", "lite", "full"];
var AGENTS = ["auto", "claude", "omp", "custom"];
function parseBoard(raw) {
  const d = DEFAULT_CONFIG.board;
  const out = { ...d, command: [...d.command] };
  if (!isRecord(raw))
    return out;
  if (typeof raw.agent === "string" && AGENTS.includes(raw.agent))
    out.agent = raw.agent;
  if (Array.isArray(raw.command) && raw.command.every((c) => typeof c === "string" && c.length > 0)) {
    out.command = [...raw.command];
  }
  if (typeof raw.timeoutMinutes === "number" && Number.isFinite(raw.timeoutMinutes) && raw.timeoutMinutes >= 0) {
    out.timeoutMinutes = raw.timeoutMinutes;
  }
  if (typeof raw.openBrowser === "boolean")
    out.openBrowser = raw.openBrowser;
  return out;
}
function readConfig(env = process.env) {
  let raw;
  try {
    raw = JSON.parse(readFileSync2(configPath(env), "utf8"));
  } catch {
    raw = undefined;
  }
  const r = isRecord(raw) ? raw : {};
  return {
    lean: typeof r.lean === "string" && LEAN.includes(r.lean) ? r.lean : DEFAULT_CONFIG.lean,
    compact: typeof r.compact === "boolean" ? r.compact : DEFAULT_CONFIG.compact,
    board: parseBoard(r.board)
  };
}
function writeConfig(patch, env = process.env) {
  const cur = readConfig(env);
  const next = {
    lean: patch.lean ?? cur.lean,
    compact: patch.compact ?? cur.compact,
    board: { ...cur.board, ...patch.board }
  };
  mkdirSync2(homeDir(env), { recursive: true });
  const file = configPath(env);
  const tmp = file + ".tmp";
  writeFileSync2(tmp, JSON.stringify(next, null, 2) + `
`);
  renameSync(tmp, file);
  return next;
}

// src/board/daemon.ts
init_open_url();

// src/board/ops.ts
init_types();
import { existsSync as existsSync2, mkdirSync as mkdirSync3, readdirSync, readFileSync as readFileSync3, renameSync as renameSync2, rmSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join2 } from "node:path";

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
  const runsDir = join2(o.boardDir, "runs");
  const archiveDir = join2(o.boardDir, "archive");
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
      for (let k = 2;existsSync2(join2(archiveDir, id)); k++)
        id = `${stamp}-${k}`;
      const dir = join2(archiveDir, id);
      mkdirSync3(join2(dir, "runs"), { recursive: true });
      const defaultTitle = `Board archived ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
      const snapshot = {
        id,
        title: title?.trim() || defaultTitle,
        archivedAt: at.getTime(),
        project: o.projectName,
        ticketCount: draft.tickets.length,
        state: { ...draft, runs: draft.runs.map((r) => ({ ...r, token: "" })) }
      };
      writeFileSync3(join2(dir, "board.json"), JSON.stringify(snapshot));
      for (const f of listDir(runsDir)) {
        if (f.endsWith(".log"))
          renameSync2(join2(runsDir, f), join2(dir, "runs", f));
        else if (f.endsWith(".mcp.json"))
          rmSync(join2(runsDir, f), { force: true });
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
        rmSync(join2(runsDir, f), { recursive: true, force: true });
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
        const s = JSON.parse(readFileSync3(join2(archiveDir, id, "board.json"), "utf8"));
        out.push({ id, title: s.title, archivedAt: s.archivedAt, ticketCount: s.ticketCount });
      } catch {}
    }
    return out.sort((a, b) => b.archivedAt - a.archivedAt || (a.id < b.id ? 1 : -1));
  }
  function readArchive(id) {
    if (!ARCHIVE_ID_RE.test(id))
      throw new BoardError("archive not found", 404);
    try {
      return JSON.parse(readFileSync3(join2(archiveDir, id, "board.json"), "utf8"));
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

// src/board/daemon.ts
init_paths();

// src/board/server.ts
import { timingSafeEqual } from "node:crypto";
import { closeSync, fstatSync, openSync, readFileSync as readFileSync5, readSync } from "node:fs";
import { createServer } from "node:http";
import { dirname as dirname2, join as join4 } from "node:path";

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

// src/board/server.ts
var MAX_BODY = 1e6;
var LOG_TAIL_BYTES = 200000;
var PING_MS = 25000;
var STATE_HISTORY = 500;
var ARCHIVE_ID_RE2 = /^\d{8}-\d{6}(-\d+)?$/;
var RUN_ID_RE = /^R-\d+$/;
var EITHER_TOKEN_PATHS = new Set(["/api/mcp", "/api/health", "/api/state", "/api/shutdown"]);

class HttpError extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
function tokenEquals(supplied, expected) {
  if (supplied === undefined)
    return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function sendJson(res, status, body, cb) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body), cb);
}
function sendBytes(res, status, type, body, extra = {}) {
  res.writeHead(status, { "Content-Type": type, ...extra });
  res.end(body);
}
function tailFile(file, max) {
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - max);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (err) => {
      if (done)
        return;
      done = true;
      req.removeAllListeners("data");
      req.resume();
      reject(err);
    };
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY)
        return fail(new HttpError("request body too large", 413));
      chunks.push(c);
    });
    req.on("error", () => fail(new HttpError("request failed", 400)));
    req.on("end", () => {
      if (done)
        return;
      done = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "")
        return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        return reject(new HttpError("invalid JSON", 400));
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return reject(new HttpError("JSON body must be an object", 400));
      }
      resolve(parsed);
    });
  });
}
function createBoardServer(o) {
  const { ops, store, watcher } = o;
  const boardDir = dirname2(store.file);
  const user = { kind: "user" };
  const sseClients = new Set;
  let port = 0;
  let pingTimer;
  const sse = (event, data) => `event: ${event}
data: ${JSON.stringify(data)}

`;
  const broadcast = (text) => {
    for (const c of sseClients) {
      try {
        c.write(text);
      } catch {
        sseClients.delete(c);
      }
    }
  };
  const unsubscribe = store.subscribe((e) => {
    if (e.type === "changed")
      broadcast(sse("change", { rev: e.rev }));
  });
  function serveStatic(res, file, type) {
    let data;
    try {
      data = readFileSync5(join4(o.uiDir, file));
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    sendBytes(res, 200, type, data);
  }
  function serveIndex(res) {
    let html;
    try {
      html = readFileSync5(join4(o.uiDir, "index.html"), "utf8");
    } catch {
      return sendJson(res, 404, { error: "not found" });
    }
    const out = html.replace(/\{\{(TOKEN|PROJECT)\}\}/g, (_m, k) => k === "TOKEN" ? o.uiToken : escapeHtml(o.projectName));
    sendBytes(res, 200, "text/html; charset=utf-8", out, { "Cache-Control": "no-store" });
  }
  function serveLog(res, file) {
    const data = tailFile(file, LOG_TAIL_BYTES);
    if (!data)
      return sendJson(res, 404, { error: "log not found" });
    sendBytes(res, 200, "text/plain; charset=utf-8", data, { "Cache-Control": "no-store" });
  }
  function serveEvents(req, res) {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.flushHeaders();
    res.write(`retry: 2000

`);
    res.write(sse("hello", { rev: store.state.rev }));
    sseClients.add(res);
    req.on("close", () => {
      sseClients.delete(res);
    });
  }
  function stateView() {
    const s = store.state;
    return {
      rev: s.rev,
      project: o.projectName,
      url: o.url(),
      tickets: s.tickets,
      comments: s.comments,
      runs: s.runs.map(({ token: _token, ...run }) => run),
      history: s.history.slice(-STATE_HISTORY),
      allDone: s.tickets.length > 0 && s.tickets.every((t) => t.status === "done")
    };
  }
  function handleMcp(req, res, body) {
    if (typeof body.tool !== "string")
      throw new BoardError("tool is required", 400);
    const runToken = req.headers["x-slimstack-run"];
    const actor = typeof runToken === "string" && runToken !== "" ? watcher.actorForRunToken(runToken) : { kind: "session" };
    const result = callTool(ops, actor, body.tool, body.args ?? {});
    sendJson(res, 200, result);
    if (body.tool === "create_ticket" && actor.kind === "session" && !result.isError)
      o.onSessionCreate();
  }
  function route(req, res, method, path, body) {
    let m;
    if (method === "POST" && path === "/api/mcp")
      return handleMcp(req, res, body), true;
    if (method === "POST" && path === "/api/shutdown") {
      sendJson(res, 200, { ok: true }, () => o.onShutdown());
      return true;
    }
    if (method === "POST" && path === "/api/tickets") {
      sendJson(res, 200, ops.createTicket(user, body));
      return true;
    }
    if (method === "PATCH" && (m = /^\/api\/tickets\/(\d+)$/.exec(path))) {
      sendJson(res, 200, ops.updateTicket(user, Number(m[1]), body));
      return true;
    }
    if (method === "POST" && (m = /^\/api\/tickets\/(\d+)\/move$/.exec(path))) {
      if (typeof body.to !== "string")
        throw new BoardError("status must be todo, in_progress, testing, or done", 400);
      sendJson(res, 200, ops.moveTicket(user, Number(m[1]), body.to));
      return true;
    }
    if (method === "POST" && (m = /^\/api\/tickets\/(\d+)\/comments$/.exec(path))) {
      const comment = ops.addComment(user, {
        ticket: Number(m[1]),
        body: typeof body.body === "string" ? body.body : "",
        kind: "message",
        ...typeof body.replyTo === "number" ? { replyTo: body.replyTo } : {}
      });
      sendJson(res, 200, comment);
      return true;
    }
    if (method === "POST" && (m = /^\/api\/tickets\/(\d+)\/restart$/.exec(path))) {
      watcher.restart(Number(m[1]));
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "POST" && (m = /^\/api\/runs\/(R-\d+)\/cancel$/.exec(path))) {
      watcher.cancel(m[1], "stopped by the user");
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "POST" && path === "/api/board/archive") {
      sendJson(res, 200, ops.archiveBoard(user, typeof body.title === "string" ? body.title : undefined));
      return true;
    }
    if (method === "POST" && path === "/api/board/clear") {
      sendJson(res, 200, ops.clearBoard(user));
      return true;
    }
    return false;
  }
  function routeGet(req, res, path) {
    let m;
    if (path === "/api/health") {
      sendJson(res, 200, { ok: true, pid: process.pid, project: o.projectName, version: VERSION, activeRuns: watcher.activeRunCount() });
      return true;
    }
    if (path === "/api/state") {
      sendJson(res, 200, stateView());
      return true;
    }
    if (path === "/api/events") {
      serveEvents(req, res);
      return true;
    }
    if (m = /^\/api\/runs\/(R-\d+)\/log$/.exec(path)) {
      serveLog(res, join4(boardDir, "runs", `${m[1]}.log`));
      return true;
    }
    if (path === "/api/archives") {
      sendJson(res, 200, ops.listArchives());
      return true;
    }
    if (m = /^\/api\/archives\/([^/]+)$/.exec(path)) {
      sendJson(res, 200, ops.readArchive(decodeURIComponent(m[1])));
      return true;
    }
    if (m = /^\/api\/archives\/([^/]+)\/runs\/([^/]+)\/log$/.exec(path)) {
      const id = decodeURIComponent(m[1]);
      const run = decodeURIComponent(m[2]);
      if (!ARCHIVE_ID_RE2.test(id) || !RUN_ID_RE.test(run))
        throw new BoardError("log not found", 404);
      serveLog(res, join4(boardDir, "archive", id, "runs", `${run}.log`));
      return true;
    }
    return false;
  }
  async function handle(req, res) {
    o.onActivity();
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      return sendJson(res, 403, { error: "forbidden host" });
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;
    if (method === "GET" && path === "/")
      return serveIndex(res);
    if (method === "GET" && path === "/app.js")
      return serveStatic(res, "app.js", "text/javascript; charset=utf-8");
    if (method === "GET" && path === "/app.css")
      return serveStatic(res, "app.css", "text/css; charset=utf-8");
    if (!path.startsWith("/api/"))
      return sendJson(res, 404, { error: "not found" });
    const header = req.headers["x-slimstack-token"];
    let supplied = typeof header === "string" ? header : undefined;
    if (supplied === undefined && method === "GET" && path === "/api/events")
      supplied = url.searchParams.get("token") ?? undefined;
    const authorized = EITHER_TOKEN_PATHS.has(path) ? tokenEquals(supplied, o.uiToken) || tokenEquals(supplied, o.mcpToken) : tokenEquals(supplied, o.uiToken);
    if (!authorized)
      return sendJson(res, 401, { error: "unauthorized" });
    if (method === "GET") {
      if (!routeGet(req, res, path))
        sendJson(res, 404, { error: "not found" });
      return;
    }
    if (method === "POST" || method === "PATCH") {
      const body = await readBody(req);
      if (!route(req, res, method, path, body))
        sendJson(res, 404, { error: "not found" });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  }
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof BoardError || err instanceof HttpError) {
        if (err instanceof HttpError && err.status === 413)
          res.setHeader("Connection", "close");
        sendJson(res, err.status, { error: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      o.log(`request ${req.method} ${req.url} failed: ${err instanceof Error ? err.stack ?? message : message}`);
      sendJson(res, 500, { error: `internal error: ${message}` });
    });
  });
  return {
    listen(p) {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(p, "127.0.0.1", () => {
          server.off("error", reject);
          port = server.address().port;
          pingTimer ??= setInterval(() => broadcast(`: ping

`), PING_MS);
          pingTimer.unref();
          resolve(port);
        });
      });
    },
    close() {
      clearInterval(pingTimer);
      pingTimer = undefined;
      unsubscribe();
      for (const c of sseClients)
        c.end();
      sseClients.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
    sseClientCount: () => sseClients.size
  };
}

// src/board/spawn.ts
import { spawn as spawn2, spawnSync } from "node:child_process";
import { accessSync, closeSync as closeSync2, constants, mkdirSync as mkdirSync4, openSync as openSync2, statSync, writeFileSync as writeFileSync4, writeSync } from "node:fs";
import { dirname as dirname3, join as join5, resolve as resolve2 } from "node:path";
var PRESETS = {
  claude: ["claude", "-p", "--mcp-config", "{mcpConfig}", "--strict-mcp-config", "--permission-mode", "bypassPermissions"],
  omp: ["omp", "-p", "--no-title", "--approval-mode", "yolo"]
};
function resolveAgentArgv(config, harness, execPath = process.execPath) {
  if (config.agent === "custom") {
    if (config.command.length === 0)
      throw new Error('board.agent is "custom" but board.command is empty');
    return [...config.command];
  }
  const which = config.agent === "auto" ? harness : config.agent;
  if (which === "claude")
    return [...PRESETS.claude];
  const argv = [...PRESETS.omp];
  if (/^omp(\.exe)?$/i.test(execPath.slice(Math.max(execPath.lastIndexOf("/"), execPath.lastIndexOf("\\")) + 1)))
    argv[0] = execPath;
  return argv;
}
var PLACEHOLDER_RE = /\{(mcpConfig|ticket|run|role|cwd|prompt)\}/g;
function expandArgv(argv, vars) {
  let promptInArgv = false;
  const out = argv.map((arg) => arg.replace(PLACEHOLDER_RE, (_m, name) => {
    if (name === "prompt")
      promptInArgv = true;
    return vars[name];
  }));
  return { argv: out, stdin: promptInArgv ? "" : vars.prompt };
}
function buildPrompt(run, roleFile) {
  return `slimstack board run ${run.id}: role ${run.role}, mode ${run.mode}, ticket T-${run.ticket}` + (run.commentId !== null ? `, comment #${run.commentId}` : "") + `.
` + `Read ${roleFile} and follow it exactly.
` + "Use only the slimstack board tools for board reads and writes; never open files under .slimstack/board.";
}
function runEnv(base, o) {
  const win = process.platform === "win32";
  const a0 = resolve2(o.argv0);
  const e0 = resolve2(o.execPath);
  const keepBun = o.custom && (win ? a0.toLowerCase() === e0.toLowerCase() : a0 === e0);
  const out = {};
  for (const key of Object.keys(base)) {
    const value = base[key];
    if (value === undefined)
      continue;
    const k = win ? key.toUpperCase() : key;
    if (k === "CLAUDECODE" || k === "CLAUDE_CODE_ENTRYPOINT")
      continue;
    if (k === "BUN_BE_BUN" && !keepBun)
      continue;
    out[key] = value;
  }
  out.SLIMSTACK_BOARD_DIR = o.boardDir;
  out.SLIMSTACK_RUN_TOKEN = o.run.token;
  out.SLIMSTACK_RUN_ID = o.run.id;
  out.SLIMSTACK_TICKET = String(o.run.ticket);
  return out;
}
function writeRunMcpConfig(file, o) {
  const env = {
    SLIMSTACK_BOARD_DIR: o.boardDir,
    SLIMSTACK_RUN_TOKEN: o.token,
    SLIMSTACK_HARNESS: o.harness
  };
  if (o.daemonEnv.BUN_BE_BUN === "1")
    env.BUN_BE_BUN = "1";
  const config = {
    mcpServers: {
      "slimstack-board": {
        type: "stdio",
        command: o.execPath,
        args: [join5(o.pluginRoot, "dist", "mcp.mjs")],
        env
      }
    }
  };
  writeFileSync4(file, JSON.stringify(config), { mode: 384 });
}
function isFile(p, posixExec) {
  try {
    if (!statSync(p).isFile())
      return false;
    if (posixExec)
      accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
var UNSAFE_CMD_ARG = /["&|<>^%!]/;
function resolveCommand(cmd, args, env, platform = process.platform) {
  const win = platform === "win32";
  let file;
  if (cmd.includes("/") || cmd.includes("\\")) {
    file = cmd;
  } else {
    const dirs = (win ? env.Path ?? env.PATH ?? "" : env.PATH ?? "").split(win ? ";" : ":").map((d) => win ? d.replace(/^"|"$/g, "") : d).filter((d) => d !== "");
    const exts = win ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "") : [];
    const lowerExts = exts.map((e) => e.toLowerCase());
    const dot = cmd.lastIndexOf(".");
    const names = [];
    if (!win || dot > 0 && lowerExts.includes(cmd.slice(dot).toLowerCase()))
      names.push(cmd);
    for (const e of exts)
      names.push(cmd + e);
    let found = null;
    search:
      for (const dir of dirs) {
        for (const name of names) {
          const candidate = join5(dir, name);
          if (isFile(candidate, !win)) {
            found = candidate;
            break search;
          }
        }
      }
    if (found === null)
      throw new Error(`agent command not found on PATH: ${cmd}`);
    file = found;
  }
  if (win && /\.(cmd|bat)$/i.test(file)) {
    for (const a of args) {
      if (UNSAFE_CMD_ARG.test(a))
        throw new Error(`argument not safe for cmd.exe: ${a}`);
    }
    const line = [file, ...args].map((a) => '"' + a + '"').join(" ");
    return { file: env.ComSpec ?? env.COMSPEC ?? "cmd.exe", args: ["/d", "/s", "/c", '"' + line + '"'], verbatim: true };
  }
  return { file, args, verbatim: false };
}
var realSpawner = {
  start(spec, onExit) {
    const { file, args, verbatim } = resolveCommand(spec.argv[0], spec.argv.slice(1), spec.env);
    mkdirSync4(dirname3(spec.logFile), { recursive: true });
    const fd = openSync2(spec.logFile, "a");
    let fdOpen = true;
    const log = (text) => {
      if (!fdOpen)
        return;
      try {
        if (typeof text === "string")
          writeSync(fd, text);
        else
          writeSync(fd, text);
      } catch {}
    };
    log(spec.header.replace(/\n$/, "") + `
# argv: ` + spec.argv.join(" ") + `
`);
    let exited = false;
    let finished = false;
    const finish = (code) => {
      if (finished)
        return;
      finished = true;
      exited = true;
      if (fdOpen) {
        fdOpen = false;
        try {
          closeSync2(fd);
        } catch {}
      }
      onExit(code);
    };
    const child = spawn2(file, args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      windowsVerbatimArguments: verbatim
    });
    child.stdout.on("data", (c) => log(c));
    child.stderr.on("data", (c) => log(c));
    child.stdin.on("error", () => {});
    if (spec.stdin !== "")
      child.stdin.write(spec.stdin);
    child.stdin.end();
    child.on("error", (err) => {
      log(`# spawn error: ${err.message}
`);
      finish(null);
    });
    child.on("close", (code) => finish(code));
    child.on("exit", (code) => {
      setTimeout(() => finish(code), 2000).unref();
    });
    return {
      pid: child.pid ?? null,
      kill() {
        const pid = child.pid;
        if (pid === undefined || exited)
          return;
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
          return;
        }
        try {
          process.kill(-pid, "SIGTERM");
        } catch (e) {
          if (e.code !== "ESRCH")
            child.kill("SIGTERM");
          return;
        }
        setTimeout(() => {
          if (exited)
            return;
          try {
            process.kill(-pid, "SIGKILL");
          } catch (e) {
            if (e.code !== "ESRCH")
              child.kill("SIGKILL");
          }
        }, 5000).unref();
      }
    };
  }
};

// src/board/store.ts
import { mkdirSync as mkdirSync5, readFileSync as readFileSync6, renameSync as renameSync3, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname4 } from "node:path";
var HISTORY_CAP = 5000;
var RETRY_CODES = { EPERM: true, EBUSY: true, EACCES: true };
var RETRIES = 5;
var RETRY_MS = 20;
function emptyState() {
  return { version: 1, rev: 0, nextTicket: 1, nextComment: 1, nextRun: 1, tickets: [], comments: [], runs: [], history: [] };
}
function withRetry(fn) {
  for (let attempt = 0;; attempt++) {
    try {
      return fn();
    } catch (err) {
      const code = err.code;
      if (attempt >= RETRIES || !code || !RETRY_CODES[code])
        throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_MS);
    }
  }
}
function isState(v) {
  if (typeof v !== "object" || v === null)
    return false;
  const s = v;
  return s.version === 1 && Number.isFinite(s.rev) && Number.isFinite(s.nextTicket) && Number.isFinite(s.nextComment) && Number.isFinite(s.nextRun) && Array.isArray(s.tickets) && Array.isArray(s.comments) && Array.isArray(s.runs) && Array.isArray(s.history);
}

class BoardStore {
  file;
  current;
  warning;
  log = (m) => {
    process.stderr.write(m + `
`);
  };
  listeners = new Set;
  queue = [];
  draining = false;
  constructor(file, current, warning) {
    this.file = file;
    this.current = current;
    this.warning = warning;
  }
  static load(file, now = Date.now) {
    let raw;
    try {
      raw = readFileSync6(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT")
        return new BoardStore(file, emptyState(), null);
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (isState(parsed))
      return new BoardStore(file, parsed, null);
    const aside = `${file}.corrupt-${now()}`;
    withRetry(() => renameSync3(file, aside));
    return new BoardStore(file, emptyState(), `board.json was unreadable or not version 1; moved to ${aside}`);
  }
  get state() {
    return this.current;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  mutate(fn) {
    const draft = structuredClone(this.current);
    const { result, events } = fn(draft);
    draft.rev++;
    if (draft.history.length > HISTORY_CAP)
      draft.history.splice(0, draft.history.length - HISTORY_CAP);
    this.persist(draft);
    this.current = draft;
    for (const e of events)
      this.queue.push(e);
    this.queue.push({ type: "changed", rev: draft.rev });
    this.drain();
    return result;
  }
  persist(state) {
    mkdirSync5(dirname4(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    withRetry(() => writeFileSync5(tmp, JSON.stringify(state)));
    withRetry(() => renameSync3(tmp, this.file));
  }
  drain() {
    if (this.draining)
      return;
    this.draining = true;
    try {
      let e;
      while ((e = this.queue.shift()) !== undefined) {
        for (const listener of this.listeners) {
          try {
            listener(e);
          } catch (err) {
            this.log(`board listener error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
          }
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
// src/board/watcher.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rmSync as rmSync2 } from "node:fs";
import { join as join6 } from "node:path";
init_types();
var POLL_MS = 1e4;
var LOST_NOTE = "ended while the board daemon was down; exit status unknown";
var defaultTimer = (fn, ms) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function killPid(pid) {
  try {
    if (process.platform === "win32") {
      spawnSync2("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}
function isActive(r) {
  return r.status === "pending" || r.status === "running";
}
function duration(from, to) {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

class Watcher {
  o;
  store;
  ops;
  now;
  setTimer;
  handles = new Map;
  timeouts = new Map;
  orphans = new Set;
  cancelPoll = null;
  pumping = false;
  again = false;
  constructor(o) {
    this.o = o;
    this.store = o.store;
    this.ops = o.ops;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? defaultTimer;
    this.store.subscribe((e) => this.onEvent(e));
  }
  recover() {
    for (const run of this.store.state.runs.filter((r) => r.status === "running")) {
      if (run.pid !== null && isAlive(run.pid))
        this.adopt(run);
      else
        this.markLost(run.id);
    }
    this.pump();
  }
  activeRunCount() {
    return this.store.state.runs.filter(isActive).length;
  }
  actorForRunToken(token) {
    const run = this.store.state.runs.find((r) => r.token === token);
    if (!run || token === "")
      throw new BoardError("unknown run token", 403);
    if (run.status !== "running")
      throw new BoardError(`run ${run.id} has ended`, 403);
    const updated = this.store.mutate((draft) => {
      const r = draft.runs.find((x) => x.id === run.id);
      r.mcpCalls++;
      return { result: r, events: [] };
    });
    return { kind: "run", run: updated };
  }
  cancel(runId, note) {
    const run = this.store.state.runs.find((r) => r.id === runId);
    if (!run)
      throw new BoardError(`run ${runId} not found`, 404);
    if (run.status === "pending") {
      this.patchRun(runId, (r) => {
        r.status = "cancelled";
        r.note = note;
        r.endedAt = this.now();
      }, `${runId} cancelled`, note);
      this.pump();
      return;
    }
    if (run.status !== "running")
      return;
    this.patchRun(runId, (r) => {
      r.status = "cancelled";
      r.note = note;
    }, `${runId} cancelled`, note);
    this.killRun(run);
    this.pump();
  }
  stopAll(note) {
    for (const run of this.store.state.runs.filter((r) => r.status === "running"))
      this.cancel(run.id, note);
    this.cancelPoll?.();
    this.cancelPoll = null;
  }
  restart(n) {
    const ticket = this.store.state.tickets.find((t) => t.n === n);
    if (!ticket)
      throw new BoardError(`T-${n} not found`, 404);
    if ((ticket.status === "todo" || ticket.status === "in_progress") && ticket.assignee === "agent") {
      this.queueCoder(n);
    } else if (ticket.status === "testing") {
      this.queueTester(n);
    } else {
      throw new BoardError(`nothing to restart for T-${n} (${STATUS_LABEL[ticket.status]}, ${ticket.assignee ?? "unassigned"})`, 409);
    }
  }
  onEvent(e) {
    switch (e.type) {
      case "assigned": {
        if (e.actor.kind === "user") {
          const ticket = this.store.state.tickets.find((t) => t.n === e.ticket);
          if (e.to === "agent" && ticket && (ticket.status === "todo" || ticket.status === "in_progress"))
            this.queueCoder(e.ticket);
          if (e.from === "agent" && e.to !== "agent")
            this.stopTicket(e.ticket, ["coder"], `Agent stopped: T-${e.ticket} was reassigned.`);
        }
        this.pump();
        return;
      }
      case "moved": {
        if (e.to === "testing")
          this.queueTester(e.ticket);
        if (e.actor.kind === "user") {
          const ticket = this.store.state.tickets.find((t) => t.n === e.ticket);
          if (e.to === "in_progress" && ticket?.assignee === "agent")
            this.queueCoder(e.ticket);
          if (e.to === "todo" || e.to === "done") {
            this.stopTicket(e.ticket, ["coder", "tester"], `Agent stopped: T-${e.ticket} moved to ${STATUS_LABEL[e.to]}.`);
          }
        }
        this.pump();
        return;
      }
      case "commented":
        if (e.actor.kind === "user")
          this.onUserComment(e.ticket, e.commentId);
        return;
      case "blockers_changed":
        this.pump();
        return;
      case "changed":
        return;
    }
  }
  onUserComment(n, commentId) {
    const s = this.store.state;
    const comment = s.comments.find((c) => c.id === commentId);
    const ticket = s.tickets.find((t) => t.n === n);
    if (!comment || !ticket)
      return;
    const root = comment.replyTo === null ? comment : s.comments.find((c) => c.id === comment.replyTo) ?? comment;
    if (root.author === "agent" && root.role === "tester")
      this.enqueue(n, "tester", "review_reply", commentId);
    else if (root.author === "agent" && root.role === "coder" && ticket.assignee === "agent")
      this.enqueue(n, "coder", "resume", commentId);
    else
      this.enqueue(n, "responder", "reply", commentId);
  }
  stopTicket(n, roles, message) {
    const runs = this.store.state.runs.filter((r) => r.ticket === n && isActive(r) && roles.includes(r.role));
    if (runs.length === 0)
      return;
    for (const run of runs)
      this.cancel(run.id, message);
    this.ops.addSystemComment(n, message);
  }
  queueCoder(n) {
    const active = this.store.state.runs.find((r) => r.ticket === n && r.role === "coder" && isActive(r));
    if (active) {
      this.note(n, `coder already active: ${active.id}`);
      return;
    }
    this.enqueue(n, "coder", openBugs(this.store.state, n).length > 0 ? "rework" : "implement", null);
  }
  queueTester(n) {
    const active = this.store.state.runs.find((r) => r.ticket === n && r.role === "tester" && r.mode === "test" && isActive(r));
    if (active) {
      this.note(n, `tester already active: ${active.id}`);
      return;
    }
    this.enqueue(n, "tester", "test", null);
  }
  enqueue(ticket, role, mode, commentId) {
    this.store.mutate((draft) => {
      const run = {
        id: `R-${draft.nextRun++}`,
        ticket,
        role,
        mode,
        commentId,
        status: "pending",
        waitingFor: role === "coder" ? blockersNotDone(draft, ticket).map((t) => t.n) : [],
        token: randomBytes(24).toString("hex"),
        pid: null,
        exitCode: null,
        mcpCalls: 0,
        createdAt: this.now(),
        startedAt: null,
        endedAt: null,
        note: null
      };
      draft.runs.push(run);
      this.log(draft, ticket, run.id, `${run.id} ${role} ${mode} queued`);
      return { result: run, events: [] };
    });
    this.pump();
  }
  pump() {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        for (const id of this.store.state.runs.filter((r) => r.status === "pending").map((r) => r.id))
          this.consider(id);
      } while (this.again);
    } finally {
      this.pumping = false;
    }
  }
  cancelPending(id, note) {
    this.patchRun(id, (r) => {
      r.status = "cancelled";
      r.note = note;
      r.endedAt = this.now();
    }, `${id} cancelled`, note);
  }
  consider(id) {
    const s = this.store.state;
    const run = s.runs.find((r) => r.id === id);
    if (!run || run.status !== "pending")
      return;
    const ticket = s.tickets.find((t) => t.n === run.ticket);
    if (!ticket)
      return this.cancelPending(id, "ticket no longer exists");
    if (run.role === "coder") {
      if (ticket.status === "done")
        return this.cancelPending(id, "ticket is Done");
      if (ticket.assignee !== "agent")
        return this.cancelPending(id, "ticket no longer assigned to Agent");
      if (run.mode === "resume") {
        const answered = this.answeredBy(s, run);
        if (answered)
          return this.cancelPending(id, `answered by ${answered}`);
      }
      const waiting = blockersNotDone(s, ticket.n).map((t) => t.n);
      if (waiting.length !== run.waitingFor.length || waiting.some((v, i) => v !== run.waitingFor[i])) {
        this.patchRun(id, (r) => void (r.waitingFor = waiting), `${id} waiting`, waiting.map((n) => `T-${n}`).join(", "));
      }
      if (waiting.length > 0)
        return;
    } else if (run.role === "tester" && run.mode === "test" && ticket.status !== "testing") {
      return this.cancelPending(id, "ticket left Testing");
    }
    const busy = s.runs.some((r) => r.id !== id && r.ticket === run.ticket && (r.status === "running" || this.handles.has(r.id)) && run.role === "responder" === (r.role === "responder"));
    if (busy)
      return;
    this.start(run);
  }
  answeredBy(s, run) {
    const trigger = s.comments.find((c) => c.id === run.commentId);
    if (!trigger)
      return null;
    const rootId = trigger.replyTo ?? trigger.id;
    const answer = s.comments.find((c) => c.ticket === run.ticket && (c.id === rootId || c.replyTo === rootId) && c.id > trigger.id && c.author === "agent" && c.role === "coder" && c.runId !== null);
    return answer?.runId ?? null;
  }
  start(run) {
    const cfg = this.o.readConfig();
    const mcpFile = join6(this.o.boardDir, "runs", `${run.id}.mcp.json`);
    let handle;
    let started = false;
    const early = {};
    try {
      const template = resolveAgentArgv(cfg, this.o.harness, this.o.execPath);
      writeRunMcpConfig(mcpFile, {
        boardDir: this.o.boardDir,
        token: run.token,
        harness: this.o.harness,
        pluginRoot: this.o.pluginRoot,
        execPath: this.o.execPath,
        daemonEnv: this.o.env
      });
      const roleFile = join6(this.o.pluginRoot, "skills", "board", "references", `role-${run.role}.md`);
      const { argv, stdin } = expandArgv(template, {
        mcpConfig: mcpFile,
        ticket: String(run.ticket),
        run: run.id,
        role: run.role,
        cwd: this.o.projectRoot,
        prompt: buildPrompt(run, roleFile)
      });
      handle = this.o.spawner.start({
        argv,
        cwd: this.o.projectRoot,
        env: runEnv(this.o.env, { run, boardDir: this.o.boardDir, argv0: argv[0], execPath: this.o.execPath, custom: cfg.agent === "custom" }),
        stdin,
        logFile: join6(this.o.boardDir, "runs", `${run.id}.log`),
        header: `# ${run.id} ${run.role} ${run.mode} T-${run.ticket} ${new Date(this.now()).toISOString()}`
      }, (code) => {
        if (started)
          this.onExit(run.id, code);
        else
          early.code = code;
      });
    } catch (e) {
      rmSync2(mcpFile, { force: true });
      this.failToStart(run, e instanceof Error ? e.message : String(e));
      return;
    }
    started = true;
    this.handles.set(run.id, handle);
    this.patchRun(run.id, (r) => {
      r.status = "running";
      r.startedAt = this.now();
      r.pid = handle.pid;
      r.waitingFor = [];
    }, `${run.id} ${run.role} ${run.mode} started`);
    if (cfg.timeoutMinutes > 0) {
      this.timeouts.set(run.id, this.setTimer(() => this.onTimeout(run.id, cfg.timeoutMinutes), cfg.timeoutMinutes * 60000));
    }
    if ("code" in early)
      this.onExit(run.id, early.code ?? null);
  }
  failToStart(run, message) {
    this.patchRun(run.id, (r) => {
      r.status = "failed";
      r.note = message;
      r.endedAt = this.now();
    }, `${run.id} failed`, message);
    this.ops.addSystemComment(run.ticket, `Run ${run.id} (${run.role}, ${run.mode}) could not start: ${message}. Use Restart agent in the ticket's Agent runs tab to try again.`);
  }
  onTimeout(id, minutes) {
    this.timeouts.delete(id);
    const run = this.store.state.runs.find((r) => r.id === id);
    if (!run || run.status !== "running")
      return;
    this.patchRun(id, (r) => {
      r.status = "timeout";
      r.note = `timed out after ${minutes} minutes`;
    }, `${id} timeout`, `after ${minutes} minutes`);
    this.killRun(run);
    if (this.orphans.has(id))
      this.markEnded(id);
  }
  killRun(run) {
    const handle = this.handles.get(run.id);
    if (handle)
      handle.kill();
    else if (run.pid !== null) {
      killPid(run.pid);
      if (this.orphans.has(run.id))
        this.markEnded(run.id);
    }
  }
  markEnded(id) {
    this.orphans.delete(id);
    this.timeouts.get(id)?.();
    this.timeouts.delete(id);
    rmSync2(join6(this.o.boardDir, "runs", `${id}.mcp.json`), { force: true });
    this.patchRun(id, (r) => void (r.endedAt ??= this.now()), `${id} ${this.store.state.runs.find((r) => r.id === id)?.status ?? "ended"}`);
    this.pump();
  }
  onExit(id, code) {
    this.timeouts.get(id)?.();
    this.timeouts.delete(id);
    this.handles.delete(id);
    rmSync2(join6(this.o.boardDir, "runs", `${id}.mcp.json`), { force: true });
    const at = this.now();
    const run = this.patchRun(id, (r) => {
      if (r.status === "running")
        r.status = code === 0 ? "succeeded" : "failed";
      r.exitCode = code;
      r.endedAt ??= at;
    }, `${id} ended`, `exit ${code ?? "unknown"}`);
    if (run && (run.status !== "succeeded" || run.mcpCalls === 0)) {
      this.ops.addSystemComment(run.ticket, `Run ${run.id} (${run.role}, ${run.mode}) ${run.status}, exit ${code ?? "unknown"}, after ${duration(run.startedAt ?? run.createdAt, at)}. Log: .slimstack/board/runs/${run.id}.log. Use Restart agent in the ticket's Agent runs tab to try again.`);
    }
    this.pump();
  }
  adopt(run) {
    this.orphans.add(run.id);
    const minutes = this.o.readConfig().timeoutMinutes;
    if (minutes > 0) {
      const left = minutes * 60000 - (this.now() - (run.startedAt ?? this.now()));
      this.timeouts.set(run.id, this.setTimer(() => this.onTimeout(run.id, minutes), Math.max(0, left)));
    }
    this.cancelPoll ??= this.setTimer(() => this.poll(), POLL_MS);
  }
  poll() {
    this.cancelPoll = null;
    for (const id of [...this.orphans]) {
      const run = this.store.state.runs.find((r) => r.id === id);
      if (!run || run.status !== "running") {
        this.orphans.delete(id);
        continue;
      }
      if (run.pid === null || !isAlive(run.pid))
        this.markLost(id);
    }
    if (this.orphans.size > 0)
      this.cancelPoll = this.setTimer(() => this.poll(), POLL_MS);
  }
  markLost(id) {
    this.orphans.delete(id);
    this.timeouts.get(id)?.();
    this.timeouts.delete(id);
    rmSync2(join6(this.o.boardDir, "runs", `${id}.mcp.json`), { force: true });
    const run = this.patchRun(id, (r) => {
      r.status = "lost";
      r.note = LOST_NOTE;
      r.endedAt = this.now();
    }, `${id} lost`, LOST_NOTE);
    if (run) {
      this.ops.addSystemComment(run.ticket, `Run ${run.id} (${run.role}, ${run.mode}) lost: ${LOST_NOTE}. Log: .slimstack/board/runs/${run.id}.log. Use Restart agent in the ticket's Agent runs tab to try again.`);
    }
    this.pump();
  }
  log(draft, ticket, runId, action, detail = "") {
    draft.history.push({ at: this.now(), ticket, actor: "system", runId, action, detail });
  }
  note(ticket, action) {
    this.store.mutate((draft) => {
      this.log(draft, ticket, null, action);
      return { result: undefined, events: [] };
    });
  }
  patchRun(id, change, action, detail = "") {
    return this.store.mutate((draft) => {
      const run = draft.runs.find((r) => r.id === id);
      if (!run)
        return { result: undefined, events: [] };
      change(run);
      this.log(draft, run.ticket, run.id, action, detail);
      return { result: run, events: [] };
    });
  }
}

// src/board/daemon.ts
var IDLE_CHECK_MS = 60000;
var IDLE_LIMIT_MS = 2 * 60 * 60 * 1000;
var LOG_MAX_BYTES = 1e6;
var FRESH_LOCK_MS = 5000;
function isAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function acquireLock(file) {
  for (let attempt = 0;; attempt++) {
    try {
      const fd = openSync3(file, "wx");
      try {
        writeSync2(fd, String(process.pid));
      } finally {
        closeSync3(fd);
      }
      return;
    } catch (err) {
      if (err.code !== "EEXIST")
        throw err;
      let pid = Number.NaN;
      let fresh = false;
      try {
        pid = Number.parseInt(readFileSync7(file, "utf8").trim(), 10);
        fresh = Date.now() - statSync2(file).mtimeMs < FRESH_LOCK_MS;
      } catch {
        if (attempt < 3)
          continue;
        throw err;
      }
      if (Number.isInteger(pid) && pid > 0) {
        if (isAlive2(pid))
          throw new Error(`board daemon already running (pid ${pid})`);
      } else if (fresh) {
        throw new Error("board daemon already running (pid unknown)");
      }
      if (attempt >= 1)
        throw new Error(`could not take board lock ${file}`);
      unlinkSync(file);
    }
  }
}
function writeFileAtomic(file, data) {
  const tmp = file + ".tmp";
  writeFileSync6(tmp, data);
  for (let attempt = 0;; attempt++) {
    try {
      renameSync4(tmp, file);
      return;
    } catch (err) {
      const code = err.code;
      if (attempt >= 5 || code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")
        throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
}
async function startDaemon(o) {
  const env = o.env ?? process.env;
  const root = o.pluginRoot ?? pluginRoot();
  const projectRoot = o.projectRoot;
  const dir = boardDir(projectRoot);
  ensureSlimstackDir(projectRoot);
  mkdirSync6(join7(dir, "runs"), { recursive: true });
  mkdirSync6(join7(dir, "archive"), { recursive: true });
  const lockFile = join7(dir, "daemon.lock");
  acquireLock(lockFile);
  const logFile = join7(dir, "daemon.log");
  try {
    if (statSync2(logFile).size > LOG_MAX_BYTES)
      writeFileSync6(logFile, "");
  } catch {}
  const log = (message) => {
    try {
      appendFileSync2(logFile, `${new Date().toISOString()} ${message}
`);
    } catch {}
  };
  const infoFile = join7(dir, "daemon.json");
  let server;
  let idleTimer;
  try {
    const store = BoardStore.load(join7(dir, "board.json"));
    store.log = log;
    if (store.warning)
      log(store.warning);
    const uiToken = randomBytes2(24).toString("hex");
    const mcpToken = randomBytes2(24).toString("hex");
    let port = 0;
    const url = () => `http://127.0.0.1:${port}/`;
    const ops = createOps(store, { boardDir: dir, projectName: basename(projectRoot), boardUrl: url });
    const watcher = new Watcher({
      store,
      ops,
      spawner: o.spawner ?? realSpawner,
      projectRoot,
      boardDir: dir,
      harness: o.harness,
      pluginRoot: root,
      execPath: process.execPath,
      env,
      readConfig: () => readConfig(env).board
    });
    let lastActivity = Date.now();
    let browserOpened = false;
    let stopping;
    let markStopped;
    const stopped = new Promise((resolve) => {
      markStopped = resolve;
    });
    const stop = () => {
      stopping ??= (async () => {
        clearInterval(idleTimer);
        try {
          watcher.stopAll("board stopped");
        } catch (err) {
          log(`stopAll failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        await server?.close();
        rmSync3(infoFile, { force: true });
        rmSync3(lockFile, { force: true });
        log("daemon stopped");
        markStopped();
      })();
      return stopping;
    };
    server = createBoardServer({
      ops,
      store,
      watcher,
      uiToken,
      mcpToken,
      uiDir: o.uiDir ?? join7(root, "dist", "board-ui"),
      projectName: basename(projectRoot),
      url,
      onActivity: () => {
        lastActivity = Date.now();
      },
      onSessionCreate: () => {
        if (browserOpened)
          return;
        browserOpened = true;
        if (readConfig(env).board.openBrowser && server.sseClientCount() === 0)
          openUrl(url());
      },
      onShutdown: () => {
        stop();
      },
      log
    });
    let preferred = 0;
    try {
      const n = Number.parseInt(readFileSync7(join7(dir, "last-port"), "utf8").trim(), 10);
      if (Number.isInteger(n) && n > 0 && n < 65536)
        preferred = n;
    } catch {}
    try {
      port = await server.listen(preferred);
    } catch (err) {
      const code = err.code;
      if (preferred === 0 || code !== "EADDRINUSE" && code !== "EACCES")
        throw err;
      port = await server.listen(0);
    }
    writeFileSync6(join7(dir, "last-port"), String(port));
    const info = { pid: process.pid, port, mcpToken, harness: o.harness, startedAt: Date.now(), version: VERSION };
    writeFileAtomic(infoFile, JSON.stringify(info));
    process.stderr.write(`slimstack board: ${url()}
`);
    log(`daemon started: ${url()} pid ${process.pid} harness ${o.harness} version ${VERSION}`);
    watcher.recover();
    idleTimer = setInterval(() => {
      const busy = store.state.runs.some((r) => r.status === "running");
      if (server.sseClientCount() === 0 && !busy && Date.now() - lastActivity > IDLE_LIMIT_MS) {
        log("idle for 2 h: stopping");
        stop();
      }
    }, IDLE_CHECK_MS);
    idleTimer.unref();
    return { url: url(), port, uiToken, stop, stopped };
  } catch (err) {
    clearInterval(idleTimer);
    await server?.close();
    rmSync3(infoFile, { force: true });
    rmSync3(lockFile, { force: true });
    throw err;
  }
}

// src/bin/board.ts
init_paths();
var args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
if (args.includes("--launch")) {
  const child = spawn3(process.execPath, [fileURLToPath2(import.meta.url), ...args.filter((a) => a !== "--launch")], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env
  });
  child.on("error", () => {});
  child.unref();
  process.exit(0);
}
var projectRoot = flag("--project");
var harness = flag("--harness");
if (!projectRoot || harness !== "claude" && harness !== "omp") {
  process.stderr.write(`usage: board.mjs [--launch] --project <dir> --harness claude|omp
`);
  process.exit(1);
}
try {
  const daemon = await startDaemon({ projectRoot, harness });
  const shutdown = () => {
    daemon.stop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await daemon.stopped;
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("board daemon already running"))
    process.exit(0);
  try {
    const dir = boardDir(projectRoot);
    mkdirSync7(dir, { recursive: true });
    appendFileSync3(join8(dir, "daemon.log"), `${new Date().toISOString()} startup failed: ${err instanceof Error ? err.stack ?? message : message}
`);
  } catch {
    process.stderr.write(`slimstack board: ${message}
`);
  }
  process.exit(1);
}
