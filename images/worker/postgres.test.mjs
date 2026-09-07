import assert from "node:assert/strict";
import test from "node:test";

import { attemptDatabase } from "./postgres.mjs";

test("the gates are handed the attempt's own server under their own name, one worker wide", () => {
  const environment = {
    CHUG_WORKER_DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres",
  };
  attemptDatabase(environment, environment.CHUG_WORKER_DATABASE_URL);
  assert.deepEqual(environment, {
    CHUG_PG_URL: "postgres://postgres@127.0.0.1:5432/postgres",
    CHUG_PG_WORKERS: "1",
  });
});

test("a worker count the site chose stands", () => {
  const environment = {
    CHUG_WORKER_DATABASE_URL: "postgres://postgres@127.0.0.1:5432/postgres",
    CHUG_PG_WORKERS: "4",
  };
  attemptDatabase(environment, environment.CHUG_WORKER_DATABASE_URL);
  assert.equal(environment.CHUG_PG_WORKERS, "4");
  assert.equal(environment.CHUG_WORKER_DATABASE_URL, undefined);
});
