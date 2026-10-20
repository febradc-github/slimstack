import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./hash.ts";

const FILES = [
  "README.md",
  "LICENSE",
  "package.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];

const user = process.argv[2];
if (!user) {
  console.error("usage: bun scripts/set-owner.ts <github-user>");
  process.exit(1);
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user)) {
  console.error(`invalid GitHub user name: ${user}`);
  process.exit(1);
}

const changed: string[] = [];
for (const file of FILES) {
  const path = join(ROOT, file);
  if (!existsSync(path)) continue;
  const before = readFileSync(path, "utf8");
  const after = before.replace(/\bOWNER\b/g, user);
  if (after === before) continue;
  writeFileSync(path, after);
  changed.push(file);
}
console.log(changed.length ? `owner set to ${user} in:\n${changed.map(f => "  " + f).join("\n")}` : "no OWNER placeholder found");
