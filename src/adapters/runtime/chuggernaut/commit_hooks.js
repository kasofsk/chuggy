import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, sep } from "node:path";
import { remove_comments, supported } from "./comments.js";
function git(workspace, environment, ...args) {
  const got = spawnSync("git", args, {
    cwd: workspace,
    env: environment,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (got.error) throw got.error;
  if (got.status !== 0)
    throw new Error(
      `git ${args[0]} failed with exit ${got.status}: ${Buffer.concat([got.stdout, got.stderr]).toString()}`,
    );
  return got.stdout;
}
export async function prepare_commit(
  workspace,
  base,
  workload,
  report,
  environment,
  message,
) {
  if (
    git(
      workspace,
      environment,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ).length ||
    git(workspace, environment, "diff", "--name-only", base, "HEAD", "--")
      .length
  )
    await run_pre_commit_hooks(workspace, base, workload, report, environment);
  if (
    git(workspace, environment, "diff", "--cached", "--name-only", "HEAD", "--")
      .length
  )
    git(
      workspace,
      environment,
      "-c",
      "user.name=Chug Runner",
      "-c",
      "user.email=chug-runner@invalid",
      "commit",
      "--no-gpg-sign",
      "-m",
      message,
    );
  return git(workspace, environment, "rev-parse", "HEAD^{commit}")
    .toString()
    .trim();
}
export async function run_pre_commit_hooks(
  workspace,
  base,
  workload,
  report,
  environment,
) {
  const enabled = workload.strip_comments ?? true;
  if (typeof enabled !== "boolean")
    throw new Error("strip_comments must be a boolean");
  const directives = workload.comment_directives ?? [];
  if (
    !Array.isArray(directives) ||
    !directives.every((v) => typeof v === "string")
  )
    throw new Error(
      "comment_directives must be an array of regular expressions",
    );
  for (const pattern of directives) new RegExp(pattern);
  const hooks = workload.pre_commit_hooks ?? [];
  if (!Array.isArray(hooks))
    throw new Error("pre_commit_hooks must be an array of commands");
  const commands = [];
  for (const hook of hooks) {
    if (
      !Array.isArray(hook) ||
      !hook.length ||
      !hook.every((v) => typeof v === "string" && !!v)
    )
      throw new Error(
        "pre_commit_hooks entries must be nonempty arrays of arguments",
      );
    commands.push(hook);
  }
  git(workspace, environment, "add", "--all");
  if (enabled)
    await remove_added_comments(
      workspace,
      base,
      directives,
      report,
      environment,
    );
  else report("pre-commit remove-comments disabled");
  for (const [index, command] of commands.entries()) {
    report(`pre-commit hook ${index + 1} started`);
    const got = spawnSync(command[0], command.slice(1), {
      cwd: workspace,
      env: environment,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (got.stdout || got.stderr)
      report((got.stdout + got.stderr).slice(-8192));
    if (got.error) throw got.error;
    if (got.status !== 0)
      throw new Error(
        `pre-commit hook ${index + 1} failed with exit ${got.status}`,
      );
    report(`pre-commit hook ${index + 1} passed`);
  }
  git(workspace, environment, "add", "--all");
  if (enabled && commands.length)
    await remove_added_comments(
      workspace,
      base,
      directives,
      () => {},
      environment,
      true,
    );
}
async function remove_added_comments(
  workspace,
  base,
  patterns,
  report,
  environment,
  check = false,
) {
  const entries = git(
    workspace,
    environment,
    "diff",
    "--cached",
    "--name-status",
    "-z",
    "--find-renames",
    base,
    "--",
  )
    .toString()
    .split("\0");
  const changes = [];
  let removed = 0,
    preserved = 0,
    scanned = 0;
  for (let index = 0; index < entries.length;) {
    const status = entries[index++];
    if (!status) break;
    const old_name = entries[index++],
      name = /^[RC]/.test(status) ? entries[index++] : old_name;
    if (status === "D") continue;
    const path = join(workspace, name),
      stat = lstatSync(path);
    if (
      stat.isSymbolicLink() ||
      !stat.isFile() ||
      !realpathSync(path).startsWith(realpathSync(workspace) + sep)
    ) {
      report(`pre-commit remove-comments skipped non-regular file ${name}`);
      continue;
    }
    if (!supported(name)) {
      report(`pre-commit remove-comments skipped unsupported file ${name}`);
      continue;
    }
    const original =
        status === "A" || extname(old_name) !== extname(name)
          ? Buffer.alloc(0)
          : git(workspace, environment, "show", `${base}:${old_name}`),
      current = readFileSync(path);
    if (current.includes(0))
      throw new Error(`comment hook cannot process binary source ${name}`);
    const decode = new TextDecoder("utf8", { fatal: true });
    let result;
    try {
      result = await remove_comments(
        name,
        decode.decode(current),
        decode.decode(original),
        patterns,
      );
    } catch (error) {
      report(`pre-commit remove-comments failed file=${name}: ${error}`);
      throw error;
    }
    scanned++;
    removed += result.removed;
    preserved += result.preserved;
    if (result.removed) changes.push([path, result.source]);
  }
  if (check) {
    if (changes.length)
      throw new Error(
        `pre-commit commands introduced ${removed} removable comments`,
      );
    return;
  }
  for (const [path, content] of changes) writeFileSync(path, content);
  git(workspace, environment, "add", "--all");
  report(
    `pre-commit remove-comments removed=${removed} preserved=${preserved} files=${scanned}`,
  );
}
