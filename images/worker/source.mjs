import { createHash } from "node:crypto";

export function ticketBranch(task) {
  const attempt = createHash("sha256").update(task.attempt).digest("hex");
  return `refs/heads/chuggy/tickets/${String(task.ticket)}/attempts/${attempt}`;
}

export function resultDocument(manifest) {
  return { version: 3, ...manifest };
}

/**
 * The branch one passing work attempt leaves behind.
 *
 * THE PUSH ASKS FOR ITS CREDENTIAL AGAIN. `refresh` is present where the plane
 * minted the one the clone used: a minted token expires, an attempt may outlive
 * one, and the push is the last thing it does — so the credential is taken
 * immediately before it rather than carried from the clone. Where the launcher
 * mounted the credential there is nothing to refresh, and the clone's own
 * environment is what pushes.
 */
export async function commitAndPushSource({
  task,
  repositoryId,
  repository,
  base,
  directory,
  command,
  environment,
  refresh,
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
    env: refresh === undefined ? environment : await refresh(),
  });
  return { repository: repositoryId, ref, commit, base };
}
