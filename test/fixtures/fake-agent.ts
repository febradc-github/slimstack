// Fake board agent for tests. Reads the run prompt from stdin and acts on the board through POST /api/mcp.
import {readFileSync} from "node:fs";
import {join} from "node:path";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

const prompt = await readStdin();
const m = /slimstack board run (R-\d+): role (\w+), mode (\w+), ticket T-(\d+)(?:, comment #(\d+))?\./.exec(prompt);
if (!m) {
  console.error("fake-agent: unrecognized prompt: " + prompt);
  process.exit(1);
}
const role = m[2]!;
const ticket = Number(m[4]);
const commentId = m[5] !== undefined ? Number(m[5]) : undefined;

const boardDir = process.env.SLIMSTACK_BOARD_DIR;
const runToken = process.env.SLIMSTACK_RUN_TOKEN;
if (!boardDir || !runToken) {
  console.error("fake-agent: SLIMSTACK_BOARD_DIR and SLIMSTACK_RUN_TOKEN are required");
  process.exit(1);
}
const info = JSON.parse(readFileSync(join(boardDir, "daemon.json"), "utf8")) as {port: number; mcpToken: string};

async function call(tool: string, args: Record<string, unknown>): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${info.port}/api/mcp`, {
    method: "POST",
    headers: {"content-type": "application/json", "x-slimstack-token": info.mcpToken, "x-slimstack-run": runToken!},
    body: JSON.stringify({tool, args}),
  });
  const out = (await res.json()) as {text?: string; isError?: boolean; error?: string};
  if (!res.ok || out.isError) throw new Error(`${tool} failed: ${out.text ?? out.error ?? res.status}`);
}

try {
  if (role === "coder") {
    await call("move_ticket", {ticket, to: "in_progress"});
    await call("add_comment", {ticket, body: `Summary: implemented T-${ticket} (fake coder).`});
    await call("move_ticket", {ticket, to: "testing"});
  } else if (role === "tester") {
    await call("add_comment", {ticket, body: `All acceptance criteria verified (fake tester).`, kind: "test_run", passed: true});
    await call("move_ticket", {ticket, to: "done"});
  } else {
    const args: Record<string, unknown> = {ticket, body: "ack"};
    if (commentId !== undefined) args.replyTo = commentId;
    await call("add_comment", args);
  }
} catch (e) {
  console.error("fake-agent: " + (e as Error).message);
  process.exit(1);
}
