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

// src/core/spill.ts
import { mkdirSync as mkdirSync2, readdirSync, rmSync, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

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

// src/core/spill.ts
var RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
function safe(id) {
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
function writeSpill(projectDir, sessionId, callId, stream, text) {
  try {
    ensureSlimstackDir(projectDir);
    const dir = join2(spillRoot(projectDir), safe(sessionId));
    mkdirSync2(dir, { recursive: true });
    const file = join2(dir, `${safe(callId)}.${stream}.txt`);
    writeFileSync2(file, text);
    return file;
  } catch {
    return null;
  }
}
function pruneSpill(projectDir, now = Date.now()) {
  try {
    const root = spillRoot(projectDir);
    for (const name of readdirSync(root)) {
      try {
        const dir = join2(root, name);
        if (now - statSync(dir).mtimeMs > RETENTION_MS)
          rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

// src/core/compact.ts
var THRESHOLD_CHARS = 8000;
var MAX_LINE_CHARS = 1500;
var HEAD_LINES = 60;
var TAIL_LINES = 60;
var SIGNAL_CONTEXT = 1;
var MAX_SIGNAL_LINES = 80;
var MIN_SAVING = 0.1;
var JSON_MIN_ITEMS = 20;
var JSON_HEAD = 5;
var JSON_TAIL = 2;
var JSON_SIGNAL = 10;
var SIGNAL_RE = /\b(error|errors|fail|failed|failure|failures|fatal|panic|exception|traceback|assert|assertion|warn|warning|denied|timeout|cannot|unable)\b/i;
var ANSI_CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
var ANSI_OSC = /\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
function compactJson(input) {
  if (!input.trimStart().startsWith("["))
    return null;
  let arr;
  try {
    arr = JSON.parse(input);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length < JSON_MIN_ITEMS)
    return null;
  const n = arr.length;
  const keep = [];
  for (let i = 0;i < JSON_HEAD; i++)
    keep.push(i);
  let signals = 0;
  for (let i = JSON_HEAD;i < n - JSON_TAIL && signals < JSON_SIGNAL; i++) {
    const s = JSON.stringify(arr[i]);
    if (s !== undefined && SIGNAL_RE.test(s)) {
      keep.push(i);
      signals++;
    }
  }
  for (let i = n - JSON_TAIL;i < n; i++)
    keep.push(i);
  let body = "";
  let prev = -1;
  for (const idx of keep) {
    const item = JSON.stringify(arr[idx]) ?? "null";
    if (prev === -1)
      body = item;
    else if (idx !== prev + 1)
      body += `,
/* ` + (idx - prev - 1) + ` items omitted */
` + item;
    else
      body += `,
` + item;
    prev = idx;
  }
  return `[
` + body + `
]`;
}
function cleanLines(input) {
  const stripped = input.replace(ANSI_OSC, "").replace(ANSI_CSI, "");
  const out = [];
  let blank = false;
  let run = 0;
  let runLine = "";
  const flushRun = () => {
    if (run >= 3)
      out.push(runLine + " (x" + run + ")");
    else
      for (let k = 0;k < run; k++)
        out.push(runLine);
    run = 0;
  };
  for (const raw of stripped.split(/\r?\n/)) {
    let line = raw;
    const cr = line.lastIndexOf("\r");
    if (cr !== -1) {
      const parts = line.split("\r");
      let pick = "";
      for (let k = parts.length - 1;k >= 0; k--) {
        if (parts[k] !== "") {
          pick = parts[k];
          break;
        }
      }
      line = pick;
    }
    line = line.trimEnd();
    if (line.length > MAX_LINE_CHARS) {
      line = line.slice(0, MAX_LINE_CHARS) + "...[+" + (line.length - MAX_LINE_CHARS) + " chars]";
    }
    if (line === "") {
      if (blank)
        continue;
      blank = true;
    } else {
      blank = false;
    }
    if (run > 0 && line === runLine) {
      run++;
      continue;
    }
    flushRun();
    runLine = line;
    run = 1;
  }
  flushRun();
  return out;
}
function headTail(lines) {
  const n = lines.length;
  if (n <= HEAD_LINES + TAIL_LINES)
    return lines.join(`
`);
  const midEnd = n - TAIL_LINES;
  const keep = new Set;
  for (let i = HEAD_LINES;i < midEnd && keep.size < MAX_SIGNAL_LINES; i++) {
    if (!SIGNAL_RE.test(lines[i]))
      continue;
    for (let c = Math.max(HEAD_LINES, i - SIGNAL_CONTEXT);c <= Math.min(midEnd - 1, i + SIGNAL_CONTEXT); c++) {
      keep.add(c);
    }
  }
  const mid = [...keep].sort((a, b) => a - b).slice(0, MAX_SIGNAL_LINES);
  const out = lines.slice(0, HEAD_LINES);
  let next = HEAD_LINES;
  for (const i of mid) {
    if (i > next)
      out.push("[... " + (i - next) + " lines omitted ...]");
    out.push(lines[i]);
    next = i + 1;
  }
  if (midEnd > next)
    out.push("[... " + (midEnd - next) + " lines omitted ...]");
  for (let i = midEnd;i < n; i++)
    out.push(lines[i]);
  return out.join(`
`);
}
function compactOutput(input, o) {
  const threshold = o.thresholdChars ?? THRESHOLD_CHARS;
  if (input.length < threshold)
    return null;
  const limit = input.length * (1 - MIN_SAVING);
  let body = compactJson(input);
  if (body !== null && body.length > limit)
    body = null;
  if (body === null) {
    const lines = cleanLines(input);
    body = lines.join(`
`);
    if (body.length > threshold)
      body = headTail(lines);
  }
  if (body.length > limit)
    return null;
  const spillPath = writeSpill(o.projectDir, o.sessionId, o.callId, o.stream, input);
  if (spillPath === null)
    return null;
  const before = input.length;
  const tail = (after) => `
[slimstack: compacted ` + before + "->" + after + " chars; full output: " + spillPath + "]";
  let text = body + tail(0);
  for (let i = 0;i < 3; i++) {
    const next = body + tail(text.length);
    if (next.length === text.length) {
      text = next;
      break;
    }
    text = next;
  }
  return { text, before, after: text.length, spillPath };
}

// src/core/config.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync2, renameSync, writeFileSync as writeFileSync3 } from "node:fs";

// src/core/guards.ts
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  mkdirSync3(homeDir(env), { recursive: true });
  const file = configPath(env);
  const tmp = file + ".tmp";
  writeFileSync3(tmp, JSON.stringify(next, null, 2) + `
`);
  renameSync(tmp, file);
  return next;
}

// src/core/stats.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync4, readFileSync as readFileSync3, statSync as statSync2, writeFileSync as writeFileSync4 } from "node:fs";
var MAX_BYTES = 2000000;
var KEEP_LINES = 2000;
function recordCompaction(rec, env = process.env) {
  try {
    mkdirSync4(homeDir(env), { recursive: true });
    const file = statsPath(env);
    try {
      if (statSync2(file).size > MAX_BYTES) {
        const lines = readFileSync3(file, "utf8").split(`
`).filter(Boolean);
        writeFileSync4(file, lines.slice(-KEEP_LINES).join(`
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

// src/adapters/claude.ts
function projectDirOf(input, env) {
  return env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
}
function sessionStart(input, env = process.env) {
  pruneSpill(projectDirOf(input, env));
  const role = env.SLIMSTACK_RUN_ID ? "sub" : "main";
  const text = buildBootstrap({ harness: "claude", role, lean: readConfig(env).lean });
  if (text === null)
    return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } });
}
function subagentStart(_input, env = process.env) {
  const text = buildBootstrap({ harness: "claude", role: "sub", lean: readConfig(env).lean });
  if (text === null)
    return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext: text } });
}
function postToolUse(input, env = process.env) {
  if (input.tool_name !== "Bash")
    return null;
  const resp = input.tool_response;
  if (typeof resp !== "object" || resp === null || Array.isArray(resp))
    return null;
  const r = resp;
  if (r.interrupted === true || r.isImage === true)
    return null;
  if (!readConfig(env).compact)
    return null;
  const projectDir = projectDirOf(input, env);
  const sessionId = input.session_id ?? "session";
  const callId = input.tool_use_id ?? String(Date.now());
  const updated = { ...r };
  let changed = false;
  for (const stream of ["stdout", "stderr"]) {
    const value = r[stream];
    if (typeof value !== "string")
      continue;
    const res = compactOutput(value, { projectDir, sessionId, callId, stream });
    if (res === null)
      continue;
    updated[stream] = res.text;
    changed = true;
    recordCompaction({ ts: Date.now(), tool: "Bash", before: res.before, after: res.after }, env);
  }
  if (!changed)
    return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } });
}

// src/bin/claude-hook.ts
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin)
    chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString("utf8");
}
try {
  const raw = (await readStdin()).trim();
  const input = raw === "" ? {} : JSON.parse(raw);
  let out = null;
  switch (process.argv[2]) {
    case "session-start":
      out = sessionStart(input);
      break;
    case "subagent-start":
      out = subagentStart(input);
      break;
    case "post-tool-use":
      out = postToolUse(input);
      break;
  }
  if (out !== null)
    process.stdout.write(out + `
`);
} catch {}
