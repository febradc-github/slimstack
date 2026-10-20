import {BoardError, getTicket, lastTestRun, openBugs, type Ops, type TicketPatch} from "./ops.ts";
import type {Actor, Status} from "./types.ts";

type PropSchema =
  | {type: "string"; enum?: readonly string[]}
  | {type: "integer"}
  | {type: "boolean"}
  | {type: "array"; items: {type: "string" | "integer"}; minItems?: number};

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {type: "object"; properties: Record<string, PropSchema>; required: string[]};
}

function tool(name: string, description: string, properties: Record<string, PropSchema>, required: string[]): McpTool {
  return {name, description, inputSchema: {type: "object", properties, required}};
}

const STATUSES = ["todo", "in_progress", "testing", "done"] as const;
const STR: PropSchema = {type: "string"};
const INT: PropSchema = {type: "integer"};
const INTS: PropSchema = {type: "array", items: {type: "integer"}};

export const TOOLS: readonly McpTool[] = [
  tool(
    "create_ticket",
    "Create a board ticket. Used by the task-planner.",
    {
      title: STR,
      instructions: STR,
      pseudocode: STR,
      acceptanceCriteria: {type: "array", items: {type: "string"}, minItems: 1},
      blockedBy: INTS,
    },
    ["title", "instructions", "pseudocode", "acceptanceCriteria"],
  ),
  tool("get_ticket", "Read one ticket with its blockers, open bugs, last test run, and agent runs.", {ticket: INT}, ["ticket"]),
  tool(
    "list_tickets",
    "List ticket summaries, optionally filtered.",
    {status: {type: "string", enum: STATUSES}, assignee: {type: "string", enum: ["user", "agent", "unassigned"]}},
    [],
  ),
  tool(
    "update_ticket",
    "Edit title, instructions, pseudocode, acceptanceCriteria, or blockedBy. Only the user assigns tickets.",
    {
      ticket: INT,
      title: STR,
      instructions: STR,
      pseudocode: STR,
      acceptanceCriteria: {type: "array", items: {type: "string"}},
      blockedBy: INTS,
    },
    ["ticket"],
  ),
  tool(
    "move_ticket",
    "Move a ticket to todo, in_progress, testing, or done. The server enforces blockers and Done rules.",
    {ticket: INT, to: {type: "string", enum: STATUSES}},
    ["ticket", "to"],
  ),
  tool(
    "add_comment",
    "Comment on a ticket. replyTo threads under a comment. kind bug or test_run (with passed) and resolve (fixed, dismissed, reopen on a bug thread) are for tester agents.",
    {
      ticket: INT,
      body: STR,
      kind: {type: "string", enum: ["message", "bug", "test_run"]},
      replyTo: INT,
      resolve: {type: "string", enum: ["fixed", "dismissed", "reopen"]},
      passed: {type: "boolean"},
    },
    ["ticket", "body"],
  ),
  tool("get_comments", "Read a ticket's comments oldest first; sinceId returns only newer ones.", {ticket: INT, sinceId: INT}, ["ticket"]),
  tool("archive_board", "Archive the finished board (every ticket Done) and empty it. Call only when the user asked for it.", {title: STR}, []),
  tool("clear_board", "Delete every ticket of the finished board (every ticket Done). Call only when the user asked for it.", {}, []),
];

type Args = Record<string, unknown>;

function typeProblem(key: string, spec: PropSchema, v: unknown): string | null {
  switch (spec.type) {
    case "string":
      if (typeof v !== "string") return `${key} must be string`;
      if (spec.enum && !spec.enum.includes(v)) return `${key} must be one of ${spec.enum.join(", ")}`;
      return null;
    case "integer":
      return typeof v === "number" && Number.isInteger(v) ? null : `${key} must be integer`;
    case "boolean":
      return typeof v === "boolean" ? null : `${key} must be boolean`;
    case "array":
      return Array.isArray(v) && v.every((x) => (spec.items.type === "string" ? typeof x === "string" : typeof x === "number" && Number.isInteger(x)))
        ? null
        : `${key} must be ${spec.items.type}[]`;
  }
}

function validate(t: McpTool, args: unknown): Args {
  const a = args === undefined || args === null ? {} : args;
  if (typeof a !== "object" || Array.isArray(a)) throw new BoardError("arguments must be an object", 400);
  const props = t.inputSchema.properties;
  const keys = Object.keys(a);
  if (t.name !== "list_tickets" && keys.includes("assignee")) throw new BoardError("only the user can assign tickets (board UI)", 403);
  for (const k of keys) if (!Object.hasOwn(props, k)) throw new BoardError(`unknown field: ${k}`, 400);
  const rec = a as Args;
  for (const k of t.inputSchema.required) if (rec[k] === undefined) throw new BoardError(`${k} is required`, 400);
  for (const k of keys) {
    if (rec[k] === undefined) continue;
    const problem = typeProblem(k, props[k]!, rec[k]);
    if (problem) throw new BoardError(problem, 400);
  }
  return rec;
}

function ticketUrl(ops: Ops, n: number): string {
  return `${ops.boardUrl()}#T-${n}`;
}

const HANDLERS: Record<string, (ops: Ops, actor: Actor, a: Args) => unknown> = {
  create_ticket(ops, actor, a) {
    const t = ops.createTicket(actor, {
      title: a.title as string,
      instructions: a.instructions as string,
      pseudocode: a.pseudocode as string,
      acceptanceCriteria: a.acceptanceCriteria as string[],
      blockedBy: a.blockedBy as number[] | undefined,
    });
    return {ticket: t.n, url: ticketUrl(ops, t.n)};
  },
  get_ticket(ops, _actor, a) {
    const state = ops.store.state;
    const t = getTicket(state, a.ticket as number);
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
        return {ticket: x.n, title: x.title, status: x.status};
      }),
      openBugs: openBugs(state, t.n),
      lastTestRun: last ? {comment: last.id, passed: last.passed, at: last.createdAt} : null,
      runs: state.runs.filter((r) => r.ticket === t.n).map((r) => ({id: r.id, role: r.role, mode: r.mode, status: r.status})),
      url: ticketUrl(ops, t.n),
    };
  },
  list_tickets(ops, _actor, a) {
    const state = ops.store.state;
    const want = a.assignee as string | undefined;
    const tickets = [];
    for (const t of state.tickets) {
      if (a.status !== undefined && t.status !== a.status) continue;
      if (want !== undefined && (want === "unassigned" ? t.assignee !== null : t.assignee !== want)) continue;
      tickets.push({
        ticket: t.n,
        title: t.title,
        status: t.status,
        assignee: t.assignee,
        blockedBy: t.blockedBy,
        openBugs: openBugs(state, t.n).length,
      });
    }
    return {url: ops.boardUrl(), tickets};
  },
  update_ticket(ops, actor, a) {
    const {ticket, ...patch} = a;
    ops.updateTicket(actor, ticket as number, patch as TicketPatch);
    return {ticket, updated: Object.keys(patch).filter((k) => patch[k] !== undefined)};
  },
  move_ticket(ops, actor, a) {
    const t = ops.moveTicket(actor, a.ticket as number, a.to as Status);
    return {ticket: t.n, status: t.status};
  },
  add_comment(ops, actor, a) {
    const c = ops.addComment(actor, {
      ticket: a.ticket as number,
      body: a.body as string,
      kind: a.kind as "message" | "bug" | "test_run" | undefined,
      replyTo: a.replyTo as number | undefined,
      resolve: a.resolve as "fixed" | "dismissed" | "reopen" | undefined,
      passed: a.passed as boolean | undefined,
    });
    return {comment: c.id};
  },
  get_comments(ops, _actor, a) {
    const state = ops.store.state;
    const n = getTicket(state, a.ticket as number).n;
    const since = (a.sinceId as number | undefined) ?? 0;
    const out = [];
    for (const c of state.comments) {
      if (c.ticket !== n || c.id <= since) continue;
      out.push({
        id: c.id,
        author: c.author,
        role: c.role,
        kind: c.kind,
        body: c.body,
        replyTo: c.replyTo,
        bugStatus: c.bugStatus,
        passed: c.passed,
        at: c.createdAt,
      });
    }
    return out;
  },
  archive_board(ops, actor, a) {
    const r = ops.archiveBoard(actor, a.title as string | undefined);
    return {archive: r.id, tickets: r.tickets};
  },
  clear_board(ops, actor) {
    return ops.clearBoard(actor);
  },
};

export function callTool(ops: Ops, actor: Actor, name: string, args: unknown): {text: string; isError: boolean} {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return {text: `unknown tool: ${name}`, isError: true};
  try {
    const result = HANDLERS[name]!(ops, actor, validate(t, args));
    return {text: JSON.stringify(result), isError: false};
  } catch (err) {
    if (err instanceof BoardError) return {text: err.message, isError: true};
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`board tool ${name} failed: ${err instanceof Error ? (err.stack ?? message) : message}\n`);
    return {text: `internal error: ${message}`, isError: true};
  }
}
