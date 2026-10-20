import {afterAll, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {readDaemonInfo, request, waitForDaemonGone} from "../src/board/client.ts";
import {createMcpHandler, SUPPORTED_PROTOCOLS} from "../src/board/mcp-stdio.ts";
import {TOOLS} from "../src/board/tools.ts";

function handler(call?: (name: string, args: unknown) => Promise<{text: string; isError: boolean}>) {
  return createMcpHandler({callTool: call ?? (async () => ({text: "ok", isError: false})), version: "9.9.9"});
}

describe("mcp handler", () => {
  test("initialize echoes a supported protocol version and reports the server version", async () => {
    for (const v of SUPPORTED_PROTOCOLS) {
      const r = (await handler()({jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: v}})) as any;
      expect(r.jsonrpc).toBe("2.0");
      expect(r.id).toBe(1);
      expect(r.result.protocolVersion).toBe(v);
      expect(r.result.serverInfo).toEqual({name: "slimstack-board", version: "9.9.9"});
      expect(r.result.capabilities).toEqual({tools: {listChanged: false}});
    }
  });

  test("initialize falls back to 2025-11-25 for unknown or missing versions", async () => {
    for (const params of [{protocolVersion: "2099-01-01"}, {}, undefined]) {
      const r = (await handler()({jsonrpc: "2.0", id: "a", method: "initialize", params})) as any;
      expect(r.id).toBe("a");
      expect(r.result.protocolVersion).toBe("2025-11-25");
    }
  });

  test("ping and tools/list", async () => {
    const h = handler();
    expect(await h({jsonrpc: "2.0", id: 2, method: "ping"})).toEqual({jsonrpc: "2.0", id: 2, result: {}});
    const r = (await h({jsonrpc: "2.0", id: 3, method: "tools/list"})) as any;
    expect(r.result.tools.map((t: {name: string}) => t.name)).toHaveLength(9);
    expect(r.result.tools).toEqual(JSON.parse(JSON.stringify(TOOLS)));
  });

  test("server/discover and unknown methods answer -32601 so dual-era clients fall back", async () => {
    for (const method of ["server/discover", "resources/list"]) {
      const r = (await handler()({jsonrpc: "2.0", id: 4, method})) as any;
      expect(r).toEqual({jsonrpc: "2.0", id: 4, error: {code: -32601, message: "Method not found"}});
    }
  });

  test("notifications and messages without id produce no response", async () => {
    const h = handler();
    expect(await h({jsonrpc: "2.0", method: "notifications/initialized"})).toBeNull();
    expect(await h({jsonrpc: "2.0", method: "tools/list"})).toBeNull();
  });

  test("non-object and array messages are invalid requests", async () => {
    const h = handler();
    for (const bad of [1, "x", null, [], [{id: 1}]]) {
      expect(await h(bad)).toEqual({jsonrpc: "2.0", id: null, error: {code: -32600, message: "Invalid Request"}});
    }
  });

  test("tools/call wraps results, including tool errors and thrown errors", async () => {
    const seen: unknown[] = [];
    const h = handler(async (name, args) => {
      seen.push([name, args]);
      if (name === "bad") return {text: "T-1 not found", isError: true};
      if (name === "throws") throw new Error("kaput");
      return {text: '{"ticket":1}', isError: false};
    });
    const ok = (await h({jsonrpc: "2.0", id: 5, method: "tools/call", params: {name: "get_ticket", arguments: {ticket: 1}}})) as any;
    expect(ok.result).toEqual({content: [{type: "text", text: '{"ticket":1}'}], isError: false});
    expect(seen[0]).toEqual(["get_ticket", {ticket: 1}]);
    const err = (await h({jsonrpc: "2.0", id: 6, method: "tools/call", params: {name: "bad", arguments: {}}})) as any;
    expect(err.result).toEqual({content: [{type: "text", text: "T-1 not found"}], isError: true});
    const thrown = (await h({jsonrpc: "2.0", id: 7, method: "tools/call", params: {name: "throws"}})) as any;
    expect(thrown.result.isError).toBe(true);
    expect(thrown.result.content[0].text).toBe("internal error: kaput");
    const invalid = (await h({jsonrpc: "2.0", id: 8, method: "tools/call", params: {}})) as any;
    expect(invalid.error.code).toBe(-32602);
  });
});

describe("dist/mcp.mjs subprocess", () => {
  const bundle = resolve(import.meta.dir, "..", "dist", "mcp.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "slimstack-mcp-"));
  const project = join(tmp, "project");
  const home = join(tmp, "home");
  const dir = join(project, ".slimstack", "board");

  afterAll(async () => {
    const info = readDaemonInfo(dir);
    if (info) {
      try {
        await request(info, "POST", "/api/shutdown");
      } catch {
        // already stopped
      }
      await waitForDaemonGone(dir, 5000);
    }
    rmSync(tmp, {recursive: true, force: true});
  });

  test("initialize, tools/list, and create_ticket auto-start the daemon", async () => {
    if (!existsSync(bundle)) throw new Error("run: bun scripts/build.ts");
    mkdirSync(project, {recursive: true});
    mkdirSync(home, {recursive: true});
    writeFileSync(join(home, "config.json"), JSON.stringify({board: {openBrowser: false}}));
    const lines = [
      {jsonrpc: "2.0", id: 1, method: "initialize", params: {protocolVersion: "2025-06-18", capabilities: {}, clientInfo: {name: "t", version: "0"}}},
      {jsonrpc: "2.0", method: "notifications/initialized"},
      {jsonrpc: "2.0", id: 2, method: "tools/list"},
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "create_ticket",
          arguments: {title: "Bridge ticket", instructions: "do it", pseudocode: "x", acceptanceCriteria: ["it works"]},
        },
      },
    ];
    const proc = Bun.spawn([process.execPath, bundle], {
      stdin: new Blob([lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n"]),
      stdout: "pipe",
      stderr: "pipe",
      env: {...process.env, SLIMSTACK_BOARD_DIR: dir, SLIMSTACK_HOME: home, SLIMSTACK_HARNESS: "claude"},
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(code, err).toBe(0);
    const replies = new Map<unknown, any>();
    for (const line of out.trim().split("\n")) {
      const r = JSON.parse(line);
      replies.set(r.id, r);
    }
    expect(replies.get(1).result.serverInfo.name).toBe("slimstack-board");
    expect(replies.get(2).result.tools).toHaveLength(9);
    expect(replies.get(3).result.isError).toBe(false);
    expect(replies.get(3).result.content[0].text).toContain('"ticket":1');
    expect(replies.get(null).error.code).toBe(-32700);
    expect(readDaemonInfo(dir)).not.toBeNull();
  }, 30_000);
});
