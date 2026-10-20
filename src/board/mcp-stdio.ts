import {TOOLS} from "./tools.ts";

export const SUPPORTED_PROTOCOLS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpHandlerOptions {
  callTool(name: string, args: unknown): Promise<{text: string; isError: boolean}>;
  version: string;
}

type Id = string | number | null;

function reply(id: Id, result: object): object {
  return {jsonrpc: "2.0", id, result};
}

function fail(id: Id, code: number, message: string): object {
  return {jsonrpc: "2.0", id, error: {code, message}};
}

/** Returns the JSON-RPC response for `msg`, or null when no response is due (notifications). */
export function createMcpHandler(o: McpHandlerOptions): (msg: unknown) => Promise<object | null> {
  return async (msg) => {
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return fail(null, -32600, "Invalid Request");
    const m = msg as {id?: unknown; method?: unknown; params?: unknown};
    if (m.id === undefined) return null;
    const id = m.id as Id;
    if (typeof m.method !== "string") return fail(id, -32600, "Invalid Request");
    if (m.method.startsWith("notifications/")) return null;
    const params = typeof m.params === "object" && m.params !== null ? (m.params as Record<string, unknown>) : {};
    switch (m.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return reply(id, {
          protocolVersion: typeof asked === "string" && SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0],
          capabilities: {tools: {listChanged: false}},
          serverInfo: {name: "slimstack-board", version: o.version},
        });
      }
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, {tools: TOOLS});
      case "tools/call": {
        if (typeof params.name !== "string") return fail(id, -32602, "Invalid params");
        try {
          const r = await o.callTool(params.name, params.arguments);
          return reply(id, {content: [{type: "text", text: r.text}], isError: r.isError});
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return reply(id, {content: [{type: "text", text: `internal error: ${message}`}], isError: true});
        }
      }
      default:
        return fail(id, -32601, "Method not found");
    }
  };
}
