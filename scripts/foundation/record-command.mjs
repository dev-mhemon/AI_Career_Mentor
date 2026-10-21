import { redact } from "./redact.mjs";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const [name, command, ...args] = process.argv.slice(2);
if (!name || !command || !/^[a-z0-9-]+$/.test(name))
  throw Error("Expected safe label and command");
mkdirSync("artifacts/checks", { recursive: true });
const started = new Date().toISOString();
const r = spawnSync(command, args, {
  encoding: "utf8",
  env: process.env,
  maxBuffer: 32 * 1024 * 1024,
});
writeFileSync(
  `artifacts/checks/${name}.log`,
  redact((r.stdout || "") + (r.stderr || "")),
);
writeFileSync(
  `artifacts/checks/${name}.json`,
  JSON.stringify(
    {
      command: [command, ...args],
      started,
      finished: new Date().toISOString(),
      exit_code: r.status,
    },
    null,
    2,
  ),
);
console.log(`${r.status === 0 ? "PASS" : "FAIL"}: ${name} (exit ${r.status})`);
if (r.status !== 0) console.error("See artifacts/checks/" + name + ".log");
process.exit(r.status ?? 1);
