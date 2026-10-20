import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {request as httpRequest, type IncomingHttpHeaders} from "node:http";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {startDaemon, type Daemon} from "../src/board/daemon.ts";
import {readDaemonInfo} from "../src/board/client.ts";
import type {SpawnSpec, Spawner} from "../src/board/spawn.ts";
import type {BoardState} from "../src/board/types.ts";

interface FakeRun {
  spec: SpawnSpec;
  killed: boolean;
  exit(code: number | null): void;
}

class FakeSpawner implements Spawner {
  readonly runs: FakeRun[] = [];
  start(spec: SpawnSpec, onExit: (code: number | null) => void) {
    const run: FakeRun = {spec, killed: false, exit: onExit};
    this.runs.push(run);
    return {
      pid: null,
      kill: () => {
        run.killed = true;
      },
    };
  }
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function send(port: number, method: string, path: string, o: {headers?: Record<string, string>; body?: string} = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {...o.headers};
    if (o.body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(o.body);
    }
    let reply: Reply | undefined;
    const req = httpRequest({host: "127.0.0.1", port, method, path, headers}, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        reply = {status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8")};
        resolve(reply);
      });
    });
    req.on("error", (err) => {
      if (!reply) reject(err);
    });
    req.end(o.body);
  });
}

const tmp = mkdtempSync(join(tmpdir(), "slimstack-server-"));
const home = join(tmp, "home");
const uiDir = join(tmp, "ui");
const project = join(tmp, "project");
const spawner = new FakeSpawner();
let daemon: Daemon;
let port: number;
let mcpToken: string;
const env = {...process.env, SLIMSTACK_HOME: home};

function ui(method: string, path: string, body?: unknown, token: string = daemon.uiToken): Promise<Reply> {
  return send(port, method, path, {headers: {"x-slimstack-token": token}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
}

function mcp(tool: string, args: unknown, runToken?: string): Promise<Reply> {
  const headers: Record<string, string> = {"x-slimstack-token": mcpToken};
  if (runToken) headers["x-slimstack-run"] = runToken;
  return send(port, "POST", "/api/mcp", {headers, body: JSON.stringify({tool, args})});
}

const ticketBody = (title: string) => ({title, instructions: "do it", pseudocode: "x", acceptanceCriteria: ["it works"]});

function boardJson(root = project): BoardState {
  return JSON.parse(readFileSync(join(root, ".slimstack", "board", "board.json"), "utf8"));
}

beforeAll(async () => {
  mkdirSync(home, {recursive: true});
  mkdirSync(uiDir, {recursive: true});
  mkdirSync(project, {recursive: true});
  writeFileSync(join(home, "config.json"), JSON.stringify({board: {openBrowser: false}}));
  writeFileSync(join(uiDir, "index.html"), '<meta name="slimstack-token" content="{{TOKEN}}"><title>{{PROJECT}}</title>');
  writeFileSync(join(uiDir, "app.js"), "console.log(1)");
  writeFileSync(join(uiDir, "app.css"), "body{}");
  daemon = await startDaemon({projectRoot: project, harness: "claude", env, uiDir, spawner});
  port = daemon.port;
  mcpToken = readDaemonInfo(join(project, ".slimstack", "board"))!.mcpToken;
});

afterAll(async () => {
  await daemon.stop();
  rmSync(tmp, {recursive: true, force: true});
});

describe("guards", () => {
  test("wrong or missing Host is rejected before anything else", async () => {
    const r = await send(port, "GET", "/api/health", {headers: {Host: "evil.example", "x-slimstack-token": mcpToken}});
    expect(r.status).toBe(403);
    expect((await send(port, "GET", "/", {headers: {Host: `evil.example:${port}`}})).status).toBe(403);
    expect((await send(port, "GET", "/", {headers: {Host: `localhost:${port}`}})).status).toBe(200);
  });

  test("api routes without a token answer 401 {error: unauthorized}", async () => {
    for (const [method, path] of [
      ["GET", "/api/state"],
      ["GET", "/api/health"],
      ["POST", "/api/tickets"],
      ["POST", "/api/mcp"],
      ["POST", "/api/shutdown"],
      ["GET", "/api/events"],
      ["GET", "/api/archives"],
    ] as const) {
      const r = await send(port, method, path, method === "POST" ? {body: "{}"} : {});
      expect(r.status).toBe(401);
      expect(JSON.parse(r.text)).toEqual({error: "unauthorized"});
    }
    expect((await ui("GET", "/api/state", undefined, "nope")).status).toBe(401);
  });

  test("the MCP token cannot use user routes; either token reads health and state", async () => {
    expect((await ui("POST", "/api/tickets", ticketBody("x"), mcpToken)).status).toBe(401);
    expect((await ui("PATCH", "/api/tickets/1", {assignee: "agent"}, mcpToken)).status).toBe(401);
    expect((await ui("GET", "/api/events", undefined, mcpToken)).status).toBe(401);
    expect((await ui("GET", "/api/health", undefined, mcpToken)).status).toBe(200);
    expect((await ui("GET", "/api/health")).status).toBe(200);
    expect((await ui("GET", "/api/state", undefined, mcpToken)).status).toBe(200);
  });

  test("no CORS headers, JSON errors, size limit", async () => {
    const r = await ui("GET", "/api/health");
    expect(Object.keys(r.headers).some((h) => h.startsWith("access-control-"))).toBe(false);
    const bad = await send(port, "POST", "/api/tickets", {headers: {"x-slimstack-token": daemon.uiToken}, body: "{not json"});
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text)).toEqual({error: "invalid JSON"});
    const big = await send(port, "POST", "/api/tickets", {headers: {"x-slimstack-token": daemon.uiToken}, body: JSON.stringify({pad: "x".repeat(1_100_000)})});
    expect(big.status).toBe(413);
  });
});

describe("static", () => {
  test("GET / substitutes the UI token and the escaped project name; assets are served", async () => {
    const r = await send(port, "GET", "/");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.text).toContain(`<meta name="slimstack-token" content="${daemon.uiToken}">`);
    expect(r.text).toContain("<title>project</title>");
    expect(r.text).not.toContain(mcpToken);
    expect((await send(port, "GET", "/app.js")).text).toBe("console.log(1)");
    expect((await send(port, "GET", "/app.css")).text).toBe("body{}");
  });
});

describe("board over HTTP", () => {
  test("create, assign, move, comment with the UI token", async () => {
    const t1 = await ui("POST", "/api/tickets", ticketBody("first"));
    expect(t1.status).toBe(200);
    expect(JSON.parse(t1.text).n).toBe(1);
    expect(JSON.parse((await ui("POST", "/api/tickets", ticketBody("second"))).text).n).toBe(2);

    const assigned = await ui("PATCH", "/api/tickets/1", {assignee: "agent"});
    expect(assigned.status).toBe(200);
    expect(JSON.parse(assigned.text).assignee).toBe("agent");
    expect(spawner.runs).toHaveLength(1);
    expect(spawner.runs[0]!.spec.stdin).toContain("role coder, mode implement, ticket T-1");

    const moved = await ui("POST", "/api/tickets/2/move", {to: "in_progress"});
    expect(moved.status).toBe(200);
    expect(JSON.parse(moved.text).status).toBe("in_progress");

    const refused = await ui("PATCH", "/api/tickets/2", {title: ""});
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.text).error).toBe("title must be 1-200 characters");
    expect((await ui("PATCH", "/api/tickets/99", {title: "x"})).status).toBe(404);

    const c = await ui("POST", "/api/tickets/2/comments", {body: "why this way?"});
    expect(c.status).toBe(200);
    const comment = JSON.parse(c.text);
    expect(comment.author).toBe("user");
    expect(comment.kind).toBe("message");
    // a user comment with no agent thread starts a responder run
    expect(spawner.runs.some((r) => r.spec.stdin.includes("role responder, mode reply, ticket T-2"))).toBe(true);
    expect((await ui("POST", "/api/tickets/2/comments", {body: ""})).text).toContain("comment body is required");
  });

  test("state view omits run tokens and reports allDone", async () => {
    const r = await ui("GET", "/api/state");
    const s = JSON.parse(r.text);
    expect(s.tickets).toHaveLength(2);
    expect(s.runs.length).toBeGreaterThan(0);
    for (const run of s.runs) expect("token" in run).toBe(false);
    expect(s.allDone).toBe(false);
    expect(s.project).toBe("project");
    expect(s.url).toBe(`http://127.0.0.1:${port}/`);
    expect(typeof s.rev).toBe("number");
  });

  test("an agent run is confined to its own ticket through /api/mcp", async () => {
    const run = boardJson().runs.find((r) => r.ticket === 1 && r.role === "coder")!;
    expect(run.status).toBe("running");
    const denied = JSON.parse((await mcp("move_ticket", {ticket: 2, to: "testing"}, run.token)).text);
    expect(denied).toEqual({text: `run ${run.id} may only act on T-1`, isError: true});
    const own = JSON.parse((await mcp("get_ticket", {ticket: 1}, run.token)).text);
    expect(own.isError).toBe(false);
    const bogus = await mcp("get_ticket", {ticket: 1}, "not-a-token");
    expect(bogus.status).toBe(403);
    expect(JSON.parse(bogus.text).error).toBe("unknown run token");
    // the session actor may not assign
    const assign = JSON.parse((await mcp("update_ticket", {ticket: 2, assignee: "agent"})).text);
    expect(assign).toEqual({text: "only the user can assign tickets (board UI)", isError: true});
  });

  test("a run token stops authenticating once its run has ended", async () => {
    const run = boardJson().runs.find((r) => r.ticket === 1 && r.role === "coder")!;
    spawner.runs[0]!.exit(0);
    const r = await mcp("get_ticket", {ticket: 1}, run.token);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text).error).toBe(`run ${run.id} has ended`);
  });

  test("restart, cancel, logs and unknown routes", async () => {
    expect(JSON.parse((await ui("POST", "/api/tickets/2/restart", {})).text).error).toBe("nothing to restart for T-2 (In Progress, unassigned)");
    expect((await ui("POST", "/api/runs/R-99/cancel", {})).status).toBe(404);
    expect((await ui("GET", "/api/runs/R-1/log")).status).toBe(404);
    mkdirSync(join(project, ".slimstack", "board", "runs"), {recursive: true});
    writeFileSync(join(project, ".slimstack", "board", "runs", "R-1.log"), "# R-1 coder implement T-1\n");
    const log = await ui("GET", "/api/runs/R-1/log");
    expect(log.status).toBe(200);
    expect(log.headers["content-type"]).toContain("text/plain");
    expect(log.text).toBe("# R-1 coder implement T-1\n");
    expect((await ui("GET", "/api/nope")).status).toBe(404);
    expect((await ui("GET", "/api/archives/..%2F..%2Fboard")).status).toBe(404);
    expect(JSON.parse((await ui("GET", "/api/archives")).text)).toEqual([]);
  });

  test("SSE sends hello, then a change event after a POST", async () => {
    const received = await new Promise<string>((resolve, reject) => {
      let data = "";
      let posted = false;
      const req = httpRequest({host: "127.0.0.1", port, path: `/api/events?token=${daemon.uiToken}`}, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers["content-type"]).toBe("text/event-stream");
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
          if (!posted && data.includes("event: hello")) {
            posted = true;
            void ui("POST", "/api/tickets", ticketBody("third"));
          }
          if (data.includes("event: change")) {
            req.destroy();
            resolve(data);
          }
        });
      });
      req.on("error", (err) => {
        if (!data.includes("event: change")) reject(err);
      });
      req.end();
    });
    expect(received).toContain("retry: 2000");
    expect(received).toMatch(/event: hello\ndata: \{"rev":\d+\}/);
    expect(received).toMatch(/event: change\ndata: \{"rev":\d+\}/);
  });
});

describe("daemon lifecycle", () => {
  test("a second daemon on the same project refuses to start", async () => {
    await expect(startDaemon({projectRoot: project, harness: "claude", env, uiDir, spawner: new FakeSpawner()})).rejects.toThrow(
      `board daemon already running (pid ${process.pid})`,
    );
  });

  test("project names are HTML-escaped, last-port is reused, daemon.json is written, /api/shutdown stops the daemon", async () => {
    const other = join(tmp, "p&q");
    mkdirSync(other, {recursive: true});
    const d = await startDaemon({projectRoot: other, harness: "omp", env, uiDir, spawner: new FakeSpawner()});
    const dir = join(other, ".slimstack", "board");
    const info = readDaemonInfo(dir)!;
    expect(info.port).toBe(d.port);
    expect(info.harness).toBe("omp");
    expect(info.pid).toBe(process.pid);
    expect(readFileSync(join(dir, "last-port"), "utf8")).toBe(String(d.port));
    expect(readFileSync(join(other, ".slimstack", ".gitignore"), "utf8")).toContain("*");
    const page = await send(d.port, "GET", "/");
    expect(page.text).toContain("<title>p&amp;q</title>");

    const down = await send(d.port, "POST", "/api/shutdown", {headers: {"x-slimstack-token": info.mcpToken}, body: "{}"});
    expect(down.status).toBe(200);
    expect(JSON.parse(down.text)).toEqual({ok: true});
    await d.stopped;
    expect(existsSync(join(dir, "daemon.json"))).toBe(false);
    expect(existsSync(join(dir, "daemon.lock"))).toBe(false);

    // restarts on the remembered port
    const again = await startDaemon({projectRoot: other, harness: "omp", env, uiDir, spawner: new FakeSpawner()});
    expect(again.port).toBe(d.port);
    await again.stop();
  });

  test("a stale lock from a dead process is taken over", async () => {
    const stale = join(tmp, "stale");
    const dir = join(stale, ".slimstack", "board");
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "daemon.lock"), "2147483000");
    const d = await startDaemon({projectRoot: stale, harness: "claude", env, uiDir, spawner: new FakeSpawner()});
    expect(readFileSync(join(dir, "daemon.lock"), "utf8")).toBe(String(process.pid));
    await d.stop();
  });

  test("an unreadable board.json is moved aside and logged", async () => {
    const bad = join(tmp, "bad");
    const dir = join(bad, ".slimstack", "board");
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, "board.json"), "{garbage");
    const d = await startDaemon({projectRoot: bad, harness: "claude", env, uiDir, spawner: new FakeSpawner()});
    expect(readFileSync(join(dir, "daemon.log"), "utf8")).toContain("board.json was unreadable");
    expect(JSON.parse((await send(d.port, "GET", "/api/state", {headers: {"x-slimstack-token": d.uiToken}})).text).tickets).toEqual([]);
    await d.stop();
  });
});
