/** Shell-free Python/npm execution for the foundation tools. */
import { spawnSync as nativeSpawnSync, execFileSync as nativeExecFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export function commandSpec(command, args, options = {}, platform = process.platform) {
  const env = options.env ?? process.env;
  if (command === "python3") {
    return [env.PYTHON_BIN || (platform === "win32" ? "python" : "python3"), args];
  }
  if (platform === "win32" && (command === "npm" || command === "npm.cmd")) {
    const npmCli = env.NPM_CLI_JS || path.join(
      path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"
    );
    if (!existsSync(npmCli)) {
      throw Error("npm-cli.js not found; set NPM_CLI_JS to the installed npm CLI JavaScript file.");
    }
    return [process.execPath, [npmCli, ...args]];
  }
  return [command, args];
}

export function spawnSync(command, args = [], options = {}) {
  const [executable, argv] = commandSpec(command, args, options);
  return nativeSpawnSync(executable, argv, options);
}

export function execFileSync(command, args = [], options = {}) {
  const [executable, argv] = commandSpec(command, args, options);
  return nativeExecFileSync(executable, argv, options);
}
