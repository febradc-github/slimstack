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
import { existsSync as existsSync2, readFileSync as readFileSync4 } from "node:fs";
import { dirname, join as join2, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function findProjectRoot(start) {
  const first = resolve(start);
  let dir = first;
  for (;; ) {
    if (existsSync2(join2(dir, ".git")))
      return dir;
    const parent = dirname(dir);
    if (parent === dir)
      return first;
    dir = parent;
  }
}
function boardDir(root) {
  return join2(root, ".slimstack", "board");
}
function projectRootOf(dir) {
  return resolve(dir, "..", "..");
}
function pluginRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;; ) {
    try {
      const pkg = JSON.parse(readFileSync4(join2(dir, "package.json"), "utf8"));
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
import { existsSync as existsSync3, readFileSync as readFileSync5 } from "node:fs";
import { join as join3 } from "node:path";
function readDaemonInfo(dir) {
  try {
    const j = JSON.parse(readFileSync5(join3(dir, "daemon.json"), "utf8"));
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
  while (existsSync3(join3(dir, "daemon.json"))) {
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
  const child = spawn(o.runtime.execPath, [join3(pluginRoot(), "dist", "board.mjs"), "--launch", "--project", o.projectRoot, "--harness", o.harness], { detached: true, stdio: "ignore", windowsHide: true, env });
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
      throw new Error(`board daemon did not start within 10s; see ${join3(dir, "daemon.log")}`);
    await sleep(POLL_MS);
  }
}
var START_TIMEOUT_MS = 1e4, POLL_MS = 100, REQUEST_TIMEOUT_MS = 5000, RUN_ENV_KEYS, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var init_client = __esm(() => {
  init_paths();
  RUN_ENV_KEYS = ["SLIMSTACK_RUN_TOKEN", "SLIMSTACK_RUN_ID", "SLIMSTACK_TICKET"];
});

// src/board/open-url.ts
import { spawn as spawn2 } from "node:child_process";
function openUrl(url) {
  try {
    const child = process.platform === "win32" ? spawn2("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }) : spawn2(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
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

// src/board/cli.ts
async function boardCommand(sub, ctx) {
  const root = findProjectRoot(ctx.cwd);
  const dir = boardDir(root);
  const action = sub[0] ?? "status";
  if (action === "open") {
    try {
      const info = await ensureDaemon({ projectRoot: root, harness: ctx.harness, runtime: ctx.runtime });
      const url = `http://127.0.0.1:${info.port}/`;
      openUrl(url);
      return { ok: true, text: `board: ${url}` };
    } catch (err) {
      return { ok: false, text: err instanceof Error ? err.message : String(err) };
    }
  }
  const info = readDaemonInfo(dir);
  const alive = info ? await health(info) : null;
  if (!info || !alive)
    return { ok: true, text: "board: not running" };
  if (action === "stop") {
    try {
      await request(info, "POST", "/api/shutdown");
    } catch {}
    await waitForDaemonGone(dir, STOP_WAIT_MS);
    return { ok: true, text: "board: stopped" };
  }
  let body;
  try {
    body = (await request(info, "GET", "/api/state")).body;
  } catch {
    return { ok: true, text: "board: not running" };
  }
  const { tickets, runs } = body;
  const count = (s) => tickets.filter((t) => t.status === s).length;
  const order = ["todo", "in_progress", "testing", "done"];
  return {
    ok: true,
    text: [
      `board: http://127.0.0.1:${info.port}/ (pid ${info.pid})`,
      `tickets: ${order.map((s) => `${STATUS_LABEL[s]} ${count(s)}`).join(", ")}`,
      `agent runs: ${runs.filter((r) => r.status === "running").length} running, ${runs.filter((r) => r.status === "pending").length} queued`
    ].join(`
`)
  };
}
var STOP_WAIT_MS = 5000;
var init_cli = __esm(() => {
  init_client();
  init_open_url();
  init_paths();
  init_types();
});

// bootstrap/router.md
var router_default = `# slimstack
Workflow skills are available. Invoke the matching skill BEFORE acting; skip only for trivial one-step requests.
- New feature, behavior change, unclear intent: brainstorm -> spec-writer -> task-planner (creates tickets on the Kanban board; the user assigns and starts work there)
- Writing or changing code: tester (failing test first)
- Bug, failing test, unexpected behavior: debugger
- About to say done, fixed, or passing: verifier
- Review a change or receive review feedback: reviewer
- Verified work ready to integrate: finisher
- Context is large or the session is ending: handoff
- Kanban board (open, status, stop, agent CLI, archive or clear): board
- Creating or editing a skill: skill-writer
- Terseness level or token stats: lean
Artifacts: specs in docs/slimstack/specs/, briefs and board state in .slimstack/ (git-ignored). Use the board only through the slimstack board tools; never assign, move, or start tickets unless the user asks.
Compacted tool output ends with a \`[slimstack: ... full output: <path>]\` marker; read that file only if the compacted text is not enough.
`;

// bootstrap/lean-lite.md
var lean_lite_default = `## lean: lite
- Lead with the answer or action. No preamble, no restating the task, no closing recap.
- Fragments and bullets over prose. Keep code, commands, paths, and error text verbatim.
- Before writing code: reuse existing code, then stdlib/native, then an installed dependency; write the minimum that meets the requirement.
- Do not re-read files already in context or re-run checks that already passed.
- Reports contain only: result, evidence, blockers.
`;

// bootstrap/lean-full.md
var lean_full_default = `## lean: full
- Lead with the answer or action. No preamble, no restating the task, no closing recap.
- Fragments and bullets over prose. Keep code, commands, paths, and error text verbatim.
- Before writing code: reuse existing code, then stdlib/native, then an installed dependency; write the minimum that meets the requirement.
- Do not re-read files already in context or re-run checks that already passed.
- Reports contain only: result, evidence, blockers.
- Drop articles and filler. Status updates are at most 3 lines. Explain only when asked.
- Prefer one call that answers the question over several exploratory ones; batch independent calls.
- Mark deliberate shortcuts with a \`slimstack:\` code comment.
`;

// bootstrap/tools-claude.md
var tools_claude_default = `## tools (Claude Code)
Skills: Skill tool, name slimstack:<skill>. Subagents: Agent tool. Ask the user: AskUserQuestion. Checklist: TaskCreate/TaskUpdate (or TodoWrite if that is what you have). Shell: Bash. Files: Read/Edit/Write/Grep/Glob.
`;

// bootstrap/tools-omp.md
var tools_omp_default = `## tools (omp)
Skills: read skill://<skill> (skill://slimstack/<skill> if the name collides). Subagents: task (shared context, one item per subagent). Ask the user: ask. Checklist: todo. Shell: bash. Files: read/edit/write/grep/glob. Settings and board: the user runs /slimstack lean|compact|stats|board.
`;

// src/core/bootstrap.ts
function buildBootstrap(o) {
  const lean = o.lean === "off" ? null : o.lean === "full" ? lean_full_default : lean_lite_default;
  if (o.role === "sub")
    return lean === null ? null : lean.trim();
  const parts = [router_default];
  if (lean !== null)
    parts.push(lean);
  parts.push(o.harness === "omp" ? tools_omp_default : tools_claude_default);
  return parts.map((p) => p.trim()).join(`

`);
}

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

// src/core/stats.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync3, statSync, writeFileSync as writeFileSync3 } from "node:fs";
var MAX_BYTES = 2000000;
var KEEP_LINES = 2000;
function recordCompaction(rec, env = process.env) {
  try {
    mkdirSync3(homeDir(env), { recursive: true });
    const file = statsPath(env);
    try {
      if (statSync(file).size > MAX_BYTES) {
        const lines = readFileSync3(file, "utf8").split(`
`).filter(Boolean);
        writeFileSync3(file, lines.slice(-KEEP_LINES).join(`
`) + `
`);
      }
    } catch {}
    appendFileSync2(file, JSON.stringify(rec) + `
`);
  } catch {}
}
function summarizeStats(env = process.env) {
  const none = "no compactions recorded (compaction runs on Claude Code only; omp has its own shellMinimizer)";
  let text;
  try {
    text = readFileSync3(statsPath(env), "utf8");
  } catch {
    return none;
  }
  let count = 0;
  let before = 0;
  let after = 0;
  let first = Infinity;
  for (const line of text.split(`
`)) {
    if (!line)
      continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.ts !== "number" || typeof r.before !== "number" || typeof r.after !== "number" || !Number.isFinite(r.ts + r.before + r.after)) {
        continue;
      }
      count++;
      before += r.before;
      after += r.after;
      if (r.ts < first)
        first = r.ts;
    } catch {}
  }
  if (count === 0)
    return none;
  const pct = before > 0 ? ((after - before) / before * 100).toFixed(1) : "0.0";
  const saved = Math.round((before - after) / 4);
  const since = new Date(first).toISOString().slice(0, 10);
  return [
    `slimstack stats since ${since}`,
    `compactions: ${count}`,
    `chars: ${before} -> ${after} (${pct}%)`,
    `~tokens saved: ${saved} (chars/4 estimate)`,
    "note: counts compacted Bash outputs only; terse-output rules are not measured here."
  ].join(`
`);
}

// src/core/commands.ts
var USAGE = "usage: slimstack lean [off|lite|full] | compact [on|off] | stats | board [status|open|stop|agent [auto|claude|omp]]";
async function runCommand(argv, env = process.env, ctx) {
  const [cmd, a, b] = argv;
  const bad = { ok: false, text: USAGE };
  if (cmd === "lean" && argv.length <= 2) {
    if (a === undefined)
      return { ok: true, text: "lean: " + readConfig(env).lean };
    if (a === "off" || a === "lite" || a === "full") {
      writeConfig({ lean: a }, env);
      return { ok: true, text: "lean set to " + a };
    }
    return bad;
  }
  if (cmd === "compact" && argv.length <= 2) {
    if (a === undefined)
      return { ok: true, text: "compact: " + (readConfig(env).compact ? "on" : "off") };
    if (a === "on" || a === "off") {
      writeConfig({ compact: a === "on" }, env);
      return { ok: true, text: "compact set to " + a };
    }
    return bad;
  }
  if (cmd === "stats" && argv.length === 1)
    return { ok: true, text: summarizeStats(env) };
  if (cmd === "board") {
    if (a === "agent" && argv.length <= 3) {
      if (b === undefined)
        return { ok: true, text: "board agent: " + readConfig(env).board.agent };
      if (b === "auto" || b === "claude" || b === "omp") {
        writeConfig({ board: { agent: b } }, env);
        return { ok: true, text: "board agent set to " + b };
      }
      return bad;
    }
    if (argv.length === 1 || argv.length === 2 && (a === "status" || a === "open" || a === "stop")) {
      const c = ctx ?? {
        cwd: process.cwd(),
        harness: env.SLIMSTACK_HARNESS === "omp" ? "omp" : "claude",
        runtime: { execPath: process.execPath, env }
      };
      await Promise.resolve().then(() => init_cli());
      return boardCommand(argv.slice(1), c);
    }
  }
  return bad;
}

// src/adapters/omp.ts
var SCEPTIC_MODEL = "anthropic/claude-opus-5-5:high";
function slimstack(pi) {
  pi.setLabel("slimstack");
  pi.on("context", (e, ctx) => {
    const role = ctx.agent?.kind === "sub" || process.env.SLIMSTACK_RUN_ID ? "sub" : "main";
    const text = buildBootstrap({ harness: "omp", role, lean: readConfig().lean });
    if (text === null)
      return;
    const msg = { role: "user", content: [{ type: "text", text }], timestamp: 0 };
    const messages = e.messages.slice();
    let at = messages.findIndex((m) => m.role !== "compactionSummary");
    if (at === -1)
      at = messages.length;
    messages.splice(at, 0, msg);
    return { messages };
  });
  pi.registerCommand("slimstack", {
    description: "slimstack: lean [off|lite|full] | compact [on|off] | stats | board [status|open|stop|agent]",
    handler: async (args, ctx) => {
      const r = await runCommand(args.trim().split(/\s+/).filter(Boolean), process.env, {
        cwd: ctx.cwd,
        harness: "omp",
        runtime: { execPath: process.execPath, env: { ...process.env, BUN_BE_BUN: "1" } }
      });
      ctx.ui.notify(r.ok ? r.text : "error: " + r.text, "info");
    }
  });
  pi.on("before_subagent_spawn", (e) => e.agent === "sceptical-plan-reviewer" ? { model: SCEPTIC_MODEL, note: "slimstack: sceptical-plan-reviewers on opus-5.5 high" } : undefined);
}
export {
  SCEPTIC_MODEL,
  slimstack as default
};
