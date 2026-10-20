import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSlimstackDir, spillRoot } from "./paths.ts";

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

function safe(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}

/** Writes the full text to `<spillRoot>/<session>/<call>.<stream>.txt`; returns its absolute path or null on any fs error. */
export function writeSpill(
  projectDir: string,
  sessionId: string,
  callId: string,
  stream: string,
  text: string,
): string | null {
  try {
    ensureSlimstackDir(projectDir);
    const dir = join(spillRoot(projectDir), safe(sessionId));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${safe(callId)}.${stream}.txt`);
    writeFileSync(file, text);
    return file;
  } catch {
    return null;
  }
}

/** Deletes session spill dirs older than 3 days. Swallows all errors. */
export function pruneSpill(projectDir: string, now: number = Date.now()): void {
  try {
    const root = spillRoot(projectDir);
    for (const name of readdirSync(root)) {
      try {
        const dir = join(root, name);
        if (now - statSync(dir).mtimeMs > RETENTION_MS) rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}
