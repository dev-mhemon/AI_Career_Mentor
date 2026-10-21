import { redact } from "./redact.mjs";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const git = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  : {};
const identity = {
  implementation_head_sha:
    event.pull_request?.head?.sha || git("rev-parse", "HEAD"),
  checked_out_tested_sha: git("rev-parse", "HEAD"),
  base_sha:
    event.pull_request?.base?.sha ||
    process.env.ALIGNMENT_BASE_SHA ||
    git("rev-parse", "--verify", "origin/phase1-restart"),
  worktree_status: git("status", "--porcelain"),
};
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
      ...identity,
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
