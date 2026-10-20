import { runCommand } from "../core/commands.ts";

const r = await runCommand(process.argv.slice(2));
process.stdout.write(r.text + "\n");
process.exitCode = r.ok ? 0 : 1;
