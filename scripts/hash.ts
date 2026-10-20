import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");

/** sha256 over every source file that ends up in dist/, line-ending independent so Windows and POSIX checkouts agree. */
export function sourceHash(): string {
  const glob = new Bun.Glob("{src/**/*.ts,src/**/*.html,src/**/*.css,bootstrap/*.md}");
  const files = [...glob.scanSync(ROOT)].map(p => p.replace(/\\/g, "/")).sort();
  const hash = createHash("sha256");
  for (const path of files) {
    const content = readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
    hash.update(path + "\0" + content + "\0");
  }
  return hash.digest("hex");
}
