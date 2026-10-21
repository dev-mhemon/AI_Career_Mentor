/** Record source identity and upstream image evidence without Docker environment/credentials. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const github = process.env.GITHUB_ACTIONS === "true";
const head = run("git", ["rev-parse", "HEAD"]);
const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH))
  : {};
const implementation =
  event.pull_request?.head?.sha || process.env.GITHUB_SHA || head;
if (github) {
  if (head !== process.env.GITHUB_SHA)
    throw Error("Checkout SHA differs from GitHub event SHA");
  run("git", ["merge-base", "--is-ancestor", implementation, head]);
  if (
    path.resolve(process.env.MENTOR_LOCAL_DIR || "") !==
    path.join(process.env.GITHUB_WORKSPACE, ".local/foundation")
  )
    throw Error("CI must use a fresh checkout-owned disposable project");
  if (process.env.SUPABASE_BIN?.includes("/workspace/.mentor-tools"))
    throw Error("Onboarding CLI is forbidden in CI");
}
const data = {
  recorded_at: new Date().toISOString(),
  execution_environment: github ? "github_actions" : "local",
  implementation_head_sha: implementation,
  checked_out_tested_sha: head,
  base_sha:
    event.pull_request?.base?.sha || process.env.ALIGNMENT_BASE_SHA || null,
  github_sha: process.env.GITHUB_SHA || null,
  github_ref: process.env.GITHUB_REF || null,
  event_name: process.env.GITHUB_EVENT_NAME || null,
  run_id: process.env.GITHUB_RUN_ID || null,
  run_attempt: process.env.GITHUB_RUN_ATTEMPT || null,
  run_url: github
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  worktree_status: run("git", ["status", "--porcelain"]),
  node: process.version,
  docker_server: run("docker", ["version", "--format", "{{.Server.Version}}"]),
  docker_driver: run("docker", ["info", "--format", "{{.Driver}}"]),
};
const stage = process.argv[2] || "checkout";
if (stage === "images") {
  data.images = [];
  for (const service of ["db", "auth", "kong", "rest", "inbucket"]) {
    const container = JSON.parse(
      run("docker", [
        "inspect",
        `supabase_${service}_ai-career-mentor-foundation`,
      ]),
    )[0];
    const metadata = JSON.parse(
      run("docker", ["image", "inspect", container.Image]),
    )[0];
    const custom = Object.keys(metadata.Config?.Labels || {}).filter((k) =>
      k.startsWith("mentor.onboarding"),
    );
    if (github && (custom.length || !metadata.RepoDigests?.length))
      throw Error(`CI ${service} is not a registry-backed upstream image`);
    data.images.push({
      service,
      image_reference: container.Config.Image,
      image_id: container.Image,
      repo_digests: metadata.RepoDigests || [],
      onboarding_customization_labels: custom,
    });
  }
}
mkdirSync("artifacts/ci", { recursive: true });
writeFileSync(
  `artifacts/ci/${stage}.json`,
  JSON.stringify(data, null, 2) + "\n",
);
console.log(
  `PASS: ${stage} provenance (${data.execution_environment}); checkout ${head}; implementation ${implementation}`,
);
