import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SLIMSTACK_HOME ?? join(homedir(), ".slimstack");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), "config.json");
}

export function statsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), "stats.jsonl");
}

export function spillRoot(projectDir: string): string {
  return join(projectDir, ".slimstack", "spill");
}

/** Creates `<projectDir>/.slimstack` and makes its `.gitignore` contain the line `*`. */
export function ensureSlimstackDir(projectDir: string): void {
  const dir = join(projectDir, ".slimstack");
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) {
    writeFileSync(ignore, "*\n");
    return;
  }
  const text = readFileSync(ignore, "utf8");
  if (!text.split(/\r?\n/).some((l) => l.trim() === "*")) {
    appendFileSync(ignore, (text.endsWith("\n") || text === "" ? "" : "\n") + "*\n");
  }
}
