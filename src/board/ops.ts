import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {BoardStore} from "./store.ts";
import {
  STATUS_LABEL,
  type Actor,
  type Assignee,
  type BoardEvent,
  type BoardState,
  type Comment,
  type CommentKind,
  type HistoryEntry,
  type Status,
  type Ticket,
} from "./types.ts";

export class BoardError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = "BoardError";
  }
}

export interface OpsOptions {
  boardDir: string;
  projectName: string;
  boardUrl: () => string;
  now?: () => number;
}

export interface NewTicket {
  title: string;
  instructions: string;
  pseudocode?: string;
  acceptanceCriteria: string[];
  blockedBy?: number[];
}

export interface TicketPatch {
  title?: string;
  instructions?: string;
  pseudocode?: string;
  acceptanceCriteria?: string[];
  blockedBy?: number[];
  assignee?: Assignee;
}

export interface NewComment {
  ticket: number;
  body: string;
  kind?: "message" | "bug" | "test_run";
  replyTo?: number;
  resolve?: "fixed" | "dismissed" | "reopen";
  passed?: boolean;
}

export interface ArchiveSummary {
  id: string;
  title: string;
  archivedAt: number;
  ticketCount: number;
}

export interface ArchiveSnapshot extends ArchiveSummary {
  project: string;
  state: BoardState;
}

const ARCHIVE_ID_RE = /^\d{8}-\d{6}(-\d+)?$/;
const ASSIGN_ERROR = "only the user can assign tickets (board UI)";

// ---- state helpers (exported for the watcher, the server, and tools) ----

export function getTicket(state: Readonly<BoardState>, n: number): Ticket {
  const t = state.tickets.find((x) => x.n === n);
  if (!t) throw new BoardError(`T-${n} not found`, 404);
  return t;
}

/** Ids of the ticket's bug comments that are still open, oldest first. */
export function openBugs(state: Readonly<BoardState>, n: number): number[] {
  const ids: number[] = [];
  for (const c of state.comments) if (c.ticket === n && c.kind === "bug" && c.bugStatus === "open") ids.push(c.id);
  return ids;
}

/** Newest test_run comment on the ticket, or null. */
export function lastTestRun(state: Readonly<BoardState>, n: number): Comment | null {
  for (let i = state.comments.length - 1; i >= 0; i--) {
    const c = state.comments[i]!;
    if (c.ticket === n && c.kind === "test_run") return c;
  }
  return null;
}

/** Blocker tickets of `n` whose status is not Done, in blockedBy order. */
export function blockersNotDone(state: Readonly<BoardState>, n: number): Ticket[] {
  const out: Ticket[] = [];
  for (const b of getTicket(state, n).blockedBy) {
    const t = state.tickets.find((x) => x.n === b);
    if (t && t.status !== "done") out.push(t);
  }
  return out;
}

// ---- internal helpers ----

const ASSIGNEE_LABEL: Record<"null" | "user" | "agent", string> = {null: "Unassigned", user: "You", agent: "Agent"};

function assigneeLabel(a: Assignee): string {
  return ASSIGNEE_LABEL[a === null ? "null" : a];
}

function historyActor(actor: Actor): Pick<HistoryEntry, "actor" | "runId"> {
  switch (actor.kind) {
    case "user":
      return {actor: "user", runId: null};
    case "session":
      return {actor: "agent", runId: null};
    case "run":
      return {actor: "agent", runId: actor.run.id};
    case "system":
      return {actor: "system", runId: null};
  }
}

function assertScope(actor: Actor, n: number): void {
  if (actor.kind === "run" && actor.run.ticket !== n) {
    throw new BoardError(`run ${actor.run.id} may only act on T-${actor.run.ticket}`, 403);
  }
}

function cleanTitle(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  if (t.length < 1 || t.length > 200) throw new BoardError("title must be 1-200 characters", 400);
  return t;
}

function cleanInstructions(v: unknown): string {
  if (typeof v !== "string" || v.trim() === "") throw new BoardError("instructions are required", 400);
  return v;
}

function cleanCriteria(v: unknown): string[] {
  const items: string[] = [];
  if (Array.isArray(v)) for (const s of v) if (typeof s === "string" && s.trim() !== "") items.push(s.trim());
  if (items.length === 0) throw new BoardError("acceptanceCriteria needs at least one item", 400);
  return items;
}

function cleanPseudocode(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v !== "string") throw new BoardError("pseudocode must be a string", 400);
  return v;
}

function cleanBlockedBy(draft: BoardState, n: number, v: unknown): number[] {
  if (!Array.isArray(v)) throw new BoardError("blockedBy must be an array of ticket numbers", 400);
  const list: number[] = [];
  for (const b of v) {
    if (typeof b !== "number" || !Number.isInteger(b)) throw new BoardError("blockedBy must be an array of ticket numbers", 400);
    if (b === n) throw new BoardError(`T-${n} cannot block itself`, 400);
    if (!draft.tickets.some((t) => t.n === b)) throw new BoardError(`blockedBy references unknown ticket T-${b}`, 400);
    if (!list.includes(b)) list.push(b);
  }
  const path = [n];
  const seen = new Set<number>();
  const visit = (k: number): boolean => {
    const deps = k === n ? list : getTicket(draft, k).blockedBy;
    for (const b of deps) {
      if (b === n) {
        path.push(n);
        return true;
      }
      if (seen.has(b)) continue;
      seen.add(b);
      path.push(b);
      if (visit(b)) return true;
      path.pop();
    }
    return false;
  };
  if (visit(n)) throw new BoardError(`blockedBy cycle: ${path.map((x) => `T-${x}`).join(" -> ")}`, 400);
  return list;
}

function pad(v: number, width = 2): string {
  return String(v).padStart(width, "0");
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export interface Ops {
  readonly store: BoardStore;
  boardUrl(): string;
  createTicket(actor: Actor, input: NewTicket): Ticket;
  updateTicket(actor: Actor, n: number, patch: TicketPatch): Ticket;
  moveTicket(actor: Actor, n: number, to: Status): Ticket;
  addComment(actor: Actor, input: NewComment): Comment;
  addSystemComment(n: number, body: string): Comment;
  archiveBoard(actor: Actor, title?: string): {id: string; tickets: number};
  clearBoard(actor: Actor): {removed: number};
  listArchives(): ArchiveSummary[];
  readArchive(id: string): ArchiveSnapshot;
}

export function createOps(store: BoardStore, o: OpsOptions): Ops {
  const now = o.now ?? Date.now;
  const runsDir = join(o.boardDir, "runs");
  const archiveDir = join(o.boardDir, "archive");

  function log(draft: BoardState, actor: Actor, ticket: number | null, action: string, detail: string): void {
    const h = historyActor(actor);
    draft.history.push({at: now(), ticket, actor: h.actor, runId: h.runId, action, detail});
  }

  function pushComment(
    draft: BoardState,
    actor: Actor,
    c: {ticket: number; body: string; kind: CommentKind; replyTo: number | null; passed: boolean | null},
  ): Comment {
    const comment: Comment = {
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
      createdAt: now(),
    };
    draft.comments.push(comment);
    log(draft, actor, c.ticket, "commented", `#${comment.id} ${comment.kind}`);
    return comment;
  }

  function assertFinished(draft: BoardState, actor: Actor): void {
    if (actor.kind === "run") {
      throw new BoardError("only the user or the interactive session can archive or clear the board", 403);
    }
    if (draft.tickets.length === 0) throw new BoardError("board is empty", 409);
    const open = draft.tickets.filter((t) => t.status !== "done");
    if (open.length > 0) {
      throw new BoardError(`board is not finished: ${open.map((t) => `T-${t.n}`).join(", ")} are not Done`, 409);
    }
    const active = draft.runs.filter((r) => r.status === "pending" || r.status === "running");
    if (active.length > 0) throw new BoardError(`agent runs are still active: ${active.map((r) => r.id).join(", ")}`, 409);
  }

  function emptyBoard(draft: BoardState): void {
    draft.tickets = [];
    draft.comments = [];
    draft.runs = [];
    draft.history = [];
  }

  function createTicket(actor: Actor, input: NewTicket): Ticket {
    if (actor.kind === "run") throw new BoardError("only the user or the interactive session can create tickets", 403);
    return store.mutate((draft) => {
      const n = draft.nextTicket;
      const title = cleanTitle(input.title);
      const instructions = cleanInstructions(input.instructions);
      const acceptanceCriteria = cleanCriteria(input.acceptanceCriteria);
      const pseudocode = cleanPseudocode(input.pseudocode);
      const blockedBy = input.blockedBy === undefined ? [] : cleanBlockedBy(draft, n, input.blockedBy);
      draft.nextTicket++;
      const at = now();
      const ticket: Ticket = {
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
        enteredTestingAt: null,
      };
      draft.tickets.push(ticket);
      log(draft, actor, n, "created", title);
      return {result: ticket, events: []};
    });
  }

  function updateTicket(actor: Actor, n: number, patch: TicketPatch): Ticket {
    return store.mutate((draft) => {
      const ticket = getTicket(draft, n);
      assertScope(actor, n);
      if (patch.assignee !== undefined && actor.kind !== "user" && actor.kind !== "system") throw new BoardError(ASSIGN_ERROR, 403);
      const events: BoardEvent[] = [];
      const edited: string[] = [];
      const next = {
        title: patch.title === undefined ? ticket.title : cleanTitle(patch.title),
        instructions: patch.instructions === undefined ? ticket.instructions : cleanInstructions(patch.instructions),
        pseudocode: patch.pseudocode === undefined ? ticket.pseudocode : cleanPseudocode(patch.pseudocode),
        acceptanceCriteria: patch.acceptanceCriteria === undefined ? ticket.acceptanceCriteria : cleanCriteria(patch.acceptanceCriteria),
        blockedBy: patch.blockedBy === undefined ? ticket.blockedBy : cleanBlockedBy(draft, n, patch.blockedBy),
      };
      let assignee = ticket.assignee;
      if (patch.assignee !== undefined) {
        if (patch.assignee !== null && patch.assignee !== "user" && patch.assignee !== "agent") {
          throw new BoardError("assignee must be user, agent, or null", 400);
        }
        assignee = patch.assignee;
      }
      for (const k of ["title", "instructions", "pseudocode", "acceptanceCriteria", "blockedBy"] as const) {
        if (patch[k] !== undefined && JSON.stringify(next[k]) !== JSON.stringify(ticket[k])) edited.push(k);
      }
      const blockersChanged = edited.includes("blockedBy");
      Object.assign(ticket, next);
      if (edited.length > 0) log(draft, actor, n, "edited", edited.join(", "));
      if (blockersChanged) events.push({type: "blockers_changed", ticket: n});
      if (assignee !== ticket.assignee) {
        const from = ticket.assignee;
        ticket.assignee = assignee;
        log(draft, actor, n, "assigned", `${assigneeLabel(from)} -> ${assigneeLabel(assignee)}`);
        events.push({type: "assigned", ticket: n, actor, from, to: assignee});
      }
      if (edited.length > 0 || events.length > 0) ticket.updatedAt = now();
      return {result: ticket, events};
    });
  }

  function moveTicket(actor: Actor, n: number, to: Status): Ticket {
    if (!(to in STATUS_LABEL)) throw new BoardError("status must be todo, in_progress, testing, or done", 400);
    const current = getTicket(store.state, n);
    assertScope(actor, n);
    if (current.status === to) return current;
    return store.mutate((draft) => {
      const ticket = getTicket(draft, n);
      if (actor.kind === "session" || actor.kind === "run") {
        if (to === "todo") throw new BoardError("agents cannot move tickets back to To Do", 403);
        if (ticket.status === "done") throw new BoardError("only the user can reopen a Done ticket", 403);
        const blockers = blockersNotDone(draft, n);
        if (blockers.length > 0) {
          throw new BoardError(`T-${n} is blocked by ${blockers.map((b) => `T-${b.n} (${STATUS_LABEL[b.status]})`).join(", ")}`, 409);
        }
        if (to === "done") {
          if (ticket.assignee !== "agent") {
            throw new BoardError(
              `only the user can move T-${n} to Done (${ticket.assignee === "user" ? "assigned to user" : "unassigned"})`,
              403,
            );
          }
          if (ticket.status !== "testing") throw new BoardError("agents move tickets to Done only from Testing", 409);
          const bugs = openBugs(draft, n);
          if (bugs.length > 0) throw new BoardError(`T-${n} has open bugs: ${bugs.map((id) => `#${id}`).join(", ")}`, 409);
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
      if (to === "testing") ticket.enteredTestingAt = at;
      log(draft, actor, n, "moved", `${STATUS_LABEL[from]} -> ${STATUS_LABEL[to]}`);
      return {result: ticket, events: [{type: "moved", ticket: n, actor, from, to}]};
    });
  }

  function addComment(actor: Actor, input: NewComment): Comment {
    return store.mutate((draft) => {
      const n = input.ticket;
      getTicket(draft, n);
      assertScope(actor, n);
      const kind = input.kind ?? "message";
      const testerRun = actor.kind === "run" && actor.run.role === "tester";
      if ((kind !== "message" || input.resolve !== undefined) && (actor.kind === "session" || (actor.kind === "run" && !testerRun))) {
        throw new BoardError("only tester runs can file bugs, resolve bugs, or post test_run results", 403);
      }
      if (typeof input.body !== "string" || input.body.trim() === "") throw new BoardError("comment body is required", 400);
      if ((input.passed !== undefined) !== (kind === "test_run")) {
        throw new BoardError("passed is required for test_run and only allowed there", 400);
      }
      let root: Comment | null = null;
      if (input.replyTo !== undefined) {
        let cur = draft.comments.find((c) => c.id === input.replyTo && c.ticket === n);
        if (!cur) throw new BoardError(`comment #${input.replyTo} not found on T-${n}`, 404);
        while (cur.replyTo !== null) {
          const parentId: number = cur.replyTo;
          const parent: Comment | undefined = draft.comments.find((c) => c.id === parentId);
          if (!parent) break;
          cur = parent;
        }
        root = cur;
      }
      let bugStatus: "open" | "fixed" | "dismissed" | null = null;
      if (input.resolve !== undefined) {
        if (!root || root.kind !== "bug") throw new BoardError("resolve requires replyTo on a bug comment", 400);
        bugStatus = input.resolve === "reopen" ? "open" : input.resolve;
      }
      const comment = pushComment(draft, actor, {
        ticket: n,
        body: input.body,
        kind,
        replyTo: root ? root.id : null,
        passed: input.passed ?? null,
      });
      if (root && bugStatus) {
        root.bugStatus = bugStatus;
        log(draft, actor, n, "bug", `#${root.id} ${bugStatus}`);
      }
      return {result: comment, events: [{type: "commented", ticket: n, actor, commentId: comment.id}]};
    });
  }

  function addSystemComment(n: number, body: string): Comment {
    return store.mutate((draft) => {
      getTicket(draft, n);
      const actor: Actor = {kind: "system"};
      const comment = pushComment(draft, actor, {ticket: n, body, kind: "system", replyTo: null, passed: null});
      return {result: comment, events: [{type: "commented", ticket: n, actor, commentId: comment.id}]};
    });
  }

  function archiveBoard(actor: Actor, title?: string): {id: string; tickets: number} {
    return store.mutate((draft) => {
      assertFinished(draft, actor);
      const at = new Date(now());
      const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
      let id = stamp;
      for (let k = 2; existsSync(join(archiveDir, id)); k++) id = `${stamp}-${k}`;
      const dir = join(archiveDir, id);
      mkdirSync(join(dir, "runs"), {recursive: true});
      const defaultTitle = `Board archived ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
      const snapshot: ArchiveSnapshot = {
        id,
        title: title?.trim() || defaultTitle,
        archivedAt: at.getTime(),
        project: o.projectName,
        ticketCount: draft.tickets.length,
        state: {...draft, runs: draft.runs.map((r) => ({...r, token: ""}))},
      };
      writeFileSync(join(dir, "board.json"), JSON.stringify(snapshot));
      for (const f of listDir(runsDir)) {
        if (f.endsWith(".log")) renameSync(join(runsDir, f), join(dir, "runs", f));
        else if (f.endsWith(".mcp.json")) rmSync(join(runsDir, f), {force: true});
      }
      const tickets = draft.tickets.length;
      emptyBoard(draft);
      log(draft, actor, null, "archived", id);
      return {result: {id, tickets}, events: []};
    });
  }

  function clearBoard(actor: Actor): {removed: number} {
    return store.mutate((draft) => {
      assertFinished(draft, actor);
      for (const f of listDir(runsDir)) rmSync(join(runsDir, f), {recursive: true, force: true});
      const removed = draft.tickets.length;
      emptyBoard(draft);
      log(draft, actor, null, "cleared", `${removed} tickets`);
      return {result: {removed}, events: []};
    });
  }

  function listArchives(): ArchiveSummary[] {
    const out: ArchiveSummary[] = [];
    for (const id of listDir(archiveDir)) {
      if (!ARCHIVE_ID_RE.test(id)) continue;
      try {
        const s = JSON.parse(readFileSync(join(archiveDir, id, "board.json"), "utf8")) as ArchiveSnapshot;
        out.push({id, title: s.title, archivedAt: s.archivedAt, ticketCount: s.ticketCount});
      } catch {
        // unreadable archive: skip it
      }
    }
    return out.sort((a, b) => b.archivedAt - a.archivedAt || (a.id < b.id ? 1 : -1));
  }

  function readArchive(id: string): ArchiveSnapshot {
    if (!ARCHIVE_ID_RE.test(id)) throw new BoardError("archive not found", 404);
    try {
      return JSON.parse(readFileSync(join(archiveDir, id, "board.json"), "utf8")) as ArchiveSnapshot;
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
    readArchive,
  };
}

