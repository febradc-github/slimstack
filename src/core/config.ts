import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isRecord } from "./guards.ts";
import { configPath, homeDir } from "./paths.ts";

export type LeanLevel = "off" | "lite" | "full";
export type BoardAgent = "auto" | "claude" | "omp" | "custom";

export interface BoardConfig {
  agent: BoardAgent;
  command: string[];
  timeoutMinutes: number;
  openBrowser: boolean;
}

export interface Config {
  lean: LeanLevel;
  compact: boolean;
  board: BoardConfig;
}

export const DEFAULT_CONFIG: Config = {
  lean: "lite",
  compact: true,
  board: { agent: "auto", command: [], timeoutMinutes: 60, openBrowser: true },
};

const LEAN: readonly string[] = ["off", "lite", "full"];
const AGENTS: readonly string[] = ["auto", "claude", "omp", "custom"];

function parseBoard(raw: unknown): BoardConfig {
  const d = DEFAULT_CONFIG.board;
  const out: BoardConfig = { ...d, command: [...d.command] };
  if (!isRecord(raw)) return out;
  if (typeof raw.agent === "string" && AGENTS.includes(raw.agent)) out.agent = raw.agent as BoardAgent;
  if (
    Array.isArray(raw.command) &&
    raw.command.every((c) => typeof c === "string" && c.length > 0)
  ) {
    out.command = [...(raw.command as string[])];
  }
  if (typeof raw.timeoutMinutes === "number" && Number.isFinite(raw.timeoutMinutes) && raw.timeoutMinutes >= 0) {
    out.timeoutMinutes = raw.timeoutMinutes;
  }
  if (typeof raw.openBrowser === "boolean") out.openBrowser = raw.openBrowser;
  return out;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath(env), "utf8"));
  } catch {
    raw = undefined;
  }
  const r = isRecord(raw) ? raw : {};
  return {
    lean: typeof r.lean === "string" && LEAN.includes(r.lean) ? (r.lean as LeanLevel) : DEFAULT_CONFIG.lean,
    compact: typeof r.compact === "boolean" ? r.compact : DEFAULT_CONFIG.compact,
    board: parseBoard(r.board),
  };
}

export function writeConfig(
  patch: { lean?: LeanLevel; compact?: boolean; board?: Partial<BoardConfig> },
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const cur = readConfig(env);
  const next: Config = {
    lean: patch.lean ?? cur.lean,
    compact: patch.compact ?? cur.compact,
    board: { ...cur.board, ...patch.board },
  };
  mkdirSync(homeDir(env), { recursive: true });
  const file = configPath(env);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  renameSync(tmp, file);
  return next;
}
