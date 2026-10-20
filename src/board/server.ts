import {timingSafeEqual} from "node:crypto";
import {closeSync, fstatSync, openSync, readFileSync, readSync} from "node:fs";
import {createServer, type IncomingMessage, type ServerResponse} from "node:http";
import type {AddressInfo} from "node:net";
import {dirname, join} from "node:path";
import {BoardError, type Ops} from "./ops.ts";
import type {BoardStore} from "./store.ts";
import {callTool} from "./tools.ts";
import type {Actor} from "./types.ts";
import {VERSION} from "./version.ts";
import type {Watcher} from "./watcher.ts";

export interface BoardServerOptions {
  ops: Ops;
  store: BoardStore;
  watcher: Watcher;
  uiToken: string;
  mcpToken: string;
  uiDir: string;
  projectName: string;
  url: () => string;
  onActivity: () => void;
  onSessionCreate: () => void;
  /** Called after the `/api/shutdown` response has been flushed. */
  onShutdown: () => void;
  log: (message: string) => void;
}

export interface BoardServer {
  listen(port: number): Promise<number>;
  close(): Promise<void>;
  sseClientCount(): number;
}

const MAX_BODY = 1_000_000;
const LOG_TAIL_BYTES = 200_000;
const PING_MS = 25_000;
const STATE_HISTORY = 500;
const ARCHIVE_ID_RE = /^\d{8}-\d{6}(-\d+)?$/;
const RUN_ID_RE = /^R-\d+$/;
const EITHER_TOKEN_PATHS = new Set(["/api/mcp", "/api/health", "/api/state", "/api/shutdown"]);

type Body = Record<string, unknown>;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function tokenEquals(supplied: string | undefined, expected: string): boolean {
  if (supplied === undefined) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!);
}

function sendJson(res: ServerResponse, status: number, body: unknown, cb?: () => void): void {
  res.writeHead(status, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"});
  res.end(JSON.stringify(body), cb);
}

function sendBytes(res: ServerResponse, status: number, type: string, body: Buffer | string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {"Content-Type": type, ...extra});
  res.end(body);
}

function tailFile(file: string, max: number): Buffer | null {
  let fd: number;
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

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (err: HttpError) => {
      if (done) return;
      done = true;
      req.removeAllListeners("data");
      req.resume();
      reject(err);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return fail(new HttpError("request body too large", 413));
      chunks.push(c);
    });
    req.on("error", () => fail(new HttpError("request failed", 400)));
    req.on("end", () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") return resolve({});
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return reject(new HttpError("invalid JSON", 400));
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return reject(new HttpError("JSON body must be an object", 400));
      }
      resolve(parsed as Body);
    });
  });
}

export function createBoardServer(o: BoardServerOptions): BoardServer {
  const {ops, store, watcher} = o;
  const boardDir = dirname(store.file);
  const user: Actor = {kind: "user"};
  const sseClients = new Set<ServerResponse>();
  let port = 0;
  let pingTimer: NodeJS.Timeout | undefined;

  const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const broadcast = (text: string) => {
    for (const c of sseClients) {
      try {
        c.write(text);
      } catch {
        sseClients.delete(c);
      }
    }
  };
  const unsubscribe = store.subscribe((e) => {
    if (e.type === "changed") broadcast(sse("change", {rev: e.rev}));
  });

  function serveStatic(res: ServerResponse, file: string, type: string): void {
    let data: Buffer;
    try {
      data = readFileSync(join(o.uiDir, file));
    } catch {
      return sendJson(res, 404, {error: "not found"});
    }
    sendBytes(res, 200, type, data);
  }

  function serveIndex(res: ServerResponse): void {
    let html: string;
    try {
      html = readFileSync(join(o.uiDir, "index.html"), "utf8");
    } catch {
      return sendJson(res, 404, {error: "not found"});
    }
    const out = html.replace(/\{\{(TOKEN|PROJECT)\}\}/g, (_m, k: string) => (k === "TOKEN" ? o.uiToken : escapeHtml(o.projectName)));
    sendBytes(res, 200, "text/html; charset=utf-8", out, {"Cache-Control": "no-store"});
  }

  function serveLog(res: ServerResponse, file: string): void {
    const data = tailFile(file, LOG_TAIL_BYTES);
    if (!data) return sendJson(res, 404, {error: "log not found"});
    sendBytes(res, 200, "text/plain; charset=utf-8", data, {"Cache-Control": "no-store"});
  }

  function serveEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive"});
    res.flushHeaders();
    res.write("retry: 2000\n\n");
    res.write(sse("hello", {rev: store.state.rev}));
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
      runs: s.runs.map(({token: _token, ...run}) => run),
      history: s.history.slice(-STATE_HISTORY),
      allDone: s.tickets.length > 0 && s.tickets.every((t) => t.status === "done"),
    };
  }

  function handleMcp(req: IncomingMessage, res: ServerResponse, body: Body): void {
    if (typeof body.tool !== "string") throw new BoardError("tool is required", 400);
    const runToken = req.headers["x-slimstack-run"];
    const actor: Actor = typeof runToken === "string" && runToken !== "" ? watcher.actorForRunToken(runToken) : {kind: "session"};
    const result = callTool(ops, actor, body.tool, body.args ?? {});
    sendJson(res, 200, result);
    if (body.tool === "create_ticket" && actor.kind === "session" && !result.isError) o.onSessionCreate();
  }

  /** Routes that need a parsed body or none at all. Returns false when no route matches. */
  function route(req: IncomingMessage, res: ServerResponse, method: string, path: string, body: Body): boolean {
    let m: RegExpExecArray | null;
    if (method === "POST" && path === "/api/mcp") return handleMcp(req, res, body), true;
    if (method === "POST" && path === "/api/shutdown") {
      sendJson(res, 200, {ok: true}, () => o.onShutdown());
      return true;
    }
    if (method === "POST" && path === "/api/tickets") {
      sendJson(res, 200, ops.createTicket(user, body as never));
      return true;
    }
    if (method === "PATCH" && (m = /^\/api\/tickets\/(\d+)$/.exec(path))) {
      sendJson(res, 200, ops.updateTicket(user, Number(m[1]), body as never));
      return true;
    }
    if (method === "POST" && (m = /^\/api\/tickets\/(\d+)\/move$/.exec(path))) {
      if (typeof body.to !== "string") throw new BoardError("status must be todo, in_progress, testing, or done", 400);
      sendJson(res, 200, ops.moveTicket(user, Number(m[1]), body.to as never));
      return true;
    }
    if (method === "POST" && (m = /^\/api\/tickets\/(\d+)\/comments$/.exec(path))) {
      const comment = ops.addComment(user, {
        ticket: Number(m[1]),
        body: typeof body.body === "string" ? body.body : "",
        kind: "message",
        ...(typeof body.replyTo === "number" ? {replyTo: body.replyTo} : {}),
      });
      sendJson(res, 200, comment);
      return true;
    }
    if (method === "POST" && (m = /^\/api\/tickets\/(\d+)\/restart$/.exec(path))) {
      watcher.restart(Number(m[1]));
      sendJson(res, 200, {ok: true});
      return true;
    }
    if (method === "POST" && (m = /^\/api\/runs\/(R-\d+)\/cancel$/.exec(path))) {
      watcher.cancel(m[1]!, "stopped by the user");
      sendJson(res, 200, {ok: true});
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

  /** GET routes (no body). Returns false when no route matches. */
  function routeGet(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    let m: RegExpExecArray | null;
    if (path === "/api/health") {
      sendJson(res, 200, {ok: true, pid: process.pid, project: o.projectName, version: VERSION, activeRuns: watcher.activeRunCount()});
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
    if ((m = /^\/api\/runs\/(R-\d+)\/log$/.exec(path))) {
      serveLog(res, join(boardDir, "runs", `${m[1]}.log`));
      return true;
    }
    if (path === "/api/archives") {
      sendJson(res, 200, ops.listArchives());
      return true;
    }
    if ((m = /^\/api\/archives\/([^/]+)$/.exec(path))) {
      sendJson(res, 200, ops.readArchive(decodeURIComponent(m[1]!)));
      return true;
    }
    if ((m = /^\/api\/archives\/([^/]+)\/runs\/([^/]+)\/log$/.exec(path))) {
      const id = decodeURIComponent(m[1]!);
      const run = decodeURIComponent(m[2]!);
      if (!ARCHIVE_ID_RE.test(id) || !RUN_ID_RE.test(run)) throw new BoardError("log not found", 404);
      serveLog(res, join(boardDir, "archive", id, "runs", `${run}.log`));
      return true;
    }
    return false;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    o.onActivity();
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return sendJson(res, 403, {error: "forbidden host"});

    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (method === "GET" && path === "/") return serveIndex(res);
    if (method === "GET" && path === "/app.js") return serveStatic(res, "app.js", "text/javascript; charset=utf-8");
    if (method === "GET" && path === "/app.css") return serveStatic(res, "app.css", "text/css; charset=utf-8");

    if (!path.startsWith("/api/")) return sendJson(res, 404, {error: "not found"});

    const header = req.headers["x-slimstack-token"];
    let supplied = typeof header === "string" ? header : undefined;
    if (supplied === undefined && method === "GET" && path === "/api/events") supplied = url.searchParams.get("token") ?? undefined;
    const authorized = EITHER_TOKEN_PATHS.has(path)
      ? tokenEquals(supplied, o.uiToken) || tokenEquals(supplied, o.mcpToken)
      : tokenEquals(supplied, o.uiToken);
    if (!authorized) return sendJson(res, 401, {error: "unauthorized"});

    if (method === "GET") {
      if (!routeGet(req, res, path)) sendJson(res, 404, {error: "not found"});
      return;
    }
    if (method === "POST" || method === "PATCH") {
      const body = await readBody(req);
      if (!route(req, res, method, path, body)) sendJson(res, 404, {error: "not found"});
      return;
    }
    sendJson(res, 404, {error: "not found"});
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof BoardError || err instanceof HttpError) {
        if (err instanceof HttpError && err.status === 413) res.setHeader("Connection", "close");
        sendJson(res, err.status, {error: err.message});
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      o.log(`request ${req.method} ${req.url} failed: ${err instanceof Error ? (err.stack ?? message) : message}`);
      sendJson(res, 500, {error: `internal error: ${message}`});
    });
  });

  return {
    listen(p) {
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(p, "127.0.0.1", () => {
          server.off("error", reject);
          port = (server.address() as AddressInfo).port;
          pingTimer ??= setInterval(() => broadcast(": ping\n\n"), PING_MS);
          pingTimer.unref();
          resolve(port);
        });
      });
    },
    close() {
      clearInterval(pingTimer);
      pingTimer = undefined;
      unsubscribe();
      for (const c of sseClients) c.end();
      sseClients.clear();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
    sseClientCount: () => sseClients.size,
  };
}
