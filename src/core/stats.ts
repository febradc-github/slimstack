import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homeDir, statsPath } from "./paths.ts";

export interface StatsRecord {
  ts: number;
  tool: string;
  before: number;
  after: number;
}

const MAX_BYTES = 2_000_000;
const KEEP_LINES = 2_000;

export function recordCompaction(rec: StatsRecord, env: NodeJS.ProcessEnv = process.env): void {
  try {
    mkdirSync(homeDir(env), { recursive: true });
    const file = statsPath(env);
    try {
      if (statSync(file).size > MAX_BYTES) {
        const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
        writeFileSync(file, lines.slice(-KEEP_LINES).join("\n") + "\n");
      }
    } catch {
      // missing file: nothing to trim
    }
    appendFileSync(file, JSON.stringify(rec) + "\n");
  } catch {
    // stats must never break a hook
  }
}

export function summarizeStats(env: NodeJS.ProcessEnv = process.env): string {
  const none = "no compactions recorded (compaction runs on Claude Code only; omp has its own shellMinimizer)";
  let text: string;
  try {
    text = readFileSync(statsPath(env), "utf8");
  } catch {
    return none;
  }
  let count = 0;
  let before = 0;
  let after = 0;
  let first = Infinity;
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const r = JSON.parse(line) as Partial<StatsRecord>;
      if (
        typeof r.ts !== "number" ||
        typeof r.before !== "number" ||
        typeof r.after !== "number" ||
        !Number.isFinite(r.ts + r.before + r.after)
      ) {
        continue;
      }
      count++;
      before += r.before;
      after += r.after;
      if (r.ts < first) first = r.ts;
    } catch {
      // skip unparsable line
    }
  }
  if (count === 0) return none;
  const pct = before > 0 ? (((after - before) / before) * 100).toFixed(1) : "0.0";
  const saved = Math.round((before - after) / 4);
  const since = new Date(first).toISOString().slice(0, 10);
  return [
    `slimstack stats since ${since}`,
    `compactions: ${count}`,
    `chars: ${before} -> ${after} (${pct}%)`,
    `~tokens saved: ${saved} (chars/4 estimate)`,
    "note: counts compacted Bash outputs only; terse-output rules are not measured here.",
  ].join("\n");
}
