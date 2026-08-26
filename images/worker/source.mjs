import { createHash } from "node:crypto";

export function ticketBranch(task) {
  const attempt = createHash("sha256").update(task.attempt).digest("hex");
  return `refs/heads/chuggy/tickets/${String(task.ticket)}/attempts/${attempt}`;
}

export function resultDocument(manifest) {
  return { version: 3, ...manifest };
}

export async function commitAndPushSource({
  task,
  repositoryId,
  repository,
  base,
  directory,
  command,
  environment,
}) {
  await command("git", ["config", "user.name", "Chuggy Worker"], {
    cwd: directory,
  });
  await command("git", ["config", "user.email", "worker@chuggy.invalid"], {
    cwd: directory,
  });
  await command("git", ["add", "--all"], { cwd: directory });
  const provisioned = (task.worker?.files ?? []).map((file) => file.path);
  if (provisioned.length > 0) {
    await command("git", ["reset", "--", ...provisioned], { cwd: directory });
  }
  await command(
    "git",
    [
      "commit",
      "--allow-empty",
      "-m",
      `ticket ${String(task.ticket)} attempt ${task.attempt}`,
    ],
    { cwd: directory },
  );
  const { stdout } = await command("git", ["rev-parse", "HEAD"], {
    cwd: directory,
  });
  const commit = stdout.trim();
  const ref = ticketBranch(task);
  await command("git", ["push", repository, `HEAD:${ref}`], {
    cwd: directory,
    env: environment,
  });
  return { repository: repositoryId, ref, commit, base };
}
