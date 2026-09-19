import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname, sep } from "node:path";
import { remove_comments, supported, type Removal } from "./comments.ts";
type Workload = Readonly<Record<string, unknown>>;
function git(
  workspace: string,
  environment: NodeJS.ProcessEnv,
  ...args: string[]
): Buffer {
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
  workspace: string,
  base: string,
  workload: Workload,
  report: (text: string) => void,
  environment: NodeJS.ProcessEnv,
  message: string,
): Promise<string> {
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
/** What the workload asks of the pre-commit stage, or a refusal naming why. */
function pre_commit_settings(workload: Workload): {
  enabled: boolean;
  directives: string[];
  commands: [string, ...string[]][];
} {
  const enabled = workload["strip_comments"] ?? true;
  if (typeof enabled !== "boolean")
    throw new Error("strip_comments must be a boolean");
  const directives = workload["comment_directives"] ?? [];
  if (
    !Array.isArray(directives) ||
    !directives.every((v: unknown): v is string => typeof v === "string")
  )
    throw new Error(
      "comment_directives must be an array of regular expressions",
    );
  for (const pattern of directives) new RegExp(pattern);
  const hooks = workload["pre_commit_hooks"] ?? [];
  if (!Array.isArray(hooks))
    throw new Error("pre_commit_hooks must be an array of commands");
  const commands: [string, ...string[]][] = [];
  for (const hook of hooks) {
    if (
      !Array.isArray(hook) ||
      !hook.length ||
      !hook.every((v: unknown): v is string => typeof v === "string" && !!v)
    )
      throw new Error(
        "pre_commit_hooks entries must be nonempty arrays of arguments",
      );
    commands.push(hook as [string, ...string[]]);
  }
  return { enabled, directives, commands };
}
export async function run_pre_commit_hooks(
  workspace: string,
  base: string,
  workload: Workload,
  report: (text: string) => void,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const { enabled, directives, commands } = pre_commit_settings(workload);
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
type StagedEntry = { status: string; old_name: string; name: string };
type CommentContext = {
  workspace: string;
  base: string;
  patterns: string[];
  report: (text: string) => void;
  environment: NodeJS.ProcessEnv;
};

/** The entries a `--name-status -z` listing names, one record each. */
function staged_entries(entries: string[]): StagedEntry[] {
  const staged: StagedEntry[] = [];
  for (let index = 0; index < entries.length;) {
    const status = entries[index++] ?? "";
    if (!status) break;
    const old_name = entries[index++] ?? "";
    const name = /^[RC]/.test(status) ? (entries[index++] ?? "") : old_name;
    staged.push({ status, old_name, name });
  }
  return staged;
}

/** What removing comments from one staged file yields, or nothing if it is skipped. */
async function file_removal(
  context: CommentContext,
  entry: StagedEntry,
): Promise<{ path: string; result: Removal } | null> {
  const { workspace, base, patterns, report, environment } = context;
  const { status, old_name, name } = entry;
  const path = join(workspace, name),
    stat = lstatSync(path);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    !realpathSync(path).startsWith(realpathSync(workspace) + sep)
  ) {
    report(`pre-commit remove-comments skipped non-regular file ${name}`);
    return null;
  }
  if (!supported(name)) {
    report(`pre-commit remove-comments skipped unsupported file ${name}`);
    return null;
  }
  const original =
      status === "A" || extname(old_name) !== extname(name)
        ? Buffer.alloc(0)
        : git(workspace, environment, "show", `${base}:${old_name}`),
    current = readFileSync(path);
  if (current.includes(0))
    throw new Error(`comment hook cannot process binary source ${name}`);
  const decode = new TextDecoder("utf8", { fatal: true });
  try {
    return {
      path,
      result: await remove_comments(
        name,
        decode.decode(current),
        decode.decode(original),
        patterns,
      ),
    };
  } catch (error) {
    report(`pre-commit remove-comments failed file=${name}: ${String(error)}`);
    throw error;
  }
}

async function remove_added_comments(
  workspace: string,
  base: string,
  patterns: string[],
  report: (text: string) => void,
  environment: NodeJS.ProcessEnv,
  check = false,
): Promise<void> {
  const context: CommentContext = {
    workspace,
    base,
    patterns,
    report,
    environment,
  };
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
  const changes: [string, string][] = [];
  let removed = 0,
    preserved = 0,
    scanned = 0;
  for (const entry of staged_entries(entries)) {
    if (entry.status === "D") continue;
    const removal = await file_removal(context, entry);
    if (!removal) continue;
    scanned++;
    removed += removal.result.removed;
    preserved += removal.result.preserved;
    if (removal.result.removed)
      changes.push([removal.path, removal.result.source]);
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
