import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { TOOLS } from "../src/board/tools.ts";
import { isRecord } from "../src/core/guards.ts";
import { ROOT, sourceHash } from "./hash.ts";

const errors: string[] = [];
const warnings: string[] = [];
const fail = (message: string): void => void errors.push(message);

const abs = (rel: string): string => join(ROOT, rel);
const exists = (rel: string): boolean => existsSync(abs(rel));
const text = (rel: string): string => readFileSync(abs(rel), "utf8");
const size = (rel: string): number => statSync(abs(rel)).size;

function field(v: unknown, key: string): unknown {
  return isRecord(v) ? v[key] : undefined;
}

function json(rel: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text(rel));
    if (isRecord(parsed)) return parsed;
    fail(`${rel}: expected a JSON object`);
  } catch (e) {
    fail(`${rel}: cannot read as JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  return null;
}

/** Leading `---` block as `key: value` pairs; values may be quoted. No YAML dependency. */
function frontmatter(rel: string): Record<string, string> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text(rel));
  if (!match) return null;
  const out: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

const pkg = json("package.json") ?? {};

// The two harness-specific board server declarations; each harness must see exactly one.
const CLAUDE_MCP_SERVERS = {
  board: {
    command: "node",
    args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp.mjs"],
    env: {
      SLIMSTACK_HARNESS: "claude",
      SLIMSTACK_BOARD_DIR: "${SLIMSTACK_BOARD_DIR:-}",
      SLIMSTACK_RUN_TOKEN: "${SLIMSTACK_RUN_TOKEN:-}",
    },
  },
};
const OMP_MCP_JSON = {
  mcpServers: {
    "slimstack-board": {
      type: "stdio",
      command: "omp",
      args: ["${OMP_PLUGIN_ROOT}/dist/mcp.mjs"],
      env: {
        BUN_BE_BUN: "1",
        SLIMSTACK_HARNESS: "omp",
        SLIMSTACK_BOARD_DIR: "SLIMSTACK_BOARD_DIR",
        SLIMSTACK_RUN_TOKEN: "SLIMSTACK_RUN_TOKEN",
      },
    },
  },
};

// (1) dist is fresh
if (!exists("dist/build-hash.txt") || text("dist/build-hash.txt").trim() !== sourceHash()) {
  fail("dist is stale: run bun scripts/build.ts");
}

// (2) Claude plugin manifest
const plugin = json(".claude-plugin/plugin.json");
if (plugin) {
  if (plugin.name !== pkg.name) fail(`plugin.json name ${plugin.name} != package.json name ${pkg.name}`);
  if (plugin.version !== pkg.version) fail(`plugin.json version ${plugin.version} != package.json version ${pkg.version}`);
  if ("hooks" in plugin) fail("plugin.json must not declare hooks (hooks/hooks.json is auto-discovered)");
  if (!isDeepStrictEqual(plugin.agents, ["./claude-agents/sceptical-plan-reviewer.md"])) {
    fail('plugin.json agents must equal ["./claude-agents/sceptical-plan-reviewer.md"]');
  }
  if (!isDeepStrictEqual(plugin.mcpServers, CLAUDE_MCP_SERVERS)) fail("plugin.json mcpServers differs from the board server definition");
}

// (3) marketplace catalog
const market = json(".claude-plugin/marketplace.json");
if (market) {
  const plugins: unknown[] = Array.isArray(market.plugins) ? market.plugins : [];
  if (plugins.length !== 1) fail(`marketplace.json must list exactly one plugin (found ${plugins.length})`);
  else {
    if (field(plugins[0], "name") !== pkg.name) fail(`marketplace.json plugin name ${field(plugins[0], "name")} != ${pkg.name}`);
    if (field(plugins[0], "source") !== "./") fail('marketplace.json plugin source must be "./"');
  }
}

// (4) GitHub-only install surface
if (pkg.private !== true) fail("package.json must set private: true");
if (!isDeepStrictEqual(field(pkg.omp, "extensions"), ["./dist/omp.mjs"])) fail('package.json omp.extensions must equal ["./dist/omp.mjs"]');
if ("dependencies" in pkg) fail("package.json must have no dependencies");
const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", windowsHide: true });
if (tracked.status === 0) {
  for (const file of tracked.stdout.split(/\r?\n/)) {
    if (/^(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json)$/.test(file)) fail(`lockfile is tracked: ${file}`);
  }
}
if (exists(".omp-plugin")) fail(".omp-plugin/ must not exist");

// (5) skills
const SKILLS = ["lean", "brainstorm", "spec-writer", "task-planner", "board", "tester", "debugger", "reviewer", "verifier", "finisher", "handoff", "skill-writer"];
const ALLOWED_TOOLS: Record<string, string> = {
  lean: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" *)',
  board:
    'Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" board *) mcp__plugin_slimstack_board__list_tickets mcp__plugin_slimstack_board__archive_board mcp__plugin_slimstack_board__clear_board',
  "task-planner": "mcp__plugin_slimstack_board__create_ticket mcp__plugin_slimstack_board__list_tickets mcp__plugin_slimstack_board__get_ticket",
};
const present = exists("skills") ? readdirSync(abs("skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
for (const name of present) if (!SKILLS.includes(name)) fail(`unexpected skill directory: skills/${name}`);
let descriptionChars = 0;
for (const name of SKILLS) {
  const rel = `skills/${name}/SKILL.md`;
  if (!exists(rel)) {
    fail(`missing ${rel}`);
    continue;
  }
  const fm = frontmatter(rel);
  if (!fm) {
    fail(`${rel}: missing frontmatter`);
    continue;
  }
  const wanted = ["name", "description", ...(name in ALLOWED_TOOLS ? ["allowed-tools"] : [])].sort();
  if (!isDeepStrictEqual(Object.keys(fm).sort(), wanted)) fail(`${rel}: frontmatter keys must be exactly ${wanted.join(", ")} (found ${Object.keys(fm).sort().join(", ")})`);
  if (fm.name !== name) fail(`${rel}: name ${fm.name} != directory ${name}`);
  if (name in ALLOWED_TOOLS && fm["allowed-tools"] !== ALLOWED_TOOLS[name]) fail(`${rel}: allowed-tools differs from the specified value`);
  const description = fm.description ?? "";
  descriptionChars += description.length;
  if (!description.startsWith("Use ")) fail(`${rel}: description must start with "Use "`);
  if (description.length > 250) fail(`${rel}: description is ${description.length} chars (max 250)`);
  if (description.includes(": ")) fail(`${rel}: description contains ": "`);
  if (description.includes("#")) fail(`${rel}: description contains "#"`);
  if (size(rel) > 3000) fail(`${rel}: ${size(rel)} bytes (max 3000)`);
}
if (descriptionChars > 2000) fail(`skill descriptions total ${descriptionChars} chars (max 2000)`);
for (const rel of [
  "skills/brainstorm/references/sceptical-plan-reviewers.md",
  "skills/brainstorm/references/sceptic-prompt.md",
  "skills/task-planner/references/ticket-template.md",
  "skills/board/references/role-coder.md",
  "skills/board/references/role-tester.md",
  "skills/board/references/role-responder.md",
]) {
  if (!exists(rel)) fail(`missing ${rel}`);
  else if (rel.includes("/role-") && size(rel) > 4000) fail(`${rel}: ${size(rel)} bytes (max 4000)`);
}

// (6) bootstrap byte budgets
const BUDGETS: Record<string, number> = {
  "bootstrap/router.md": 1600,
  "bootstrap/lean-lite.md": 800,
  "bootstrap/lean-full.md": 1200,
  "bootstrap/tools-claude.md": 400,
  "bootstrap/tools-omp.md": 400,
};
for (const [rel, max] of Object.entries(BUDGETS)) {
  if (!exists(rel)) fail(`missing ${rel}`);
  else if (size(rel) > max) fail(`${rel}: ${size(rel)} bytes (max ${max})`);
}

// (7) Claude hooks
const hooks = json("hooks/hooks.json");
const hookEvents = field(hooks, "hooks");
if (hooks && !isRecord(hookEvents)) fail("hooks/hooks.json: missing hooks object");
if (isRecord(hookEvents)) {
  const events = Object.keys(hookEvents).sort();
  if (!isDeepStrictEqual(events, ["PostToolUse", "SessionStart", "SubagentStart"])) fail(`hooks.json events must be PostToolUse, SessionStart, SubagentStart (found ${events.join(", ")})`);
  for (const [event, value] of Object.entries(hookEvents)) {
    const groups: unknown[] = Array.isArray(value) ? value : [];
    for (const group of groups) {
      const entries: unknown[] = Array.isArray(field(group, "hooks")) ? (field(group, "hooks") as unknown[]) : [];
      for (const hook of entries) {
        const args = field(hook, "args");
        if (field(hook, "command") !== "node") fail(`hooks.json ${event}: command must be node`);
        if (!Array.isArray(args) || args[0] !== "${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs") fail(`hooks.json ${event}: args[0] must be \${CLAUDE_PLUGIN_ROOT}/dist/claude-hook.mjs`);
      }
    }
  }
}

// (8) the one shipped agent, once per harness
function checkAgentDir(dir: string, lines: Record<string, string>): void {
  const files = exists(dir) ? readdirSync(abs(dir)) : [];
  if (!isDeepStrictEqual(files, ["sceptical-plan-reviewer.md"])) {
    fail(`${dir}/ must contain only sceptical-plan-reviewer.md (found ${files.join(", ") || "nothing"})`);
    return;
  }
  const fm = frontmatter(`${dir}/sceptical-plan-reviewer.md`);
  for (const [key, value] of Object.entries(lines)) {
    if (fm?.[key] !== value) fail(`${dir}/sceptical-plan-reviewer.md: ${key} must be "${value}" (found "${fm?.[key]}")`);
  }
}
checkAgentDir("agents", { name: "sceptical-plan-reviewer", tools: "read, grep, glob, write" });
checkAgentDir("claude-agents", { name: "sceptical-plan-reviewer", model: "claude-opus-5-5", effort: "high", tools: "Read, Grep, Glob, SendMessage" });

// (9) placeholder owner is a warning, not a failure
for (const rel of ["README.md", "LICENSE", "package.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
  if (exists(rel) && /\bOWNER\b/.test(text(rel))) warnings.push(`WARN: placeholder OWNER remains in ${rel} (run bun scripts/set-owner.ts <github-user>)`);
}

// (10) omp reads mcp.json, Claude reads .mcp.json: only the former may exist
const ompMcp = json("mcp.json");
if (ompMcp && !isDeepStrictEqual(ompMcp, OMP_MCP_JSON)) fail("mcp.json differs from the omp board server definition");
if (exists(".mcp.json")) fail(".mcp.json must not exist (it would make Claude load a second board server)");

// (11) build outputs
for (const rel of ["dist/board.mjs", "dist/mcp.mjs", "dist/board-ui/index.html", "dist/board-ui/app.js", "dist/board-ui/app.css"]) {
  if (!exists(rel)) fail(`missing ${rel}: run bun scripts/build.ts`);
}

// (12) board tool schema budget: it sits in every agent's context
const toolBytes = Buffer.byteLength(JSON.stringify(TOOLS));
if (TOOLS.length !== 9) fail(`TOOLS has ${TOOLS.length} entries (expected 9)`);
if (toolBytes > 3000) fail(`JSON.stringify(TOOLS) is ${toolBytes} bytes (max 3000, about 1,200 Claude tokens)`);

for (const w of warnings) console.warn(w);
if (errors.length > 0) {
  for (const e of errors) console.error(`lint: ${e}`);
  process.exit(1);
}
const bootstrapBytes = size("bootstrap/router.md") + size("bootstrap/lean-full.md") + size("bootstrap/tools-claude.md");
console.log(`lint ok: ${SKILLS.length} skills, 1 agent, ${TOOLS.length} board tools, bootstrap ${bootstrapBytes} bytes, tools ${toolBytes} bytes`);
