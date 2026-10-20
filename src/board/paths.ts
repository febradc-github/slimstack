import {existsSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

/** First directory at or above `start` containing `.git` (file or directory); `resolve(start)` when none. */
export function findProjectRoot(start: string): string {
  const first = resolve(start);
  let dir = first;
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return first;
    dir = parent;
  }
}

export function boardDir(root: string): string {
  return join(root, ".slimstack", "board");
}

export function projectRootOf(dir: string): string {
  return resolve(dir, "..", "..");
}

/** Plugin root: first directory above this module whose package.json is named "slimstack". */
export function pluginRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {name?: unknown};
      if (pkg.name === "slimstack") return dir;
    } catch {
      // no readable package.json here: keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("slimstack plugin root not found");
    dir = parent;
  }
}
