import {spawn} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {boardDir, pluginRoot} from "./paths.ts";
import {VERSION} from "./version.ts";

export interface DaemonInfo {
  pid: number;
  port: number;
  mcpToken: string;
  harness: "claude" | "omp";
  startedAt: number;
  version: string;
}

export interface DaemonResponse {
  status: number;
  body: unknown;
}

const START_TIMEOUT_MS = 10_000;
const POLL_MS = 100;
const REQUEST_TIMEOUT_MS = 5_000;
/** A launched daemon must not inherit a board run's identity. */
const RUN_ENV_KEYS = ["SLIMSTACK_RUN_TOKEN", "SLIMSTACK_RUN_ID", "SLIMSTACK_TICKET"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `daemon.json` of the board in `dir`, or null when missing or malformed. */
export function readDaemonInfo(dir: string): DaemonInfo | null {
  try {
    const j = JSON.parse(readFileSync(join(dir, "daemon.json"), "utf8")) as Partial<DaemonInfo>;
    if (
      typeof j.pid !== "number" ||
      typeof j.port !== "number" ||
      typeof j.mcpToken !== "string" ||
      (j.harness !== "claude" && j.harness !== "omp") ||
      typeof j.startedAt !== "number" ||
      typeof j.version !== "string"
    ) {
      return null;
    }
    return j as DaemonInfo;
  } catch {
    return null;
  }
}

/** One request to the daemon. Throws on connection failure or timeout; HTTP error statuses are returned. */
export async function request(
  info: DaemonInfo,
  method: string,
  path: string,
  body?: unknown,
  runToken?: string,
): Promise<DaemonResponse> {
  const headers: Record<string, string> = {"x-slimstack-token": info.mcpToken};
  if (runToken) headers["x-slimstack-run"] = runToken;
  const init: RequestInit = {method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, init);
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON body: keep the text
  }
  return {status: res.status, body: parsed};
}

export interface DaemonHealth {
  ok: true;
  pid: number;
  project: string;
  version: string;
  activeRuns: number;
}

/** Health of the daemon described by `info`, or null when it is not answering as that daemon. */
export async function health(info: DaemonInfo): Promise<DaemonHealth | null> {
  try {
    const r = await request(info, "GET", "/api/health");
    const b = r.body as Partial<DaemonHealth> | null;
    if (r.status === 200 && b && b.ok === true && b.pid === info.pid) return b as DaemonHealth;
  } catch {
    // not running
  }
  return null;
}

/** Waits until `daemon.json` is gone; false on timeout. */
export async function waitForDaemonGone(dir: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (existsSync(join(dir, "daemon.json"))) {
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
  return true;
}

export interface EnsureDaemonOptions {
  projectRoot: string;
  harness: "claude" | "omp";
  runtime: {execPath: string; env: NodeJS.ProcessEnv};
}

function launch(o: EnsureDaemonOptions): void {
  const env: NodeJS.ProcessEnv = {...o.runtime.env};
  for (const k of RUN_ENV_KEYS) delete env[k];
  const child = spawn(
    o.runtime.execPath,
    [join(pluginRoot(), "dist", "board.mjs"), "--launch", "--project", o.projectRoot, "--harness", o.harness],
    {detached: true, stdio: "ignore", windowsHide: true, env},
  );
  child.on("error", () => {});
  child.unref();
}

/** Returns the info of a healthy daemon for the project, starting (or restarting on a version change) one when needed. */
export async function ensureDaemon(o: EnsureDaemonOptions): Promise<DaemonInfo> {
  const dir = boardDir(o.projectRoot);
  const current = readDaemonInfo(dir);
  if (current) {
    const h = await health(current);
    if (h && (h.version === VERSION || h.activeRuns > 0)) return current;
    if (h) {
      try {
        await request(current, "POST", "/api/shutdown");
      } catch {
        // already going down
      }
      await waitForDaemonGone(dir, START_TIMEOUT_MS);
    }
  }
  launch(o);
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    const info = readDaemonInfo(dir);
    if (info && (await health(info))) return info;
    if (Date.now() >= deadline) throw new Error(`board daemon did not start within 10s; see ${join(dir, "daemon.log")}`);
    await sleep(POLL_MS);
  }
}
