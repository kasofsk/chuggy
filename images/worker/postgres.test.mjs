import assert from "node:assert/strict";
import test from "node:test";

import { startLocalPostgres } from "./postgres.mjs";

test("the development worker owns an isolated bounded PostgreSQL server", async () => {
  const calls = [];
  const environment = {};
  const stop = await startLocalPostgres("/workspace", {
    mkdir: async (...args) => calls.push(["mkdir", ...args]),
    executeFile: async (...args) => {
      calls.push(args);
      return args[0] === "pg_config" ? { stdout: "/postgres/bin\n" } : {};
    },
    environment,
  });

  assert.equal(
    environment.CHUG_PG_URL,
    "postgres://postgres@127.0.0.1:55432/postgres",
  );
  assert.equal(environment.CHUG_PG_WORKERS, "1");
  assert.ok(
    calls.some(
      ([executable, args]) =>
        executable === "/postgres/bin/initdb" &&
        args.includes("--auth=trust") &&
        args.includes("--pgdata=/workspace/.chuggy/postgres/data"),
    ),
  );
  assert.ok(
    calls.some(
      ([executable, [command, wait]]) =>
        executable === "/postgres/bin/pg_ctl" &&
        command === "start" &&
        wait === "--wait",
    ),
  );

  await stop();
  await stop();
  assert.equal(
    calls.filter(
      ([executable, [command]]) =>
        executable === "/postgres/bin/pg_ctl" && command === "stop",
    ).length,
    1,
  );
});
