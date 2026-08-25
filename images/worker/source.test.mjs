import assert from "node:assert/strict";
import test from "node:test";

import {
  commitAndPushSource,
  resultDocument,
  ticketBranch,
} from "./source.mjs";

test("ticket branch is deterministic, bounded, and names the ticket", () => {
  assert.equal(
    ticketBranch({ ticket: 42, attempt: "attempt-identity" }),
    "refs/heads/chuggy/tickets/42/attempts/" +
      "9a33b56cbbac4db829e4917c5ac9369958062635f18534cfc26b48071229a39f",
  );
});

test("source publication commits all changes and pushes a new attempt ref", async () => {
  const calls = [];
  const command = async (executable, args, options) => {
    calls.push({ executable, args, options });
    return args[0] === "rev-parse" ? { stdout: "abc123\n" } : { stdout: "" };
  };
  const environment = { GIT_ASKPASS: "askpass" };
  const source = await commitAndPushSource({
    task: {
      ticket: 7,
      attempt: "opaque",
      worker: { files: [{ path: ".claude/settings.json" }] },
    },
    repositoryId: "chuggy",
    repository: "http://git/rig.git",
    base: "base123",
    directory: "/workspace/repository",
    command,
    environment,
  });

  assert.deepEqual(source, {
    repository: "chuggy",
    ref: ticketBranch({ ticket: 7, attempt: "opaque" }),
    commit: "abc123",
    base: "base123",
  });
  assert.deepEqual(calls.at(-1), {
    executable: "git",
    args: ["push", "http://git/rig.git", `HEAD:${source.ref}`],
    options: { cwd: "/workspace/repository", env: environment },
  });
  assert.ok(calls.some(({ args }) => args[0] === "add" && args[1] === "--all"));
  assert.ok(
    calls.some(
      ({ args }) =>
        args[0] === "reset" && args.at(-1) === ".claude/settings.json",
    ),
  );
  assert.ok(
    calls.some(
      ({ args }) => args[0] === "commit" && args.includes("--allow-empty"),
    ),
  );
});

test("a source report uses the schema that declares a source field", () => {
  assert.equal(resultDocument({ verdict: "Fail" }).version, 1);
  assert.equal(
    resultDocument({ verdict: "Pass", source: { repository: "chuggy" } })
      .version,
    2,
  );
});
